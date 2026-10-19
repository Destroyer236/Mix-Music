/* Playback preference contracts: mock providers only, no accounts or network. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const vue = require('vue')
const root = path.resolve(__dirname, '..')
function load(relative, dependencies = {}) {
  const file = path.join(root, relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file)
  return instance.exports
}
const sources = load('src/common/platformSources.ts')
const matching = load('src/common/platformMatching.ts')
const { createPlaybackResolver } = load('src/main/modules/platformAccounts/playback.ts', {
  '@common/platformMatching': matching,
  '@common/platformSources': sources,
})
const track = (source, extra = {}) => ({
  id: `${source}_1`, source, name: 'Song', singer: 'Singer', interval: '03:00',
  meta: { songId: 1, albumName: 'Album', qualitys: [], _qualitys: {} }, ...extra,
})
const full = source => ({ url: `https://example.test/${source}.flac`, type: 'flac', quality: 'flac' })
const trial = source => ({ ...full(source), isTrial: true, qualityLabel: '试听' })
function deferred() {
  let accept
  let fail
  const promise = new Promise((resolve, reject) => { accept = resolve; fail = reject })
  return { promise, resolve: accept, reject: fail }
}
const flushPromises = async() => { for (let index = 0; index < 20; index++) await Promise.resolve() }
function timedResolver() {
  let now = 0
  const timers = new Map()
  const { createPlaybackResolver } = load('src/main/modules/platformAccounts/playback.ts', {
    '@common/platformMatching': matching,
    '@common/platformSources': sources,
    'node:timers': {
      setTimeout(callback, delay) { const timer = {}; timers.set(timer, { callback, until: now + delay }); return timer },
      clearTimeout(timer) { timers.delete(timer) },
    },
  })
  return {
    create: createPlaybackResolver,
    async advance(delay) {
      now += delay
      for (const [timer, task] of [...timers]) {
        if (task.until > now || !timers.has(timer)) continue
        timers.delete(timer)
        task.callback()
        await flushPromises()
      }
    },
  }
}
const calls = []
function state(source, response = full(source), connected = false) {
  const candidate = track(source)
  return {
    provider: {
      id: source, source, name: source,
      search: async() => { calls.push(`search:${source}`); return [candidate] },
      musicUrl: async(_context, value, quality) => {
        calls.push(`play:${source}:${quality}`)
        assert.equal(value.source, source)
        if (response instanceof Error) throw response
        return typeof response === 'function' ? response() : response
      },
    },
    context: {}, account: { connected }, tracks: [candidate], generation: 0,
  }
}
async function main() {
  assert.equal(sources.isPreferredPlatformSource('qs'), true)
  assert.equal(sources.isPreferredPlatformSource('bo'), true)
  assert.equal(sources.isPreferredPlatformSource('constructor'), false)
  assert.equal(sources.isPreferredPlatformSource(null), false)
  let preferred = 'wy'
  let states = [state('tx'), state('wy'), state('kg', full('kg'), true)]
  let resolver = createPlaybackResolver(() => states, () => preferred)
  assert.equal((await resolver.resolve(track('tx'), 'flac')).musicInfo.source, 'wy')
  assert.deepEqual(calls.splice(0), ['play:wy:flac'])
  // Existing cached resources do not make an old preference authoritative.
  preferred = 'kg'
  assert.equal((await resolver.resolve(track('tx'), 'flac')).musicInfo.source, 'kg')
  assert.deepEqual(calls.splice(0), ['play:kg:flac'])
  preferred = 'auto'
  assert.equal((await resolver.resolve(track('tx'))).musicInfo.source, 'tx')
  calls.length = 0
  preferred = 'not-a-platform'
  assert.equal((await resolver.resolve(track('tx'), 'auto', true)).musicInfo.source, 'tx')
  assert.deepEqual(calls.splice(0), ['play:tx:auto'])
  preferred = 'wy'
  assert.equal((await resolver.resolve(track('tx'), 'auto', true, false)).musicInfo.source, 'tx')
  assert.deepEqual(calls.splice(0), ['play:tx:auto'])

  // Prefer a complete original over a preferred platform's paid preview.
  states = [state('tx'), state('wy', trial('wy')), state('kg')]
  resolver = createPlaybackResolver(() => states, () => preferred)
  assert.equal((await resolver.resolve(track('tx'))).musicInfo.source, 'tx')
  assert.deepEqual(calls.splice(0), ['play:wy:auto', 'play:tx:auto'])
  // Try connected fallback platforms before disconnected platforms.
  states = [state('tx', new Error('no rights')), state('wy', trial('wy')), state('kw'), state('kg', full('kg'), true)]
  resolver = createPlaybackResolver(() => states, () => preferred)
  assert.equal((await resolver.resolve(track('tx'))).musicInfo.source, 'kg')
  assert.deepEqual(calls.splice(0), ['play:wy:auto', 'play:tx:auto', 'play:kg:auto'])
  // Only after full streams fail, preserve the first official preview.
  states = [state('tx', trial('tx')), state('wy', trial('wy')), state('kg', new Error('no rights'))]
  resolver = createPlaybackResolver(() => states, () => preferred)
  const preview = await resolver.resolve(track('tx'))
  assert.equal(preview.musicInfo.source, 'wy')
  assert.equal(preview.isTrial, true)
  calls.length = 0
  // A native URL can resolve successfully but fail in the media element. Its
  // standard endpoint may still provide an official preview for the same song.
  {
    const native = state('tx')
    native.provider.musicUrl = async(_context, _track, quality) => {
      calls.push(`play:tx:${quality}`)
      return quality === '128k'
        ? { url: 'https://example.test/tx-preview.mp3', type: '128k', isTrial: true }
        : full('tx')
    }
    const brokenImport = { id: 'user_api_unavailable', name: 'Unavailable import', resolve: async() => { throw new Error('import unavailable') } }
    const recovery = createPlaybackResolver(() => [native], () => 'auto', () => [brokenImport])
    const recovered = await recovery.resolve(track('tx'), 'auto', true, true, { rejectedUrls: [full('tx').url] })
    assert.equal(recovered.isTrial, true, 'a rejected complete stream must not discard an available standard preview')
    assert.match(recovered.url, /tx-preview/)
    assert.deepEqual(calls.splice(0), ['play:tx:auto', 'play:tx:128k'])
    await assert.rejects(recovery.resolve(track('tx'), 'auto', true, true, { rejectedUrls: [full('tx').url, recovered.url] }), /已失效/)
    calls.length = 0
  }
  // Explicit source-only calls cannot search or play another platform.
  assert.equal((await resolver.resolve(track('tx'), 'auto', true, false)).musicInfo.source, 'tx')
  assert.deepEqual(calls.splice(0), ['play:tx:auto'])
  // A different recording is never substituted simply to honor preference.
  const wrong = state('wy')
  wrong.tracks = [track('wy', { name: 'Song (Live)' })]
  wrong.provider.search = async() => wrong.tracks
  states = [state('tx'), wrong]
  resolver = createPlaybackResolver(() => states, () => preferred)
  assert.equal((await resolver.resolve(track('tx'))).musicInfo.source, 'tx')
  assert.deepEqual(calls.splice(0), ['play:tx:auto'])
  // A trial cannot survive a logout while another platform is being checked.
  const original = state('tx', trial('tx'))
  states = [original, state('wy', () => { original.generation++; throw new Error('no rights') })]
  resolver = createPlaybackResolver(() => states)
  await assert.rejects(resolver.resolve(track('tx')), /no rights/)
  calls.length = 0

  // Automatic source selection compares the actual returned quality tiers.
  const standard = source => ({ url: `https://example.test/${source}.mp3`, type: '128k', quality: '128k' })
  preferred = 'auto'
  states = [state('tx', standard('tx')), state('kg', full('kg'))]
  resolver = createPlaybackResolver(() => states, () => preferred)
  assert.equal((await resolver.resolve(track('tx'))).musicInfo.source, 'kg')
  assert.deepEqual(calls.splice(0), ['play:tx:auto', 'play:kg:auto'])
  // A logged-in original source remains the first attempt in automatic mode.
  states = [state('tx', standard('tx'), true), state('kg', full('kg'), true)]
  resolver = createPlaybackResolver(() => states, () => preferred)
  assert.equal((await resolver.resolve(track('tx'))).musicInfo.source, 'tx')
  assert.deepEqual(calls.splice(0), ['play:tx:auto'])

  // Automatic lookups start together: a hanging native provider cannot stop an
  // imported source, and a timely Hi-Res response still wins the quality race.
  {
    const clock = timedResolver()
    const stalled = deferred()
    const hq = deferred()
    const hires = deferred()
    states = [state('tx', () => stalled.promise), state('kg', () => hq.promise)]
    const imported = { id: 'parallel-import', name: 'Parallel imported', resolve: () => hires.promise }
    resolver = clock.create(() => states, () => 'auto', () => [imported])
    let result
    const request = resolver.resolve(track('tx')).then(value => { result = value; return value })
    await flushPromises()
    assert.deepEqual(calls.splice(0), ['play:tx:auto', 'play:kg:auto'], 'native probes start before any previous platform finishes')
    hq.resolve(full('kg'))
    await flushPromises()
    assert.equal(result, undefined, 'a short collection window allows another source to return higher quality')
    hires.resolve({ ...full('import'), type: 'flac24bit', quality: 'flac24bit', platform: 'Parallel imported', musicInfo: track('tx') })
    await flushPromises()
    assert.equal((await request).platform, 'Parallel imported', 'the highest quality returns immediately without waiting for the stalled provider')
    stalled.resolve(full('tx'))
    await flushPromises()
  }
  // One playable source only waits 700 ms for higher quality, even when both
  // another native source and an imported script are stuck indefinitely.
  {
    const clock = timedResolver()
    const stuckNative = deferred()
    const stuckImport = deferred()
    states = [state('tx', standard('tx')), state('kg', () => stuckNative.promise)]
    const imported = { id: 'slow-import', name: 'Slow imported', resolve: () => stuckImport.promise }
    resolver = clock.create(() => states, () => 'auto', () => [imported])
    let result
    const request = resolver.resolve(track('tx')).then(value => { result = value; return value })
    await flushPromises()
    await clock.advance(699)
    assert.equal(result, undefined)
    await clock.advance(1)
    assert.equal((await request).musicInfo.source, 'tx')
    stuckNative.resolve(full('kg'))
    stuckImport.resolve({ ...full('import'), platform: 'Slow imported', musicInfo: track('tx') })
    await flushPromises()
  }
  // When nobody returns complete audio, every source shares the same timeout
  // budget instead of adding one timeout per platform/import to the wait.
  {
    const clock = timedResolver()
    const stuck = deferred()
    states = [state('tx', () => stuck.promise), state('kg', () => stuck.promise)]
    resolver = clock.create(() => states)
    const request = assert.rejects(resolver.resolve(track('tx')), /音源响应超时/)
    await flushPromises()
    await clock.advance(6000)
    await request
    const callsBeforeRetry = calls.length
    await assert.rejects(resolver.resolve(track('tx')), /音源响应超时/)
    assert.equal(calls.length, callsBeforeRetry, 'an immediate automatic retry skips the same timed-out requests')
    stuck.resolve(full('tx'))
    await flushPromises()
  }
  calls.length = 0

  // Removing an imported source during the comparison window invalidates its
  // already resolved stream before the player chooses the final source.
  {
    const clock = timedResolver()
    const stuck = deferred()
    const imported = { id: 'removed-during-compare', name: 'Removed imported', resolve: async() => ({ ...full('import'), platform: 'Removed imported', musicInfo: track('tx') }) }
    let imports = [imported]
    states = [state('tx', standard('tx')), state('kg', () => stuck.promise)]
    resolver = clock.create(() => states, () => 'auto', () => imports)
    const request = resolver.resolve(track('tx'))
    await flushPromises()
    imports = []
    await clock.advance(700)
    assert.equal((await request).musicInfo.source, 'tx')
    stuck.resolve(full('kg'))
    await flushPromises()
  }
  calls.length = 0

  // Foreground playback shares the preloader's cross-platform search and URL
  // request, then reuses the successful match on later playback attempts.
  {
    const search = deferred()
    const stream = deferred()
    const alternative = state('kg', () => stream.promise)
    alternative.tracks = []
    let searches = 0
    alternative.provider.search = () => { searches++; return search.promise }
    states = [state('tx', new Error('no rights')), alternative]
    resolver = createPlaybackResolver(() => states)
    const first = resolver.resolve(track('tx'))
    const second = resolver.resolve(track('tx'))
    await flushPromises()
    assert.equal(searches, 1, 'a pending search is shared across playback/preload')
    search.resolve([track('kg')])
    await flushPromises()
    stream.resolve(full('kg'))
    await Promise.all([first, second])
    assert.equal(calls.filter(value => value === 'play:kg:auto').length, 1, 'matching requests share the same playback URL lookup')
    await resolver.resolve(track('tx'))
    assert.equal(searches, 1, 'the next playback reuses the exact recording match')
    alternative.generation++
    await resolver.resolve(track('tx'))
    assert.equal(searches, 2, 'an account generation change invalidates the saved match')
    await resolver.resolve(track('tx', { interval: '03:01' }))
    assert.equal(searches, 3, 'duration/version metadata participates in the match cache key')
  }
  calls.length = 0

  // Every imported LX script participates independently of the selected legacy API.
  const importedCalls = []
  const imported = { id: 'user_api_fixture', name: 'Fixture imported', resolve: async(value, quality, _states, refresh, allowToggleSource, options) => {
    importedCalls.push({ source: value.source, quality, refresh, allowToggleSource, options })
    return { ...full('imported'), platform: 'Fixture imported', musicInfo: value }
  } }
  preferred = 'imported:user_api_fixture'
  states = [state('tx')]
  resolver = createPlaybackResolver(() => states, () => preferred, () => [imported])
  assert.match((await resolver.resolve(track('tx'))).url, /imported/)
  assert.equal(importedCalls.length, 1, 'the preferred imported source runs before official providers')
  assert.deepEqual(calls.splice(0), [])
  preferred = 'auto'
  assert.equal((await resolver.resolve(track('tx'))).platform, 'tx')
  assert.equal(importedCalls.length, 2, 'auto mode keeps the higher or equal native stream ahead of imports')
  states = [state('tx', trial('tx'))]
  resolver = createPlaybackResolver(() => states, () => preferred, () => [imported])
  assert.match((await resolver.resolve(track('tx'))).url, /imported/)
  assert.equal(importedCalls.length, 3, 'imports beat official previews')
  states = [state('tx')]
  preferred = 'imported:removed'
  resolver = createPlaybackResolver(() => states, () => preferred, () => [imported])
  assert.equal((await resolver.resolve(track('tx'))).platform, 'tx', 'removed imported preferences fall back normally')
  // A cached or newly requested media URL rejected by the player cannot repeat.
  const rejectedUrls = [full('tx').url]
  assert.match((await resolver.resolve(track('tx'), 'auto', false, true, { rejectedUrls })).url, /imported/)
  assert.deepEqual(importedCalls.at(-1).options, { rejectedUrls })
  assert.match((await resolver.resolve(track('tx'), 'auto', true, true, { rejectedUrls })).url, /imported/)
  states = [state('tx', trial('tx'))]
  resolver = createPlaybackResolver(() => states, () => 'auto')
  await assert.rejects(resolver.resolve(track('tx'), 'auto', false, true, { rejectedUrls }), /已失效/)
  preferred = 'imported:user_api_fixture'
  states = [state('tx')]
  resolver = createPlaybackResolver(() => states, () => preferred, () => [imported])
  assert.equal((await resolver.resolve(track('tx'), 'auto', true, false)).platform, 'tx')
  const brokenImport = { ...imported, resolve: async() => ({ ...full('tx'), platform: 'Broken import', musicInfo: track('tx') }) }
  resolver = createPlaybackResolver(() => [], () => preferred, () => [brokenImport])
  await assert.rejects(resolver.resolve(track('tx'), 'auto', true, true, { rejectedUrls }), /已失效/)
  calls.length = 0

  const defaultSetting = load('src/common/defaultSetting.ts', {
    './externalLyric': load('src/common/externalLyric.ts'),
  }).default
  assert.equal(defaultSetting['player.preferredSource'], 'auto')
  const schema = load('src/renderer/ui/settings/schema.ts', {
    '@common/defaultSetting': { default: defaultSetting, __esModule: true },
    '@common/config': { windowSizeList: [] }, '@root/lang': { langList: [] },
    '@common/platformSources': sources,
    '@common/platformPlayback': load('src/common/platformPlayback.ts'),
  })
  const field = schema.settingFields.find(item => item.key === 'player.preferredSource')
  assert.equal(field.category, 'sources')
  assert.equal(field.type, 'select')
  assert.equal(field.options.length, 9)
  assert.deepEqual(field.options.find(option => option.value === 'bo'), { value: 'bo', label: '波点音乐' })
  assert.equal(schema.parseSettingValue(field, 'mg'), 'mg')
  assert.equal(schema.parseSettingValue(field, 'bo'), 'bo')
  assert.throws(() => schema.parseSettingValue(field, 'invalid'), /有效/)
  assert.deepEqual(schema.validateSettingBackup({ 'player.preferredSource': 'qs' }), { 'player.preferredSource': 'qs' })
  assert.deepEqual(schema.validateSettingBackup({ 'player.preferredSource': 'bo' }), { 'player.preferredSource': 'bo' })
  assert.deepEqual(schema.validateSettingBackup({ 'player.preferredSource': 'invalid' }), {})

  // Source and quality edits share the existing transactional reload path.
  const appSetting = vue.reactive({ 'player.playQuality': 'auto', 'player.preferredSource': 'auto' })
  let saved
  const playback = load('src/renderer/ui/services/platformPlayback.ts', {
    electron: { ipcRenderer: { invoke: async() => {} } },
    '@common/platformPlayback': load('src/common/platformPlayback.ts'),
    '@common/platformSources': sources,
    '@renderer/store/player/state': { playMusicInfo: {} },
    '@renderer/store/setting': { appSetting, mergeSetting: patch => Object.assign(appSetting, patch) },
    '@renderer/utils/ipc': { updateSetting: async patch => { saved = patch } },
  })
  let reloads = 0
  const observed = []
  const stop = playback.bindQualityReload(async() => { reloads++; observed.push([playback.preferredQuality.value, playback.preferredSource.value]) })
  await playback.setPreferredSource('wy')
  assert.deepEqual(saved, { 'player.preferredSource': 'wy' })
  assert.equal(reloads, 1)
  Object.assign(appSetting, { 'player.playQuality': 'flac', 'player.preferredSource': 'tx' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reloads, 2)
  assert.deepEqual(observed[1], ['flac', 'tx'])
  await assert.rejects(playback.setPreferredSource('invalid'), /有效/)
  stop()
  appSetting['player.preferredSource'] = 'kg'
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reloads, 2)
  console.log('Preferred source, full-before-trial fallback, and shared preference reload contracts passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
