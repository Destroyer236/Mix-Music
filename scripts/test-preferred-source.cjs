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

  const defaultSetting = load('src/common/defaultSetting.ts').default
  assert.equal(defaultSetting['player.preferredSource'], 'auto')
  const schema = load('src/renderer/ui/settings/schema.ts', {
    '@common/defaultSetting': { default: defaultSetting, __esModule: true },
    '@common/config': { windowSizeList: [] }, '@root/lang': { langList: [] },
    '@common/platformSources': sources,
    '@common/platformPlayback': load('src/common/platformPlayback.ts'),
  })
  const field = schema.settingFields.find(item => item.key === 'player.preferredSource')
  assert.equal(field.category, 'playback')
  assert.equal(field.type, 'select')
  assert.equal(field.options.length, 8)
  assert.equal(schema.parseSettingValue(field, 'mg'), 'mg')
  assert.throws(() => schema.parseSettingValue(field, 'invalid'), /有效/)
  assert.deepEqual(schema.validateSettingBackup({ 'player.preferredSource': 'qs' }), { 'player.preferredSource': 'qs' })
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
