const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const vue = require('vue')

function load(dependencies) {
  const file = path.resolve(__dirname, '../src/renderer/ui/services/playbackQueue.ts')
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
  return instance.exports
}

function harness(downloads = false) {
  const track = id => ({ id, source: 'wy', name: `Song ${id}`, singer: 'Singer', meta: {} })
  const original = ['a', 'b', 'c', 'd'].map(id => downloads ? { id: `download_${id}`, progress: 100, metadata: { musicInfo: track(id) }, isComplate: true } : track(id))
  const listId = downloads ? 'download' : 'library'
  const info = vue.reactive({ playerListId: listId, playerPlayIndex: 1, playIndex: 1 })
  const current = vue.shallowReactive({ musicInfo: original[1], listId, isTempPlay: false })
  const later = vue.shallowReactive([])
  const cache = new Map([[listId, original]])
  const state = { original, info, current, later, cache, events: [], intents: 0, resets: 0, plays: [], continuation: true }
  const same = (a, b) => a.id === b.id && ('progress' in a ? 'progress' in b : !('progress' in b) && a.source === b.source)
  global.window = { app_event: { myListUpdate: ids => state.events.push(ids) } }
  const scope = vue.effectScope()
  scope.run(() => {
    state.api = load({
      '@common/constants': { LIST_IDS: { DOWNLOAD: 'download' } },
      '@common/platformMatching': { samePlayTrack: same },
      '@renderer/store/list/state': { allMusicList: cache },
      '@renderer/store/list/action': { getListMusics: async id => cache.get(id) ?? [] },
      '@renderer/store/download/action': { getDownloadList: async() => original },
      '@renderer/store/player/state': { playInfo: info, playMusicInfo: current, tempPlayList: later },
      '@renderer/store/setting': { appSetting: {} },
      '@renderer/store/player/action': {
        addPlayedList: () => {},
        clearPlayedList: () => {},
        clearTempPlayeList: () => later.splice(0),
        getList: id => cache.get(id) ?? [],
        removeTempPlayList: index => later.splice(index, 1),
        setPlayListId: id => { info.playerListId = id },
      },
      '@renderer/core/player/action': {
        detachCurrentQueueTrack: () => {},
        resetRandomNextMusicInfo: () => state.resets++,
        playList: (id, index) => { state.plays.push(cache.get(id)[index]); later.splice(0) },
        playNext: async() => { state.plays.push(later.shift().musicInfo) },
      },
      '@renderer/core/player/playbackIntent': { notifyPlaybackIntent: () => state.intents++, SESSION_PLAYBACK_QUEUE_PREFIX: 'session_playback_' },
      '@renderer/core/player/queueContinuation': { setQueueContinuation: value => { state.continuation = value } },
    })
  })
  state.dispose = () => scope.stop()
  return state
}

async function main() {
  let state = harness()
  const current = state.current.musicInfo
  assert.equal(state.api.removePlaybackQueueTrack('library', state.original[0]), true)
  const sessionId = state.info.playerListId
  assert.ok(sessionId.startsWith('session_playback_editor_'))
  assert.deepEqual(state.original.map(track => track.id), ['a', 'b', 'c', 'd'], 'editing playback must not mutate a user playlist')
  assert.strictEqual(state.current.musicInfo, current, 'editing must keep the playing resource identity')
  assert.equal(state.current.listId, sessionId)
  assert.equal(state.current.isTempPlay, false)
  assert.equal(state.info.playerPlayIndex, 0)
  assert.equal(state.plays.length, 0, 'editing must not replay or pause audio')
  assert.equal(state.continuation, null, 'manual queue edits stop automatic recommendation append')
  assert.equal(state.api.removePlaybackQueueTrack(sessionId, current), true)
  assert.equal(state.current.isTempPlay, true, 'a removed current song plays to its natural end')
  assert.equal(state.info.playerPlayIndex, -1, 'the next song is the first remaining entry')
  assert.deepEqual(state.cache.get(sessionId).map(track => track.id), ['c', 'd'])
  assert.equal(state.events.length, 1, 'removing the current song must not trigger auto-next list watchers')
  state.info.playerListId = 'other-list'
  assert.equal(state.cache.has(sessionId), false, 'leave only the current editable queue in memory')
  assert.equal(state.cache.has('library'), true)
  state.dispose()

  state = harness(true)
  const snapshot = await state.api.readPlaybackQueue()
  assert.strictEqual(snapshot.tracks[0], state.original[0], 'download task objects must retain file metadata')
  assert.equal(state.api.removePlaybackQueueTrack('download', state.original[3]), true)
  assert.ok('progress' in state.cache.get(state.info.playerListId)[0], 'later navigation must keep using local download files')
  assert.deepEqual(state.api.queueTrackInfo(state.original[0]), state.original[0].metadata.musicInfo)
  state.dispose()

  state = harness()
  state.later.push({ musicInfo: state.original[3], listId: 'library', isTempPlay: true })
  assert.equal(state.api.clearPlaybackQueue('stale-list'), false)
  assert.equal(state.later.length, 1)
  assert.equal(state.api.clearPlaybackQueue('library'), true)
  assert.equal(state.later.length, 0)
  assert.equal(state.cache.get(state.info.playerListId).length, 0)
  assert.equal(state.original.length, 4)
  assert.strictEqual(state.current.musicInfo, state.original[1])
  assert.equal(state.current.isTempPlay, true)
  assert.equal(state.plays.length, 0)
  state.dispose()

  state = harness()
  const scheduled = { musicInfo: state.original[3], listId: 'library', isTempPlay: true }
  state.later.push(scheduled)
  assert.equal(state.api.playPlaybackQueueTrack('library', state.original[2]), true)
  assert.strictEqual(state.later[0], scheduled, 'clicking a queued song preserves Play Later')
  assert.equal(state.api.playPlaybackQueueTrack('stale-list', state.original[2]), false)
  state.later.unshift({ musicInfo: state.original[0], listId: 'library', isTempPlay: true })
  assert.equal(state.api.playLaterQueueTrack(1), true)
  assert.strictEqual(state.plays.at(-1), state.original[3])
  assert.equal(state.later.length, 1, 'playing one scheduled song retains the remaining schedule')
  assert.strictEqual(state.later[0].musicInfo, state.original[0])
  state.dispose()
  console.log('Playback queue regression checks passed (private edits, current audio, cleanup, downloads, stale actions, Play Later).')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
