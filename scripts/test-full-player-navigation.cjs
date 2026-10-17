const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const vue = require('vue')

function load(relative, dependencies) {
  const file = path.resolve(__dirname, '..', relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
  return instance.exports
}

function harness(mode = 'random', initialIndex = 0, downloads = false) {
  const same = (a, b) => a.id === b.id && ('progress' in a ? 'progress' in b : !('progress' in b) && a.source === b.source)
  const makeTrack = (id, source = 'wy') => ({ id, source, name: `Song ${id}`, singer: 'Singer', meta: {} })
  const tracks = ['a', 'b', 'c'].map(id => downloads ? { id: `download_${id}`, progress: 100, isComplate: true, metadata: { musicInfo: makeTrack(id) } } : makeTrack(id))
  const cache = new Map([['library', tracks]])
  const setting = vue.reactive({ 'player.togglePlayMethod': mode })
  const state = {
    playInfo: vue.reactive({ playerListId: 'library', playIndex: initialIndex, playerPlayIndex: initialIndex }),
    playMusicInfo: vue.shallowReactive({ musicInfo: tracks[initialIndex], listId: 'library', isTempPlay: false }),
    musicInfo: vue.reactive({ id: tracks[initialIndex].id, pic: null, lrc: null }),
    isPlay: vue.ref(false), playedList: vue.shallowReactive([]), tempPlayList: vue.shallowReactive([]),
    status: vue.ref(''), statusText: vue.ref(''),
  }
  const result = { ...state, tracks, cache, setting, resources: [], events: [], saved: [], pauses: 0, stops: 0 }
  const settingModule = { appSetting: setting, mergeSetting: patch => Object.assign(setting, patch), setTogglePlayMode: mode => result.saved.push(mode) }
  const constants = { LIST_IDS: { DOWNLOAD: 'download' }, SPLIT_CHAR: { DISLIKE_NAME: '\\n', DISLIKE_NAME_ALIAS: ' ' } }
  const worker = load('src/renderer/worker/main/list.ts', {
    '@common/constants': constants, '@common/utils/common': {}, '@common/utils/nodejs': {}, '@renderer/utils/music': {}, '@common/platformMatching': { samePlayTrack: same },
  })
  global.window = {
    lx: { isPlayedStop: false, worker: { main: worker } },
    app_event: new Proxy({}, { get: (_, name) => (...args) => result.events.push([name, ...args]) }),
    i18n: { t: value => value },
  }
  let core
  const scope = vue.effectScope()
  scope.run(() => {
    const actions = load('src/renderer/store/player/action.ts', {
      './state': state,
      '@renderer/store/list/action': { getListMusicsFromCache: id => cache.get(id) ?? [] },
      '@renderer/store/download/state': { downloadList: [] },
      './playProgress': { setProgress() {} },
      '@renderer/core/player': { playNext: (...args) => core.playNext(...args) },
      '@common/constants': constants, '@common/utils/vueTools': { toRaw: vue.toRaw },
      '@common/utils/common': { arrPush: (array, entries) => array.push(...entries), arrUnshift: (array, entries) => array.unshift(...entries) },
      '@common/platformMatching': { samePlayTrack: same },
    })
    const filters = load('src/renderer/core/player/utils.ts', {
      '@common/utils/vueTools': { toRaw: vue.toRaw, markRawList: value => value },
      '@renderer/store/player/action': actions, '@renderer/store/setting': settingModule,
      '@renderer/store/dislikeList': { dislikeInfo: { names: new Set(), musicNames: new Set(), singerNames: new Set() } }, '@renderer/utils/ipc': {},
    })
    result.repeat = load('src/renderer/store/player/repeatMode.ts', { '@renderer/store/setting': settingModule })
    core = result.core = load('src/renderer/core/player/action.ts', {
      '@renderer/plugins/player': { setStop: () => result.stops++, setPause: () => result.pauses++, setPlay() {}, setResource: url => result.resources.push(url), getAutoplay: () => true },
      '@renderer/store/player/state': state, '@renderer/store/player/action': actions, '@renderer/store/setting': settingModule,
      '@renderer/store/player/repeatMode': result.repeat,
      '../music/index': { getMusicUrl: async() => 'stream', getPicPath: async() => '', getLyricInfo: async() => ({ rawlrcInfo: {} }) },
      './utils': filters, '@renderer/utils/message': {}, '@renderer/utils/index': { getRandom: () => 0 },
      '@renderer/ui/services/platformAccounts': {},
      '@renderer/ui/services/platformPlayback': { activeStream: vue.ref(null), commitStream() {}, preferredQuality: vue.ref('128k'), preferredSource: vue.ref('auto') },
      '@renderer/core/dislikeList': {}, '@common/platformMatching': { samePlayTrack: same },
      './queueContinuation': { ensureQueueContinuation: async() => true, filterQueueContinuation: list => list, notifyQueueContinuation() {} },
      './playbackIntent': { notifyPlaybackIntent() {} },
    })
    result.queue = load('src/renderer/ui/services/playbackQueue.ts', {
      '@common/constants': constants, '@common/platformMatching': { samePlayTrack: same },
      '@renderer/store/list/state': { allMusicList: cache }, '@renderer/store/list/action': { getListMusics: async id => cache.get(id) ?? [] },
      '@renderer/store/download/action': { getDownloadList: async() => [] },
      '@renderer/store/player/state': state, '@renderer/store/player/action': actions, '@renderer/store/setting': settingModule,
      '@renderer/core/player/action': core,
      '@renderer/core/player/playbackIntent': { notifyPlaybackIntent() {}, SESSION_PLAYBACK_QUEUE_PREFIX: 'session_playback_' },
      '@renderer/core/player/queueContinuation': { setQueueContinuation() {} },
    })
    if (mode === 'random') actions.addPlayedList({ ...state.playMusicInfo })
  })
  result.dispose = () => scope.stop()
  return result
}

async function main() {
  let state = harness()
  state.repeat.setRepeatMode('singleLoop')
  assert.equal(state.setting['player.togglePlayMethod'], 'random', 'changing repeat keeps shuffle enabled')
  assert.equal((await state.core.getNextPlayMusicInfo()).musicInfo.id, 'a')
  await state.core.playNext(true)
  assert.equal(state.playMusicInfo.musicInfo.id, 'a', 'automatic repeat-one replays the actual current song')
  await state.core.playNext()
  assert.equal(state.playMusicInfo.musicInfo.id, 'b', 'manual Next still advances through shuffle')
  state.dispose()

  state = harness()
  assert.equal((await state.core.getNextPlayMusicInfo()).musicInfo.id, 'b')
  state.repeat.setRepeatMode('singleLoop')
  assert.equal((await state.core.getNextPlayMusicInfo()).musicInfo.id, 'a', 'repeat changes invalidate a prefetched random successor')
  state.repeat.setRepeatMode('list')
  await state.core.playNext(true)
  assert.equal(state.playMusicInfo.musicInfo.id, 'b')
  await state.core.playNext(true)
  assert.equal(state.playMusicInfo.musicInfo.id, 'c')
  assert.equal(await state.core.getNextPlayMusicInfo(), null, 'shuffle without repeat has no successor after one complete cycle')
  const pauses = state.pauses
  await state.core.playNext(true)
  assert.equal(state.pauses, pauses + 1)
  assert.equal(state.playMusicInfo.musicInfo.id, 'c', 'end-of-queue retains the final song and pauses')
  state.repeat.setRepeatMode('listLoop')
  assert.ok(await state.core.getNextPlayMusicInfo(), 'repeat-all starts another randomized cycle')
  state.dispose()

  state = harness('listLoop')
  state.repeat.setRepeatMode('singleLoop')
  assert.equal(state.setting['player.togglePlayMethod'], 'singleLoop')
  assert.deepEqual(state.saved, ['singleLoop'])
  state.setting['player.togglePlayMethod'] = 'list'
  assert.equal(state.repeat.repeatMode.value, 'list', 'legacy playback-mode changes update the separate repeat control')
  state.dispose()

  for (const downloads of [false, true]) {
    for (const index of [0, 1, 2]) {
      state = harness('singleLoop', index, downloads)
      const current = state.playMusicInfo.musicInfo
      assert.equal(state.queue.removePlaybackQueueTrack('library', current), true)
      assert.strictEqual(state.playMusicInfo.musicInfo, current, 'queue deletion preserves the existing audio identity')
      assert.equal(state.resources.length, 0)
      const expected = state.tracks[(index + 1) % state.tracks.length]
      assert.strictEqual((await state.core.getNextPlayMusicInfo()).musicInfo, expected, 'prefetch advances past a removed current song')
      await state.core.playNext(true)
      assert.strictEqual(state.playMusicInfo.musicInfo, expected, 'single repeat resumes at the successor after the removed current song finishes')
      state.dispose()
    }
  }

  state = harness('random', 1)
  state.repeat.setRepeatMode('list')
  state.queue.removePlaybackQueueTrack('library', state.tracks[2])
  assert.equal((await state.core.getNextPlayMusicInfo()).musicInfo.id, 'a', 'editing a random queue retains the current song in played history')
  state.dispose()

  state = harness()
  state.repeat.setRepeatMode('list')
  state.tracks.push({ ...state.tracks[0], source: 'tx' })
  await state.core.playNext(true)
  await state.core.playNext(true)
  await state.core.playNext(true)
  assert.equal(state.playMusicInfo.musicInfo.source, 'tx', 'equal ids from different providers remain distinct queue entries')
  assert.equal(await state.core.getNextPlayMusicInfo(), null)
  state.dispose()
  console.log('Full-player navigation checks passed: independent shuffle/repeat, automatic/manual Next, prefetch invalidation, cycle exhaustion and detached queue playback/downloads.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
