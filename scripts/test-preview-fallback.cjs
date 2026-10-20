/* Real resolver -> renderer stream commit -> media recovery, without accounts or network. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const EventEmitter = require('node:events')
const ts = require('typescript')
const vue = require('vue')
const root = path.resolve(__dirname, '..')
function load(relative, dependencies = {}) {
  const file = path.join(root, relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const native = instance.require.bind(instance)
  instance.require = id => Object.hasOwn(dependencies, id) ? dependencies[id] : native(id)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
  return instance.exports
}
const sources = load('src/common/platformSources.ts')
const { createPlaybackResolver } = load('src/main/modules/platformAccounts/playback.ts', {
  '@common/platformMatching': load('src/common/platformMatching.ts'),
  '@common/platformSources': sources,
})
const track = source => ({
  source, id: `${source}_1`, name: 'Song', singer: 'Singer', interval: '03:00',
  meta: { songId: 1, albumName: 'Album', qualitys: [], _qualitys: {} },
})
const fullUrl = 'https://audio.test/full.flac'
const trialUrl = 'https://audio.test/preview.mp3'
const tick = async() => new Promise(resolve => setImmediate(resolve))
function fixture({ complete = false, preview = true, quality = 'auto', nativePreview = false } = {}) {
  const song = track('tx')
  const f = { song, skips: 0, time: 72, url: '', autoplay: true, resources: [], requests: [], nativeRequests: [], cleanups: [], status: '', complete, preview, importedCalls: 0 }
  const states = ['tx', 'wy'].map(source => ({
    provider: {
      id: source, source, name: source,
      search: async() => [track(source)],
      async musicUrl(_context, _track, requestedQuality) {
        f.nativeRequests.push({ source, quality: requestedQuality })
        if (source === 'tx' && nativePreview && requestedQuality === '128k') return { url: trialUrl, type: '128k', quality: '128k', isTrial: true }
        if (source === 'tx' && f.complete) return { url: fullUrl, type: 'flac24bit' }
        if (source === 'wy' && f.preview) return { url: trialUrl, type: '128k', quality: '128k', isTrial: true, qualityLabel: '试听' }
        throw new Error('complete stream unavailable')
      },
    },
    context: {}, account: { connected: false }, tracks: [track(source)], generation: 0,
  }))
  const resolver = createPlaybackResolver(() => states, () => 'auto', () => [{
    id: 'imported', name: 'Imported', resolve: async() => { f.importedCalls++; throw new Error('imported unavailable') },
  }])
  const state = {
    playMusicInfo: vue.shallowReactive({ musicInfo: song }), musicInfo: { id: song.id },
    isPlay: vue.ref(false), playedList: [], tempPlayList: [], playInfo: {},
  }
  const setting = vue.reactive({ 'player.playQuality': quality, 'player.preferredSource': 'auto', 'player.autoSkipOnError': true })
  const bus = new EventEmitter()
  bus.setProgress = (...args) => bus.emit('setProgress', ...args)
  bus.pause = () => bus.emit('pause')
  bus.stop = () => bus.emit('stop')
  bus.error = () => bus.emit('error')
  global.window = { lx: { isPlayedStop: false }, app_event: bus, i18n: { t: key => key } }
  global.document = { hidden: true }
  const playback = load('src/renderer/ui/services/platformPlayback.ts', {
    electron: { ipcRenderer: { invoke: async(channel, payload) => {
      assert.equal(channel, 'platform_playback_resolve')
      f.requests.push(payload)
      return resolver.resolve(payload.track, payload.quality, payload.isRefresh, payload.allowToggleSource, { rejectedUrls: payload.rejectedUrls })
    } } },
    vue, '@common/platformPlayback': load('src/common/platformPlayback.ts'), '@common/platformSources': sources,
    '@renderer/store/player/state': state, '@renderer/store/setting': { appSetting: setting }, '@renderer/utils/ipc': {},
  })
  f.playback = playback
  const online = load('src/renderer/core/music/online.ts', {
    '@renderer/ui/services/streamValidation': { readStreamDuration: async() => 180, isTruncatedStream: () => false },
    '@renderer/store/list/action': {}, '@renderer/ui/services/platformPlayback': playback, '@renderer/utils/ipc': {}, './utils': {},
  })
  const music = load('src/renderer/core/music/index.ts', { './online': online, './download': {}, './local': {} })
  const plugins = {
    getAutoplay: () => f.autoplay, getCurrentTime: () => f.time, getResourceTime: () => f.time,
    isEmpty: () => !f.url, setStop: () => { f.url = ''; f.time = 0; bus.emit('playerEmptied') },
    setPause: () => { f.autoplay = false }, setPlay: () => { f.autoplay = true },
    setResource: (url, options) => {
      f.resources.push({ url, options }); f.url = url; f.time = options?.time ?? 0; f.autoplay = options?.autoplay ?? true
    },
  }
  const core = load('src/renderer/core/player/action.ts', {
    '@renderer/plugins/player': plugins, '@renderer/store/player/state': state,
    '@renderer/store/player/action': { setAllStatus: text => { f.status = text } }, '@renderer/store/setting': { appSetting: setting },
    '../music/index': music, './utils': {}, '@renderer/utils/message': { requestMsg: {} }, '@renderer/utils/index': {},
    '@renderer/ui/services/platformAccounts': {}, '@renderer/ui/services/platformPlayback': playback, '@renderer/core/dislikeList': {},
    '@common/platformMatching': {}, './queueContinuation': {}, './playbackIntent': {},
    '@renderer/store/player/repeatMode': { repeatMode: vue.ref('listLoop') },
  })
  f.core = core
  load('src/renderer/core/useApp/usePlayer/usePlayEvent.ts', {
    '@common/utils/vueTools': { onBeforeUnmount: fn => f.cleanups.push(fn) },
    '@renderer/plugins/i18n': { useI18n: () => key => key }, '@renderer/store/player/state': state,
    '@renderer/plugins/player': plugins, '@renderer/core/player': { ...core, playNext: async() => { f.skips++ } },
    '@renderer/store/player/action': { setAllStatus: text => { f.status = text } }, '@renderer/store/setting': { appSetting: setting },
  }).default()
  const progress = { nowPlayTime: 72, maxPlayTime: 180 }
  f.seeks = []
  load('src/renderer/core/useApp/usePlayer/usePlayProgress.ts', {
    '@common/utils/vueTools': { onBeforeUnmount: fn => f.cleanups.push(fn), watch() {} },
    '@common/utils/common': {}, '@common/utils': { throttle: fn => fn }, '@renderer/utils/ipc': { savePlayInfo() {} },
    '@renderer/plugins/player': { ...plugins, getDuration: () => 30, setCurrentTime: time => f.seeks.push(time), onTimeupdate: () => () => {}, onVisibilityChange: () => () => {} },
    '@renderer/store/player/playProgress': { playProgress: progress, setNowPlayTime: time => { progress.nowPlayTime = time }, setMaxplayTime: time => { progress.maxPlayTime = time } },
    '@renderer/store/player/state': state, '@renderer/store/setting': { appSetting: setting }, '@renderer/core/player': {}, '@renderer/store/list/action': {},
  }).default()
  f.bus = bus
  return f
}
async function main() {
  for (const quality of ['auto', '320k', 'flac']) {
    const f = fixture({ quality })
    f.core.setMusicUrl(f.song)
    await tick()
    assert.equal(f.resources.length, 1, `${quality}: official preview reaches the media element`)
    assert.equal(f.resources[0].url, trialUrl)
    assert.equal(f.playback.activeStream.value.isTrial, true, `${quality}: committed stream retains its preview badge`)
    assert.equal(f.playback.activeStream.value.musicInfo.source, 'wy')
    assert.equal(f.importedCalls, 1, `${quality}: imports are attempted before preview fallback`)
    assert.equal(f.skips, 0)
    f.bus.emit('playerCanplay')
    f.cleanups.forEach(fn => fn())
  }
  const f = fixture({ complete: true })
  f.core.setMusicUrl(f.song)
  await tick()
  assert.equal(f.resources[0].url, fullUrl, 'complete audio wins over an available official preview')
  f.time = 72
  f.bus.error()
  f.bus.emit('playerError', 3)
  await tick()
  assert.deepEqual(f.requests.at(-1).rejectedUrls, [fullUrl], 'media failure exclusions reach the real resolver')
  assert.equal(f.resources[1].url, trialUrl, 'an unusable complete URL falls back to the remaining official preview')
  assert.deepEqual(f.resources[1].options, { time: 0, autoplay: true }, 'preview recovery starts at zero instead of resuming beyond preview duration')
  assert.equal(f.playback.activeStream.value.isTrial, true)
  f.bus.emit('playerPlaying')
  assert.deepEqual(f.seeks, [0], 'the saved error position cannot seek past the preview after playback starts')
  assert.equal(f.skips, 0, 'successful preview recovery does not auto-skip even with the window hidden')
  f.bus.emit('playerError', 3)
  await tick()
  assert.deepEqual(f.requests.at(-1).rejectedUrls, [fullUrl, trialUrl])
  assert.equal(f.skips, 1, 'auto-skip happens only after both complete and preview URLs have failed')
  f.cleanups.forEach(fn => fn())

  const original = fixture({ complete: true, preview: false, nativePreview: true })
  original.core.setMusicUrl(original.song)
  await tick()
  assert.equal(original.resources[0].url, fullUrl)
  original.time = 72
  original.bus.error()
  original.bus.emit('playerError', 3)
  await tick()
  assert.equal(original.resources[1].url, trialUrl, 'a rejected high-quality URL must still query the same provider for its standard preview')
  assert.ok(original.nativeRequests.some(request => request.source === 'tx' && request.quality === '128k'))
  assert.deepEqual(original.resources[1].options, { time: 0, autoplay: true })
  assert.equal(original.playback.activeStream.value.isTrial, true)
  assert.equal(original.playback.preferredQuality.value, 'auto', 'preview fallback preserves the saved quality preference')
  assert.equal(original.skips, 0)
  original.bus.emit('playerCanplay')
  original.cleanups.forEach(fn => fn())
  console.log('Preview fallback: real resolver/renderer commits, quality preferences, imports, media recovery, progress reset and exhausted-only skip passed.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
