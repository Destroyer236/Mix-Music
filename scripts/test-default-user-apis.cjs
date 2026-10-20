/* No automatic sources, retired preset migration and manual script persistence. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const zlib = require('node:zlib')
const ts = require('typescript')

const load = (relative, dependencies = {}) => {
  const file = path.resolve(__dirname, '..', relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file)
  return instance.exports
}
const clone = value => value === undefined ? undefined : structuredClone(value)
const script = (name = 'Downloaded fixture', version = '2.0.0') => `/**\n * @name ${name}\n * @version ${version}\n * @description Fixture source\n * @author Test\n * @homepage https://example.test/source\n */\nvoid 0;\n`
const packed = raw => 'gz_' + zlib.deflateSync(Buffer.from(raw)).toString('base64')
const imported = (id = 'user_api_existing') => ({ id, name: 'Existing source', description: 'User data', author: 'User', homepage: 'https://example.test/existing', version: '1.0.0', allowShowUpdateAlert: true, script: packed(script('Existing source', '1.0.0')) })
const sourceConfig = load('src/main/modules/userApi/config/index.ts', { '@common/userApiDefaults': load('src/common/userApiDefaults.ts') })
const retiredIds = ['qdy', 'sixyin', 'lx', 'flower', 'huibq', 'juhe'].map(key => `user_api_default_${key}`)
const remoteUrl = 'https://example.test/manual-source.js'
const remoteSource = () => ({ ...imported('user_api_manual_remote'), name: 'Remote manual source', script: '', scriptUrl: remoteUrl })
const fixture = (initial = {}, download = async() => script()) => {
  const state = clone(initial)
  const downloads = []
  const writes = []
  const store = { get: key => clone(state[key]), set: (key, value) => { state[key] = clone(value); writes.push({ key, value: clone(value) }) } }
  const api = load('src/main/modules/userApi/utils.ts', {
    './config': sourceConfig,
    './remoteScript': { downloadScript: async url => { downloads.push(url); return download(url) } },
    '@common/constants': { STORE_NAMES: { USER_API: 'test' } },
    '@main/utils/store': { __esModule: true, default: () => store },
  })
  return { api, state, downloads, writes }
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((resolveValue, rejectValue) => { resolve = resolveValue; reject = rejectValue })
  return { promise, resolve, reject }
}
const response = (chunks, statusCode = 200, headers = {}) => {
  let destroyed = false
  return {
    statusCode, headers,
    body: {
      async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield Buffer.from(chunk) },
      destroy: () => { destroyed = true },
    },
    get destroyed() { return destroyed },
  }
}

async function checkRemoteDownload() {
  const url = remoteUrl
  const chunks = response(['\uFEFF/**\n', ' * @name Test\n */'])
  const calls = []
  const remote = load('src/main/modules/userApi/remoteScript.ts', {
    '@common/utils/request': { request: async(...args) => { calls.push(args); return chunks } },
  })
  assert.equal(await remote.downloadScript(url), '/**\n * @name Test\n */')
  assert.equal(chunks.destroyed, true)
  assert.equal(calls[0][0], url)
  assert.equal(calls[0][1].timeout, 8000)
  assert.equal(calls[0][1].retryNum, 0)
  assert.equal(calls[0][1].maxRedirect, 3)
  assert.equal(calls[0][1].needBody, true)
  assert.ok(calls[0][1].signal instanceof AbortSignal)
  await assert.rejects(remote.downloadScript('http://example.test/source.js'), /HTTPS/)
  assert.equal(calls.length, 1, 'reject insecure descriptors before using the shared request transport')

  for (const [result, message] of [
    [response(['Not found'], 404), /HTTP 404/],
    [response([], 200, { 'content-length': String(2 * 1024 * 1024 + 1) }), /过大/],
    [response([Buffer.alloc(2 * 1024 * 1024), Buffer.from('x')]), /过大/],
    [response([]), /为空/],
  ]) {
    const helper = load('src/main/modules/userApi/remoteScript.ts', { '@common/utils/request': { request: async() => result } })
    await assert.rejects(helper.downloadScript(url), message)
    assert.equal(result.destroyed, true, 'always close response bodies after failure')
  }

  const networkFailure = load('src/main/modules/userApi/remoteScript.ts', { '@common/utils/request': { request: async() => { throw new Error('offline') } } })
  await assert.rejects(networkFailure.downloadScript(url), /offline/)
  let expire, clearCount = 0
  const nativeSetTimeout = global.setTimeout
  const nativeClearTimeout = global.clearTimeout
  const timed = load('src/main/modules/userApi/remoteScript.ts', {
    '@common/utils/request': { request: async(_, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) }) },
  })
  try {
    global.setTimeout = callback => { expire = callback; return {} }
    global.clearTimeout = () => { clearCount++ }
    const pending = timed.downloadScript(url)
    assert.equal(typeof expire, 'function')
    expire()
    await assert.rejects(pending, /下载超时/)
    assert.equal(clearCount, 1)
  } finally {
    global.setTimeout = nativeSetTimeout
    global.clearTimeout = nativeClearTimeout
  }
}

async function run() {
  assert.deepEqual([...sourceConfig.retiredDefaultSourceIds], retiredIds)
  assert.equal(sourceConfig.userApis, undefined, 'production config must not export any automatic source descriptors')
  assert.equal(sourceConfig.removeRetiredDefaultSourceSettings(), undefined)
  const manualSettings = { 'common.apiSource': 'user_api_manual', 'player.preferredSource': 'imported:user_api_manual', 'player.volume': 0.45 }
  assert.deepEqual(sourceConfig.removeRetiredDefaultSourceSettings(manualSettings), manualSettings)
  assert.deepEqual(sourceConfig.removeRetiredDefaultSourceSettings({ 'player.preferredSource': 'wy' }), { 'player.preferredSource': 'wy' })
  assert.deepEqual(sourceConfig.removeRetiredDefaultSourceSettings({}), {})
  for (const id of retiredIds) {
    const original = { 'common.apiSource': id, 'player.preferredSource': `imported:${id}`, 'player.volume': 0.45 }
    const before = clone(original)
    assert.deepEqual(sourceConfig.removeRetiredDefaultSourceSettings(Object.freeze(original)), { 'common.apiSource': '', 'player.preferredSource': 'auto', 'player.volume': 0.45 })
    assert.deepEqual(original, before, 'settings migration must not mutate input or unrelated preferences')
    assert.deepEqual(sourceConfig.removeRetiredDefaultSourceSettings({ ...manualSettings, 'common.apiSource': id }), { ...manualSettings, 'common.apiSource': '' })
    assert.deepEqual(sourceConfig.removeRetiredDefaultSourceSettings({ ...manualSettings, 'player.preferredSource': `imported:${id}` }), { ...manualSettings, 'player.preferredSource': 'auto' })
  }

  // Fresh installs and every historical marker value stay empty without fetching code.
  const fresh = fixture()
  const list = fresh.api.getUserApis()
  assert.deepEqual(list, [])
  assert.deepEqual(fresh.downloads, [])
  assert.equal(fresh.state.defaultSourcesVersion, undefined)
  assert.deepEqual(fresh.state.userApis, [])
  assert.strictEqual(fresh.api.getUserApis(), list)
  assert.deepEqual(fixture(fresh.state).api.getUserApis(), [], 'restart must not import descriptors')
  for (const marker of [undefined, 0, 1, 2, 9999]) {
    for (const initial of [{ defaultSourcesVersion: marker }, { userApis: [], defaultSourcesVersion: marker }]) {
      const empty = fixture(initial)
      assert.deepEqual(empty.api.getUserApis(), [])
      assert.deepEqual(empty.downloads, [])
      assert.deepEqual(fixture(empty.state).api.getUserApis(), [])
      assert.ok(!empty.writes.some(write => write.key === 'defaultSourcesVersion'), 'retired bootstrap markers must not be advanced')
    }
  }

  // Upgrade removes the exact six presets even after rename or script caching.
  // Matching names/URLs and the reserved-looking ID prefix cannot erase manual imports.
  const existing = imported()
  const retired = retiredIds.map((id, index) => ({ ...remoteSource(), id, name: 'My renamed source', script: index % 2 ? '' : existing.script }))
  const sameNameAndUrl = { ...remoteSource(), id: 'user_api_manual_same_name', name: retired[0].name, script: existing.script }
  const prefixedManual = imported('user_api_default_personal')
  const legacy = { id: 'user_api_legacy', script: script('Legacy source', '0.9'), allowShowUpdateAlert: true }
  const upgrade = fixture({ userApis: [retired[0], existing, ...retired.slice(1), sameNameAndUrl, prefixedManual, legacy], selectedSource: existing.id, defaultSourcesVersion: 9999 })
  const upgraded = upgrade.api.getUserApis()
  assert.deepEqual(upgraded.map(api => api.id), [existing.id, sameNameAndUrl.id, prefixedManual.id, legacy.id])
  assert.deepEqual(upgrade.state.userApis[0], existing)
  assert.deepEqual(upgrade.state.userApis[1], sameNameAndUrl)
  assert.deepEqual(upgrade.state.userApis[2], prefixedManual)
  assert.ok(upgrade.writes.some(write => write.key === 'userApis'), 'retired cached scripts must be removed from persistence')
  assert.ok(!upgrade.state.userApis.some(api => retiredIds.includes(api.id)))
  assert.equal(upgraded.find(api => api.id === legacy.id).name, 'Legacy source')
  assert.equal(upgraded.find(api => api.id === legacy.id).version, '0.9')
  assert.equal(upgrade.state.selectedSource, existing.id)
  assert.deepEqual(upgrade.downloads, [])
  assert.equal(await upgrade.api.getScript(existing.id), script('Existing source', '1.0.0'))
  for (const id of retiredIds) await assert.rejects(upgrade.api.getScript(id), /移除|删除|不存在|找不到/)
  assert.deepEqual(upgrade.downloads, [], 'retired presets must not be downloaded during migration or lookup')
  assert.deepEqual(fixture(upgrade.state).api.getUserApis(), upgraded)

  // Restoring old storage cannot revive presets regardless of its migration marker.
  for (const marker of [undefined, 0, 1, 2, 9999]) {
    const restored = fixture({ userApis: retired, defaultSourcesVersion: marker })
    assert.deepEqual(restored.api.getUserApis(), [])
    assert.deepEqual(restored.state.userApis, [])
    assert.deepEqual(restored.downloads, [])
    assert.deepEqual(fixture(restored.state).api.getUserApis(), [])
  }

  // Importing or getting a script before list enumeration must initialize storage.
  const coldImport = fixture({ userApis: [...retired, existing] })
  const added = await coldImport.api.importApi(script('New manual source'))
  assert.equal(coldImport.api.getUserApis().length, 2)
  assert.deepEqual(coldImport.state.userApis.find(api => api.id === existing.id), existing)
  assert.ok(coldImport.state.userApis.some(api => api.id === added.id))
  assert.deepEqual(coldImport.downloads, [])
  const coldCached = fixture({ userApis: [existing], defaultSourcesVersion: 1 })
  assert.equal(await coldCached.api.getScript(existing.id), script('Existing source', '1.0.0'))
  assert.deepEqual(coldCached.downloads, [])

  // Concurrent runtime windows share one download and persist compressed code.
  const download = deferred()
  const manual = remoteSource()
  const concurrent = fixture({ userApis: [manual] }, () => download.promise)
  const first = concurrent.api.getScript(manual.id)
  const second = concurrent.api.getScript(manual.id)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(concurrent.downloads, [remoteUrl])
  const downloaded = script('Downloaded fixture', '9.9.9')
  download.resolve(downloaded)
  assert.deepEqual(await Promise.all([first, second]), [downloaded, downloaded])
  const saved = concurrent.state.userApis.find(api => api.id === manual.id)
  assert.match(saved.script, /^gz_/)
  assert.equal(zlib.inflateSync(Buffer.from(saved.script.slice(3), 'base64')).toString(), downloaded)
  assert.equal(saved.name, 'Downloaded fixture')
  assert.equal(saved.version, '9.9.9')
  const restarted = fixture(concurrent.state, async() => { throw new Error('network should not be used') })
  assert.equal(await restarted.api.getScript(manual.id), downloaded)
  assert.deepEqual(restarted.downloads, [])

  // Failures do not poison the pending entry or persist invalid responses.
  let attempts = 0
  const retry = fixture({ userApis: [manual] }, async() => { if (++attempts === 1) throw new Error('temporary network failure'); return downloaded })
  await assert.rejects(retry.api.getScript(manual.id), /temporary network failure/)
  assert.equal(retry.state.userApis.find(api => api.id === manual.id).script, '')
  assert.equal(await retry.api.getScript(manual.id), downloaded)
  assert.equal(attempts, 2)
  let invalidAttempts = 0
  const invalid = fixture({ userApis: [manual] }, async() => ++invalidAttempts === 1 ? '<html>404</html>' : downloaded)
  await assert.rejects(invalid.api.getScript(manual.id), /无效|脚本/)
  assert.equal(invalid.state.userApis.find(api => api.id === manual.id).script, '')
  assert.equal(await invalid.api.getScript(manual.id), downloaded)

  // An in-flight download must never resurrect a source deleted by the user.
  const inflight = deferred()
  const removed = fixture({ userApis: [manual] }, () => inflight.promise)
  const loading = removed.api.getScript(manual.id)
  await new Promise(resolve => setImmediate(resolve))
  removed.api.removeApi([manual.id])
  inflight.resolve(downloaded)
  await assert.rejects(loading, /移除|删除|不存在|找不到/)
  assert.ok(!removed.api.getUserApis().some(api => api.id === manual.id))
  assert.ok(!removed.state.userApis.some(api => api.id === manual.id))
  assert.ok(!fixture(removed.state).api.getUserApis().some(api => api.id === manual.id))
  await checkRemoteDownload()
  console.log('User APIs: empty defaults, retired preset removal, manual import preservation, cold initialization, lazy cache, concurrent download, retry, removal race and bounded HTTP download passed.')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
