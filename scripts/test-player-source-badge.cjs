/* Exercise the real resource display transaction with isolated Vue stores and IPC. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')
const vue = require('vue')

function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const subject = new Module(filename, module)
  subject.filename = filename
  subject.paths = Module._nodeModulePaths(path.dirname(filename))
  const nativeRequire = subject.require.bind(subject)
  subject.require = id => Object.hasOwn(dependencies, id) ? dependencies[id] : nativeRequire(id)
  subject._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, filename)
  return subject.exports
}

const quality = load('src/common/platformPlayback.ts')
const sources = load('src/common/platformSources.ts')
const track = (id, source = 'wy') => ({ id: `${source}_${id}`, source, name: `歌曲 ${id}`, singer: '测试歌手', meta: { songId: id } })
const stream = (musicInfo, platform = 'qq', url = 'https://audio.example.test/song.flac') => ({ musicInfo, platform, url, type: 'flac', quality: 'flac', qualityLabel: '无损 · FLAC' })

function fixture() {
  const state = {
    setting: vue.reactive({ 'player.playQuality': 'auto', 'player.preferredSource': 'auto' }),
    player: vue.shallowReactive({ musicInfo: null }),
    requests: [],
    response: null,
  }
  state.api = load('src/renderer/ui/services/platformPlayback.ts', {
    electron: { ipcRenderer: { invoke: async(channel, payload) => { state.requests.push({ channel, payload }); return state.response } } },
    vue,
    '@common/platformPlayback': quality,
    '@common/platformSources': sources,
    '@renderer/store/player/state': { playMusicInfo: state.player },
    '@renderer/store/setting': { appSetting: state.setting, mergeSetting: patch => Object.assign(state.setting, patch) },
    '@renderer/utils/ipc': { updateSetting: async() => {} },
  })
  return state
}

test('preloading and acceptStream cache future sources without changing the playing source badge', async() => {
  const f = fixture()
  const current = track('current')
  const future = track('future', 'tx')
  f.player.musicInfo = current
  const currentStream = stream(current, 'netease')
  f.api.acceptStream(current, currentStream, 'auto')
  f.api.commitStream(current, currentStream.url, 'auto')
  const shown = f.api.activeStream.value
  const resource = f.api.activePlaybackResource.value
  f.response = stream(future, 'kugou', 'https://audio.example.test/next.flac')
  const resolved = await f.api.resolvePlatformStream(future, false, true)
  f.api.acceptStream(future, resolved, 'auto')
  assert.equal(f.api.activeStream.value, shown)
  assert.equal(f.api.activePlaybackResource.value, resource)
  assert.equal(f.api.activeStream.value.platform, 'netease')
  assert.equal(f.requests[0].channel, 'platform_playback_resolve')
})

test('only an actual resource commit displays cross-platform resolution and requested versus delivered quality', () => {
  const f = fixture()
  const catalogTrack = track('origin')
  const actualTrack = track('resolved', 'tx')
  const actualStream = stream(actualTrack, 'qq')
  f.player.musicInfo = catalogTrack
  f.api.acceptStream(catalogTrack, actualStream, 'auto')
  assert.equal(f.api.activeStream.value, null)
  f.api.commitStream(catalogTrack, actualStream.url, 'auto')
  assert.equal(f.api.activeStream.value.platform, 'qq')
  assert.equal(f.api.activeStream.value.musicInfo, actualTrack)
  assert.equal(f.api.activeStream.value.trackId, catalogTrack.id)
  assert.equal(f.api.activeStream.value.requested, 'auto')
  assert.equal(f.api.activeStream.value.quality, 'flac')
  assert.deepEqual(f.api.activePlaybackResource.value, { trackId: catalogTrack.id, local: false })
})

test('custom API sources keep their source label after the player commits their URL', () => {
  const f = fixture()
  const song = track('custom', 'kg')
  const custom = stream(track('matched', 'mg'), '自定义音源', 'https://custom.example.test/music.mp3')
  f.player.musicInfo = song
  f.api.acceptStream(song, custom, 'auto')
  f.api.commitStream(song, custom.url, 'auto')
  assert.equal(f.api.activeStream.value.platform, '自定义音源')
  assert.equal(f.api.activeStream.value.musicInfo.source, 'mg')
  assert.equal(f.api.activePlaybackResource.value.local, false)
})

test('local file playback clears an earlier online source even when cache entries exist', () => {
  const f = fixture()
  const song = track('local', 'local')
  const previous = stream(song)
  f.player.musicInfo = song
  f.api.acceptStream(song, previous, 'auto')
  f.api.commitStream(song, previous.url, 'auto')
  for (const url of ['file:///D:/Music/song.flac', 'D:\\Music\\song.flac', 'lx-file://music/song.flac']) {
    f.api.acceptStream(song, stream(song, 'netease', url), 'auto')
    f.api.commitStream(song, url, 'auto')
    assert.equal(f.api.activeStream.value, null)
    assert.deepEqual(f.api.activePlaybackResource.value, { trackId: song.id, local: true })
  }
})

test('download tasks use their task ID for current playback and original ID for cached online fallback', () => {
  const f = fixture()
  const original = track('download-origin')
  const task = { id: 'download-task-147', metadata: { musicInfo: original }, progress: { status: 'completed' } }
  const fallback = stream(track('matched-on-qq', 'tx'), 'qq', 'https://audio.example.test/fallback.flac')
  f.player.musicInfo = task
  f.api.acceptStream(original, fallback, 'auto')
  f.api.commitStream(task, fallback.url, 'auto')
  assert.equal(f.api.activeStream.value.platform, 'qq')
  assert.equal(f.api.activeStream.value.trackId, task.id)
  assert.deepEqual(f.api.activePlaybackResource.value, { trackId: task.id, local: false })
  f.api.commitStream(task, 'file:///D:/Downloads/song.flac', 'auto')
  assert.equal(f.api.activeStream.value, null)
  assert.deepEqual(f.api.activePlaybackResource.value, { trackId: task.id, local: true })
})

test('a download task-specific accepted resource wins over its original track cache', () => {
  const f = fixture()
  const original = track('original')
  const task = { id: 'download-specific', metadata: { musicInfo: original } }
  const fallback = stream(original, 'qq')
  const specific = stream(original, 'netease')
  f.player.musicInfo = task
  f.api.acceptStream(original, fallback, 'auto')
  f.api.acceptStream(task, specific, 'auto')
  f.api.commitStream(task, specific.url, 'auto')
  assert.equal(f.api.activeStream.value.platform, 'netease')
  assert.equal(f.api.activeStream.value.trackId, task.id)
})

test('late results from an old track cannot overwrite the current source or local-resource display', () => {
  const f = fixture()
  const oldTrack = track('old')
  const current = track('current', 'tx')
  f.player.musicInfo = current
  const actualStream = stream(current)
  f.api.acceptStream(current, actualStream, 'auto')
  f.api.commitStream(current, actualStream.url, 'auto')
  const displayed = f.api.activeStream.value
  const resource = f.api.activePlaybackResource.value
  const oldStream = stream(oldTrack, 'kugou')
  f.api.acceptStream(oldTrack, oldStream, 'auto')
  f.api.commitStream(oldTrack, oldStream.url, 'auto')
  f.api.commitStream(oldTrack, 'file:///old-track.flac', 'auto')
  assert.equal(f.api.activeStream.value, displayed)
  assert.equal(f.api.activePlaybackResource.value, resource)
})

test('late commits from an older requested quality preserve the newer display transaction', () => {
  const f = fixture()
  const song = track('quality')
  f.player.musicInfo = song
  f.setting['player.playQuality'] = 'flac'
  const current = stream(song, 'qq')
  f.api.acceptStream(song, current, 'flac')
  f.api.commitStream(song, current.url, 'flac')
  const shown = f.api.activeStream.value
  const resource = f.api.activePlaybackResource.value
  f.api.acceptStream(song, stream(song, 'netease'), 'auto')
  f.api.commitStream(song, current.url, 'auto')
  f.api.commitStream(song, 'file:///stale-quality.mp3', 'auto')
  assert.equal(f.api.activeStream.value, shown)
  assert.equal(f.api.activePlaybackResource.value, resource)
  assert.equal(shown.requested, 'flac')
})

test('a newly committed uncached online URL clears obsolete resolved source metadata', () => {
  const f = fixture()
  const song = track('uncached')
  const resolved = stream(song, 'qq')
  f.player.musicInfo = song
  f.api.acceptStream(song, resolved, 'auto')
  f.api.commitStream(song, resolved.url, 'auto')
  f.api.commitStream(song, 'HTTPS://audio.example.test/uncached.mp3', 'auto')
  assert.equal(f.api.activeStream.value, null)
  assert.deepEqual(f.api.activePlaybackResource.value, { trackId: song.id, local: false })
})
