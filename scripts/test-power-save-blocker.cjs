/* Exercise native blocker state and real playback/settings watcher lifecycle. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const vue = require('vue')

function load(relative, dependencies, fallback) {
  const filename = path.resolve(__dirname, '..', relative)
  const instance = new Module(filename, module)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(path.dirname(filename))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : fallback?.(name) ?? nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
  return instance.exports
}

function nativeFixture() {
  const active = new Set()
  const starts = []
  const stops = []
  let nextId = 0
  const subject = load('src/main/utils/index.ts', {
    electron: { nativeTheme: {}, powerSaveBlocker: {
      start(type) { const id = nextId++; starts.push({ id, type }); active.add(id); return id },
      isStarted: id => active.has(id),
      stop(id) { stops.push(id); return active.delete(id) },
    } },
    '@common/utils': { throttle: action => action },
    '@main/modules/userApi/config': load('src/main/modules/userApi/config/index.ts', {}),
  }, name => name.startsWith('@') || name.startsWith('./') ? {} : undefined)
  return { ...subject, active, starts, stops }
}

function playbackFixture(native) {
  const cleanup = []
  const scope = vue.effectScope()
  const settings = vue.reactive({ 'player.powerSaveBlocker': true, 'player.togglePlayMethod': 'listLoop' })
  const playing = vue.ref(false)
  const events = new EventEmitter()
  const calls = []
  const mediaEvents = new Map()
  global.window = { lx: { isPlayedStop: false }, app_event: events, key_event: new EventEmitter() }
  for (const event of ['playerPlaying', 'play', 'playerPause', 'pause', 'playerEnded', 'error', 'playerError', 'playerLoadeddata', 'playerLoadstart', 'playerCanplay', 'playerEmptied', 'playerWaiting']) {
    events[event] = (...args) => events.emit(event, ...args)
  }
  const utils = load('src/renderer/core/player/utils.ts', {
    '@common/utils/vueTools': vue,
    '@renderer/store/player/action': {},
    '@renderer/store/setting': { appSetting: settings },
    '@renderer/store/dislikeList': {},
    '@renderer/utils/ipc': { setPowerSaveBlocker: enabled => { calls.push(enabled); native.setPowerSaveBlocker(enabled) } },
  })
  const plugin = { getCurrentTime: () => 0, getDuration: () => 100, setPause() {}, setStop() {}, getErrorCode: () => 2 }
  for (const name of ['onPlaying', 'onPause', 'onEnded', 'onError', 'onLoadeddata', 'onLoadstart', 'onCanplay', 'onEmptied', 'onWaiting']) {
    plugin[name] = callback => { mediaEvents.set(name, callback); return () => mediaEvents.delete(name) }
  }
  const dependencies = {
    '@common/utils/vueTools': { ...vue, onBeforeUnmount: callback => cleanup.push(callback) },
    '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/utils': { setTitle() {} },
    '@renderer/plugins/player': plugin,
    '@renderer/store/player/state': { musicInfo: {}, playMusicInfo: {}, playedList: [], isPlay: playing },
    '@renderer/store/player/action': { setPlay: value => { playing.value = value }, setAllStatus() {} },
    '@renderer/store/setting': { appSetting: settings },
    '@common/hotKey': { HOTKEY_PLAYER: Object.fromEntries(['next', 'prev', 'toggle_play', 'music_love', 'music_unlove', 'music_dislike', 'seekbackward', 'seekforward'].map(key => [key, { action: key }])) },
    '@renderer/core/player': Object.fromEntries(['playNext', 'pause', 'playPrev', 'togglePlay', 'collectMusic', 'uncollectMusic', 'dislikeMusic'].map(key => [key, () => {}])),
    '@renderer/core/player/utils': utils,
  }
  scope.run(() => {
    load('src/renderer/core/useApp/usePlayer/usePlayerEvent.ts', dependencies).default()
    load('src/renderer/core/useApp/usePlayer/usePlayer.ts', dependencies, name => name.startsWith('./') ? { __esModule: true, default: () => {} } : undefined).default()
  })
  return {
    settings, calls, playing,
    media: event => mediaEvents.get(event)(),
    dispose() { cleanup.forEach(callback => callback()); scope.stop() },
  }
}

async function main() {
  const timers = new Map()
  const realTimeout = global.setTimeout
  const realClear = global.clearTimeout
  let nextTimer = 0
  global.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id }
  global.clearTimeout = id => timers.delete(id)
  const expireRelease = () => {
    assert.equal(timers.size, 1, 'only one pause-release timer exists')
    const [id, timer] = timers.entries().next().value
    assert.equal(timer.delay, 90_000, 'retain the grace period between tracks and buffering')
    timers.delete(id)
    timer.callback()
  }
  try {
    const native = nativeFixture()
    native.setPowerSaveBlocker(true)
    native.setPowerSaveBlocker(true)
    assert.deepEqual(native.starts, [{ id: 0, type: 'prevent-display-sleep' }], 'all systems request display and system wakefulness without duplicate blockers')
    native.setPowerSaveBlocker(false)
    native.setPowerSaveBlocker(false)
    assert.deepEqual(native.stops, [0], 'blocker ID zero is valid and stops exactly once')
    native.setPowerSaveBlocker(true)
    native.active.clear()
    native.setPowerSaveBlocker(true)
    assert.equal(native.active.size, 1, 'an expired native blocker is recreated')
    native.setPowerSaveBlocker(false)

    const f = playbackFixture(native)
    f.media('onPlaying')
    assert.equal(f.playing.value, true)
    assert.equal(native.active.size, 1, 'media playing starts the native blocker')
    f.media('onPause')
    expireRelease()
    assert.equal(native.active.size, 0)

    f.media('onPlaying')
    f.media('onPause')
    expireRelease()
    assert.equal(native.active.size, 0, 'a second pause still schedules release after the first timer has fired')

    f.media('onPlaying')
    f.media('onWaiting')
    assert.equal(timers.size, 1)
    f.media('onPlaying')
    assert.equal(timers.size, 0, 'resuming cancels a pending release while buffering')
    assert.equal(native.active.size, 1)

    f.settings['player.powerSaveBlocker'] = false
    await vue.nextTick()
    assert.equal(native.active.size, 0, 'disabling the setting takes effect immediately during playback')
    f.media('onPlaying')
    assert.equal(native.active.size, 0, 'future playing events honor the disabled setting')
    f.settings['player.powerSaveBlocker'] = true
    await vue.nextTick()
    assert.equal(native.active.size, 1, 'enabling the setting during playback starts blocking immediately')

    f.media('onPause')
    f.settings['player.powerSaveBlocker'] = false
    await vue.nextTick()
    assert.equal(timers.size, 0, 'a forced setting change cancels stale delayed releases')
    f.settings['player.powerSaveBlocker'] = true
    await vue.nextTick()
    assert.equal(native.active.size, 0, 'enabling while paused does not keep the computer awake')

    f.media('onPlaying')
    f.media('onEnded')
    assert.equal(f.playing.value, false, 'natural completion clears actual playing state before resolving the next track')
    expireRelease()
    assert.equal(native.active.size, 0, 'natural playback completion releases the blocker even without a pause event')
    f.settings['player.powerSaveBlocker'] = false
    await vue.nextTick()
    f.settings['player.powerSaveBlocker'] = true
    await vue.nextTick()
    assert.equal(native.active.size, 0, 'toggling the preference after natural completion does not restart a blocker while idle')

    f.media('onPlaying')
    assert.equal(native.active.size, 1, 'the next playing event starts blocking again after natural completion')
    f.dispose()
    assert.equal(native.active.size, 0, 'player teardown releases the native blocker immediately')
    assert.equal(timers.size, 0)
    f.settings['player.powerSaveBlocker'] = false
    await vue.nextTick()
    assert.equal(native.active.size, 0)
    console.log('Power save blocker: native mode, repeated pause timers, playback/settings synchronization, buffering, natural end and teardown passed.')
  } finally {
    global.setTimeout = realTimeout
    global.clearTimeout = realClear
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
