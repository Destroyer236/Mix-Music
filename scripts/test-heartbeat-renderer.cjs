/* Heartbeat sessions use fake IPC and queue storage; no account or network is needed. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const vue = require('vue')

const root = path.resolve(__dirname, '..')
function load(relative, dependencies) {
  const file = path.join(root, relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file)
  return instance.exports
}

const defer = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async() => { for (let index = 0; index < 12; index++) await Promise.resolve() }
const track = (id, source = 'wy') => ({ id: `${source}_${id}`, source, name: `Song ${id}`, singer: 'Test', interval: '03:00', meta: { songId: id } })
const profile = id => ({ platform: 'netease', connected: true, profile: { id, nickname: 'Test' } })

function harness(loggedIn = true) {
  const event = new EventEmitter()
  global.window = { app_event: event, lx: { isPlayedStop: false } }
  const intent = load('src/renderer/core/player/playbackIntent.ts', {})
  const state = {
    snapshot: vue.shallowRef({ accounts: loggedIn ? [profile('account-a')] : [], favorites: [] }),
    playInfo: vue.reactive({ playerListId: null, playerPlayIndex: -1 }),
    playMusicInfo: vue.reactive({ musicInfo: null, isTempPlay: false }),
    setting: vue.reactive({ 'player.togglePlayMethod': 'random' }),
    tempMeta: { id: '' },
    queues: new Map([['temp', []]]),
    plays: [],
    requests: [],
    settings: [],
    initialized: 0,
    initialize: async() => {},
    fetch: async() => ({ accountId: 'account-a', playlistId: 'liked', seedId: '10', tracks: [track('10'), track('11')] }),
    read: async() => {},
    write: async() => {},
    save: async() => {},
    continuation: 'previous recommendation',
  }
  Object.defineProperty(state, 'queue', {
    get: () => state.queues.get(state.playInfo.playerListId) ?? state.queues.get('temp'),
    set: value => { state.queues.set('temp', value) },
  })
  const listState = { tempListMeta: state.tempMeta, allMusicList: state.queues }
  const listManage = {
    overwriteListMusics: async({ musicInfos }) => {
      await state.write(state.tempMeta.id, musicInfos)
      state.queues.set('temp', [...musicInfos])
      event.emit('myListUpdate', ['temp'])
    },
    getListMusics: async id => { await state.read(); return state.queues.get(id) ?? [] },
  }
  const listAction = load('src/renderer/store/list/action.ts', {
    '@common/constants': { LIST_IDS: { TEMP: 'temp' } },
    '@renderer/core/player/playbackIntent': intent,
    '@renderer/store/setting': { appSetting: state.setting },
    './state': listState,
    '@renderer/store/list/listManage': listManage,
  })
  const playerAction = {
    playList: (id, index) => {
      intent.notifyPlaybackIntent(id)
      state.playInfo.playerListId = id
      state.playInfo.playerPlayIndex = index
      state.playMusicInfo.musicInfo = state.queue[index]
      state.plays.push(state.queue[index].id)
    },
    togglePlay: () => {},
  }
  const dependencies = {
    '@common/constants': { LIST_IDS: { TEMP: 'temp' } },
    '@renderer/store/list/action': listAction,
    '@renderer/store/list/state': listState,
    '@renderer/store/player/state': { ...state, playInfo: state.playInfo, playMusicInfo: state.playMusicInfo, isPlay: vue.ref(false) },
    '@renderer/core/player/action': playerAction,
    '@renderer/core/player/playbackIntent': intent,
    '@renderer/core/player/queueContinuation': {
      setQueueContinuation: value => { state.continuation = value },
      hasQueueContinuation: () => state.continuation !== null,
    },
    './recommendationPlayback': { startRecommendationPlayback: () => { state.continuation = 'recommendation' } },
    '@renderer/store/setting': { appSetting: state.setting, mergeSetting: patch => Object.assign(state.setting, patch) },
    '@renderer/utils/ipc': { updateSetting: async patch => { state.settings.push(patch); await state.save(patch) } },
    './platformAccounts': {
      platformSnapshot: state.snapshot,
      initializePlatformAccounts: async() => { state.initialized++; await state.initialize() },
    },
    electron: { ipcRenderer: { invoke: async(channel, argument) => { state.requests.push({ channel, argument }); return state.fetch(argument) } } },
  }
  state.music = load('src/renderer/ui/services/music.ts', dependencies)
  state.api = load('src/renderer/ui/services/heartbeat.ts', { ...dependencies, './music': state.music })
  state.list = listAction
  state.core = load('src/renderer/core/player/action.ts', {
    ...dependencies,
    '@renderer/plugins/player': {},
    '@renderer/store/player/action': {
      getList: id => state.queues.get(id) ?? state.queue,
      setPlayListId: id => { state.playInfo.playerListId = id },
      setPlayMusicInfo: () => { state.playMusicInfo.musicInfo = null },
      clearPlayedList() {},
      clearTempPlayeList() {},
    },
    '../music/index': {},
    './utils': {},
    '@renderer/utils/message': {},
    '@renderer/utils/index': {},
    '@renderer/ui/services/platformAccounts': {},
    '@renderer/ui/services/platformPlayback': {},
    '@renderer/core/dislikeList': {},
    '@common/platformMatching': {},
    './queueContinuation': {},
    './playbackIntent': intent,
  })
  return state
}

async function main() {
  let pending
  let starting
  let state = harness(false)
  state.snapshot.value = { accounts: [{ platform: 'qq', connected: true, profile: { id: 'qq' } }], favorites: [] }
  assert.deepEqual(await state.api.toggleHeartbeat(), { message: '登录网易云音乐后才能使用心动模式', kind: 'warning' })
  assert.equal(state.requests.length, 0)
  assert.equal(state.api.heartbeatLoading.value, false)
  state.api.disposeHeartbeat()

  for (const method of ['listLoop', 'random', 'list', 'none', 'singleLoop']) {
    state = harness()
    state.setting['player.togglePlayMethod'] = method
    assert.equal((await state.api.toggleHeartbeat()).kind, 'success')
    const expected = method === 'singleLoop' ? 'singleLoop' : 'listLoop'
    assert.equal(state.setting['player.togglePlayMethod'], expected)
    assert.deepEqual(state.settings, [{ 'player.togglePlayMethod': expected }])
    assert.equal(state.api.heartbeatActive.value, true)
    await state.api.toggleHeartbeat()
    assert.equal(state.setting['player.togglePlayMethod'], expected, 'leaving heartbeat preserves the selected repeat mode')
    state.api.disposeHeartbeat()
  }

  state = harness()
  await state.api.toggleHeartbeat()
  state.setting['player.togglePlayMethod'] = 'singleLoop'
  assert.equal(state.api.heartbeatActive.value, true, 'switching to repeat-one keeps heartbeat active')
  state.setting['player.togglePlayMethod'] = 'listLoop'
  assert.equal(state.api.heartbeatActive.value, true, 'switching to repeat-list keeps heartbeat active')
  state.setting['player.togglePlayMethod'] = 'singleLoop'
  await state.api.toggleHeartbeat()
  assert.equal(state.setting['player.togglePlayMethod'], 'singleLoop')
  state.api.disposeHeartbeat()

  state = harness()
  pending = defer()
  state.fetch = () => pending.promise
  starting = state.api.toggleHeartbeat()
  await flush()
  state.setting['player.togglePlayMethod'] = 'singleLoop'
  pending.resolve({ accountId: 'account-a', tracks: [track('repeat-one-request')] })
  assert.equal((await starting).kind, 'success')
  assert.equal(state.setting['player.togglePlayMethod'], 'singleLoop', 'entry reads repeat mode at the synchronous playback commit')
  assert.deepEqual(state.settings, [{ 'player.togglePlayMethod': 'singleLoop' }])
  state.api.disposeHeartbeat()

  for (const select of [
    state => state.core.playList('library', 0),
    state => state.core.playListById('library', state.queue[0].id),
    state => state.list.setTempList('legacy-library', [track('direct-library')]),
  ]) {
    state = harness()
    state.queue = [track('ordinary-library')]
    pending = defer()
    state.fetch = () => pending.promise
    starting = state.api.toggleHeartbeat()
    await flush()
    await select(state)
    pending.resolve({ accountId: 'account-a', tracks: [track('stale-heartbeat')] })
    assert.equal(await starting, undefined)
    assert.equal(state.queue.some(item => item.id === 'wy_stale-heartbeat'), false)
    assert.equal(state.api.heartbeatActive.value, false)
    assert.equal(state.api.heartbeatLoading.value, false)
    state.api.disposeHeartbeat()
  }

  state = harness()
  pending = defer()
  const reading = defer()
  state.read = async() => { reading.resolve(); await pending.promise }
  const readingOrdinary = state.music.playTracks([track('ordinary-reading')])
  await reading.promise
  starting = state.api.toggleHeartbeat()
  pending.resolve()
  await readingOrdinary
  assert.equal((await starting).kind, 'success')
  assert.deepEqual(state.plays, ['wy_10'], 'a stale ordinary queue read cannot replace a newer heartbeat selection')
  assert.equal(state.queues.get('temp')[0].id, 'wy_ordinary-reading', 'heartbeat never writes the ordinary temporary queue')
  state.api.disposeHeartbeat()

  state = harness()
  await state.api.toggleHeartbeat()
  await state.music.toggleRecommendationPlayback([track('rec')], 'all')
  assert.equal(state.api.heartbeatActive.value, false)
  assert.equal(state.continuation, 'recommendation')
  assert.deepEqual(state.plays, ['wy_10', 'wy_rec'])
  state.api.disposeHeartbeat()

  state = harness()
  pending = defer()
  const saving = defer()
  state.save = async() => { saving.resolve(); await pending.promise }
  starting = state.api.toggleHeartbeat()
  await saving.promise
  assert.deepEqual(state.plays, ['wy_10'], 'queue/order commit does not wait for setting persistence')
  state.setting['player.togglePlayMethod'] = 'random'
  await state.music.playTracks([track('normal-after-heartbeat', 'qq')])
  pending.resolve()
  assert.equal(await starting, undefined)
  assert.equal(state.setting['player.togglePlayMethod'], 'random')
  assert.equal(state.queue[0].id, 'qq_normal-after-heartbeat')
  state.api.disposeHeartbeat()

  state = harness(false)
  state.initialize = async() => { state.snapshot.value = { accounts: [profile('account-a')], favorites: [] } }
  state.playMusicInfo.musicInfo = track('123')
  assert.equal((await state.api.toggleHeartbeat()).kind, 'success')
  assert.equal(state.initialized, 1)
  assert.deepEqual(state.requests, [{ channel: 'platform_netease_heartbeat', argument: { seedId: '123' } }])
  assert.equal(state.setting['player.togglePlayMethod'], 'listLoop')
  assert.deepEqual(state.plays, ['wy_10'])
  assert.equal(state.queue.length, 2)
  assert.equal(state.continuation, null)
  assert.equal(state.api.heartbeatActive.value, true)
  assert.equal(state.api.heartbeatLoading.value, false)
  const retainedQueue = state.queue
  assert.equal((await state.api.toggleHeartbeat()).kind, 'info')
  assert.equal(state.api.heartbeatActive.value, false)
  assert.equal(state.queue, retainedQueue)
  assert.deepEqual(state.plays, ['wy_10'])
  state.api.disposeHeartbeat()

  state = harness()
  pending = defer()
  state.fetch = () => pending.promise
  starting = state.api.toggleHeartbeat()
  await flush()
  assert.equal(state.api.heartbeatLoading.value, true)
  await state.music.playTracks([track('ordinary', 'qq')])
  pending.resolve({ accountId: 'account-a', tracks: [track('stale')] })
  assert.equal(await starting, undefined)
  assert.deepEqual(state.plays, ['qq_ordinary'])
  assert.equal(state.queue[0].id, 'qq_ordinary')
  assert.equal(state.api.heartbeatActive.value, false)
  assert.equal(state.api.heartbeatLoading.value, false)
  state.api.disposeHeartbeat()

  state = harness()
  const originalTemporaryQueue = [track('old-temporary')]
  state.queue = originalTemporaryQueue
  state.write = async() => { throw new Error('Heartbeat must not send an ordinary queue overwrite') }
  await state.api.toggleHeartbeat()
  const firstMemoryId = state.playInfo.playerListId
  assert.match(firstMemoryId, /^session_playback_heartbeat_/)
  assert.equal(state.queues.get('temp'), originalTemporaryQueue)
  state.core.playList(firstMemoryId, 1)
  assert.equal(state.api.heartbeatActive.value, true, 'selection within the heartbeat queue keeps the mode')
  state.core.playListById(firstMemoryId, 'wy_10')
  assert.equal(state.api.heartbeatActive.value, true)
  await state.api.toggleHeartbeat()
  assert.equal(state.queues.has(firstMemoryId), true, 'exiting keeps the current delivered queue')
  for (let iteration = 0; iteration < 8; iteration++) {
    await state.api.toggleHeartbeat()
    assert.equal([...state.queues.keys()].filter(id => id.startsWith('session_playback_')).length, 1)
    await state.api.toggleHeartbeat()
  }
  assert.equal(state.queues.has(firstMemoryId), false, 'successful replacement releases the earlier session cache')
  state.queues.set('library', [track('library-selection')])
  state.core.playList('library', 0)
  assert.equal([...state.queues.keys()].filter(id => id.startsWith('session_playback_')).length, 0)
  assert.equal(state.queues.get('temp'), originalTemporaryQueue)
  state.api.disposeHeartbeat()

  state = harness()
  pending = defer()
  state.fetch = () => pending.promise
  starting = state.api.toggleHeartbeat()
  await flush()
  assert.equal((await state.api.toggleHeartbeat()).kind, 'info')
  pending.resolve({ accountId: 'account-a', tracks: [track('cancelled')] })
  assert.equal(await starting, undefined)
  assert.deepEqual(state.plays, [])
  state.api.disposeHeartbeat()

  for (const accounts of [[], [profile('account-b')]]) {
    state = harness()
    pending = defer()
    state.fetch = () => pending.promise
    starting = state.api.toggleHeartbeat()
    await flush()
    state.snapshot.value = { accounts, favorites: [] }
    pending.resolve({ accountId: 'account-a', tracks: [track('old-account')] })
    assert.equal(await starting, undefined)
    assert.deepEqual(state.plays, [])
    assert.equal(state.api.heartbeatLoading.value, false)
    state.api.disposeHeartbeat()
  }

  for (const invalidate of [
    state => { state.snapshot.value = { accounts: [], favorites: [] } },
    state => { state.snapshot.value = { accounts: [profile('account-b')], favorites: [] } },
    state => { state.setting['player.togglePlayMethod'] = 'random' },
    state => { state.setting['player.togglePlayMethod'] = 'list' },
    state => { state.setting['player.togglePlayMethod'] = 'none' },
    state => { state.core.playList('ordinary-list', 0) },
    state => { void state.list.setTempList('local-library', [track('new-library')]) },
  ]) {
    state = harness()
    await state.api.toggleHeartbeat()
    const tracks = state.queue
    invalidate(state)
    assert.equal(state.api.heartbeatActive.value, false)
    if (state.playInfo.playerListId.startsWith('session_playback_')) assert.equal(state.queue, tracks)
    assert.deepEqual(state.plays, ['wy_10'])
    state.api.disposeHeartbeat()
    assert.equal(window.app_event.listenerCount('myListUpdate'), 0)
  }

  state = harness()
  state.fetch = async() => { throw new Error("Error invoking remote method 'platform_netease_heartbeat': Error: 登录已失效，请重新登录") }
  assert.deepEqual(await state.api.toggleHeartbeat(), { kind: 'warning', message: '登录已失效，请重新登录' })
  assert.equal(state.api.heartbeatLoading.value, false)
  assert.deepEqual(state.plays, [])
  state.api.disposeHeartbeat()

  state = harness()
  state.fetch = async() => ({ accountId: 'account-b', tracks: [track('wrong-account')] })
  assert.match((await state.api.toggleHeartbeat()).message, /账号已变化/)
  assert.deepEqual(state.plays, [])
  state.api.disposeHeartbeat()

  let restoredListReads = 0
  global.window = { lx: {}, lxData: {}, app_event: {} }
  const dataInit = load('src/renderer/core/useApp/useDataInit.ts', {
    '@renderer/utils/ipc': { getPlayInfo: async() => ({ listId: 'session_playback_heartbeat_1', index: 0 }) },
    '@renderer/utils/musicSdk': { default: { init() {} } },
    '@common/utils': { log: { error(error) { throw error } } },
    '@renderer/store/list/action': {
      getListMusics: async() => { restoredListReads++; return [] },
      getUserLists: async() => [],
      registerAction: () => () => {},
    },
    './useInitUserApi': { default: () => async() => {} },
    '@renderer/core/player': {},
    '@renderer/core/player/playbackIntent': load('src/renderer/core/player/playbackIntent.ts', {}),
    '@common/utils/vueTools': { onBeforeUnmount() {} },
    '@renderer/store/setting': { appSetting: {} },
    '@renderer/store/player/state': {},
    '@renderer/core/dislikeList': { initDislikeInfo: async() => {}, registerRemoteDislikeAction: () => () => {} },
    '@renderer/ui/services/platformAccounts': { initializePlatformAccounts: async() => {}, disposePlatformAccounts() {} },
  })
  await dataInit.default()()
  assert.equal(restoredListReads, 0, 'a session queue is never fetched as a persisted database list on restart')

  console.log('Heartbeat renderer contracts passed: login, queue/order, exit, account isolation and stale request races')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
