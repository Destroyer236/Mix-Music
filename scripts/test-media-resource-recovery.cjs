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
const track = (source = 'tx', id = 'same') => ({ source, id, name: 'Song', singer: 'Singer', meta: { songId: id } })
const tick = async() => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const song = track()
  const state = {
    playMusicInfo: vue.shallowReactive({ musicInfo: song }),
    musicInfo: { id: song.id },
    isPlay: vue.ref(false),
    playedList: [],
    tempPlayList: [],
    playInfo: {},
  }
  const setting = vue.reactive({ 'player.playQuality': 'auto', 'player.preferredSource': 'auto', 'player.autoSkipOnError': false })
  const bus = new EventEmitter()
  bus.setProgress = () => {}
  bus.pause = () => bus.emit('pause')
  bus.stop = () => bus.emit('stop')
  bus.error = () => bus.emit('error')
  global.window = { lx: { isPlayedStop: false }, app_event: bus, i18n: { t: value => value } }
  global.document = { hidden: false }
  const f = { state, setting, song, bus, resources: [], stops: 0, time: 72, autoplay: true, url: '', requests: [], ipcRequests: [], pending: [], status: '' }
  f.playback = load('src/renderer/ui/services/platformPlayback.ts', {
    electron: { ipcRenderer: { invoke: async(channel, payload) => { f.ipcRequests.push({ channel, payload }) } } },
    vue,
    '@common/platformPlayback': load('src/common/platformPlayback.ts'),
    '@common/platformSources': load('src/common/platformSources.ts'),
    '@renderer/store/player/state': state,
    '@renderer/store/setting': { appSetting: setting, mergeSetting: patch => Object.assign(setting, patch) },
    '@renderer/utils/ipc': { updateSetting: async() => {} },
  })
  const commit = (url, isTrial = false) => { f.playback.acceptStream(state.playMusicInfo.musicInfo, { url, isTrial, platform: 'qq', musicInfo: song, type: '128k' }, setting['player.playQuality']); f.playback.commitStream(state.playMusicInfo.musicInfo, url, setting['player.playQuality']); f.url = url }
  f.commit = commit
  commit('https://audio.test/official.mp3')
  const plugins = {
    getAutoplay: () => f.autoplay,
    getCurrentTime: () => f.time,
    getResourceTime: () => f.time,
    isEmpty: () => !f.url,
    setStop: () => { f.stops++; f.url = ''; f.time = 0 },
    setPause: () => { f.autoplay = false },
    setPlay: () => { f.autoplay = true },
    setResource: (url, options) => { f.resources.push({ url, options }); f.url = url; if (options) { f.autoplay = options.autoplay; f.time = options.time } },
  }
  f.core = load('src/renderer/core/player/action.ts', {
    '@renderer/plugins/player': plugins,
    '@renderer/store/player/state': state,
    '@renderer/store/player/action': { setAllStatus: value => { f.status = value } },
    '@renderer/store/setting': { appSetting: setting },
    '../music/index': { getMusicUrl: request => { f.requests.push(request); return new Promise((resolve, reject) => f.pending.push({ resolve, reject })) } },
    './utils': {},
    '@renderer/utils/message': {},
    '@renderer/utils/index': {},
    '@renderer/ui/services/platformAccounts': {},
    '@renderer/ui/services/platformPlayback': f.playback,
    '@renderer/core/dislikeList': {},
    '@common/platformMatching': {},
    './queueContinuation': {},
    './playbackIntent': {},
    '@renderer/store/player/repeatMode': { repeatMode: vue.ref('listLoop') },
  })
  f.plugins = plugins
  return f
}
async function main() {
  let f = fixture()
  let recovery = f.core.recoverCurrentResource()
  const duplicate = f.core.recoverCurrentResource()
  assert.equal(f.requests.length, 1)
  assert.deepEqual(f.requests[0].rejectedUrls, ['https://audio.test/official.mp3'])
  f.pending[0].resolve('https://audio.test/imported.flac')
  assert.equal(await recovery, true)
  assert.equal(await duplicate, true)
  assert.deepEqual(f.resources[0], { url: 'https://audio.test/imported.flac', options: { time: 72, autoplay: true } })
  f.time = 91
  recovery = f.core.recoverCurrentResource()
  assert.deepEqual(f.requests[1].rejectedUrls, ['https://audio.test/official.mp3', 'https://audio.test/imported.flac'])
  f.core.pause()
  f.pending[1].resolve('https://audio.test/imported-next.flac')
  assert.equal(await recovery, true)
  assert.deepEqual(f.resources[1].options, { time: 91, autoplay: false }, 'Pause during resolution must not restart playback')
  recovery = f.core.recoverCurrentResource()
  f.pending[2].resolve('https://audio.test/official.mp3')
  assert.equal(await recovery, false, 'a resolver returning a known bad URL must not create a media loop')
  assert.equal(f.resources.length, 2)
  assert.equal(await f.core.recoverCurrentResource(), false, 'duplicate failure for the same resource is exhausted')
  assert.equal(f.requests.length, 3)

  f = fixture()
  recovery = f.core.recoverCurrentResource()
  f.state.playMusicInfo.musicInfo = track('wy')
  f.pending[0].resolve('https://audio.test/late.mp3')
  assert.equal(await recovery, true)
  assert.equal(f.resources.length, 0, 'cross-platform same ID switch discards stale recovery')
  f = fixture()
  recovery = f.core.recoverCurrentResource()
  f.core.stop()
  f.pending[0].resolve('https://audio.test/late.mp3')
  await recovery
  assert.equal(f.resources.length, 0, 'Stop invalidates recovery')

  f = fixture()
  for (let i = 0; i < 16; i++) { f.commit('https://audio.test/' + i); assert.equal(f.playback.rejectCurrentPlaybackUrl(f.song).length, i + 1) }
  f.commit('https://audio.test/limit')
  assert.equal(f.playback.rejectCurrentPlaybackUrl(f.song), null)
  f.playback.resetPlaybackFailures()
  assert.equal(f.playback.rejectCurrentPlaybackUrl(f.song).length, 1)
  const ipcRejected = Array.from({ length: 18 }, (_, index) => 'https://audio.test/ipc-' + index)
  await f.playback.resolvePlatformStream(f.song, true, true, 'auto', { rejectedUrls: ipcRejected })
  assert.deepEqual(f.ipcRequests[0].payload.rejectedUrls, ipcRejected.slice(0, 16), 'media exclusions reach the resolver IPC in a bounded list')

  f = fixture()
  assert.equal(f.playback.rejectCurrentPlaybackUrl(f.song).length, 1)
  const qualityReload = f.core.reloadCurrentQuality()
  f.pending[0].resolve('https://audio.test/official.mp3')
  await qualityReload
  assert.equal(f.playback.rejectCurrentPlaybackUrl(f.song).length, 1, 'manual preference reload clears rejected URLs')
  f = fixture()
  recovery = f.core.recoverCurrentResource()
  f.setting['player.playQuality'] = 'flac'
  f.pending[0].resolve('https://audio.test/late-quality.mp3')
  await recovery
  assert.equal(f.resources.length, 0, 'preference change invalidates stale recovery')

  f = fixture()
  f.autoplay = false
  let pausedNotification = 0
  f.bus.on('pause', () => { pausedNotification++ })
  recovery = f.core.recoverCurrentResource()
  f.pending[0].resolve('https://audio.test/paused.mp3')
  await recovery
  assert.deepEqual(f.resources[0].options, { time: 72, autoplay: false }, 'a failed paused resource remains paused')
  assert.equal(pausedNotification, 1, 'paused recovery restores application status even when the audio element emits no pause event')

  f = fixture()
  let cleanups = []
  let skips = 0
  const events = load('src/renderer/core/useApp/usePlayer/usePlayEvent.ts', {
    '@common/utils/vueTools': { onBeforeUnmount: callback => cleanups.push(callback) },
    '@renderer/plugins/i18n': { useI18n: () => value => value },
    '@renderer/store/player/state': f.state,
    '@renderer/plugins/player': f.plugins,
    '@renderer/core/player': { ...f.core, playNext: async() => { skips++ } },
    '@renderer/store/player/action': { setAllStatus: value => { f.status = value } },
    '@renderer/store/setting': { appSetting: f.setting },
  }).default
  events()
  f.bus.emit('playerError', 3)
  f.bus.emit('playerError', 3)
  assert.equal(f.requests.length, 1, 'concurrent media errors share one recovery')
  f.pending[0].resolve('https://audio.test/imported-ok.mp3')
  await tick()
  assert.equal(f.resources[0].url, 'https://audio.test/imported-ok.mp3')
  const count = f.requests.length
  f.bus.emit('playerError', 1)
  await tick()
  assert.equal(f.requests.length, count, 'aborted media never starts recovery')
  f.bus.emit('playerError', 4)
  f.pending[1].reject(Error('all URLs exhausted'))
  await tick()
  assert.equal(f.status, 'all URLs exhausted', 'all failures keep the terminal error when auto-skip is off')
  assert.equal(skips, 0)
  f.setting['player.autoSkipOnError'] = true
  document.hidden = true
  f.bus.emit('playerError', 4)
  await tick()
  assert.equal(skips, 1, 'exhausted candidates retain existing auto-skip behavior')
  document.hidden = false
  cleanups.forEach(cleanup => cleanup())

  const progressFixture = fixture()
  cleanups = []
  const progress = { nowPlayTime: 72, maxPlayTime: 180 }
  const seeks = []
  load('src/renderer/core/useApp/usePlayer/usePlayProgress.ts', {
    '@common/utils/vueTools': { onBeforeUnmount: callback => cleanups.push(callback), watch() {} },
    '@common/utils/common': {},
    '@common/utils': { throttle: callback => callback },
    '@renderer/utils/ipc': { savePlayInfo() {} },
    '@renderer/plugins/player': { ...progressFixture.plugins, getDuration: () => 30, setCurrentTime: time => seeks.push(time), onTimeupdate: () => () => {}, onVisibilityChange: () => () => {} },
    '@renderer/store/player/playProgress': { playProgress: progress, setNowPlayTime: time => { progress.nowPlayTime = time }, setMaxplayTime: time => { progress.maxPlayTime = time } },
    '@renderer/store/player/state': progressFixture.state,
    '@renderer/store/setting': { appSetting: progressFixture.setting },
    '@renderer/core/player': {},
    '@renderer/store/list/action': {},
  }).default()
  progressFixture.bus.emit('error')
  progressFixture.bus.emit('setProgress', 0)
  progressFixture.bus.emit('playerPlaying')
  assert.deepEqual(seeks, [0], 'switching to preview at zero clears the previous error restore position')
  cleanups.forEach(cleanup => cleanup())
  console.log('Media URL recovery: exclusion, bounded retries, duplicate errors, autoplay/position, pause, stop and cross-platform stale guards passed.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
