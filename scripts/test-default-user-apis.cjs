/* Default source descriptors, migration, lazy download and persistence races. */
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
const defaults = load('src/main/modules/userApi/config/index.ts').userApis
const defaultIds = defaults.map(api => api.id)
const defaultUrls = ['qdy', 'sixyin', 'lx', 'flower', 'huibq', 'juhe'].map(key => `https://raw.githubusercontent.com/pdone/lx-music-source/main/${key}/latest.js`)
const fixture = (initial = {}, download = async() => script()) => {
  const state = clone(initial)
  const downloads = []
  const writes = []
  const store = { get: key => clone(state[key]), set: (key, value) => { state[key] = clone(value); writes.push({ key, value: clone(value) }) } }
  const api = load('src/main/modules/userApi/utils.ts', {
    './config': { userApis: clone(defaults) },
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
  const url = defaultUrls[0]
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
  assert.equal(defaults.length, 6)
  assert.deepEqual(defaults.map(api => api.scriptUrl), defaultUrls)
  assert.equal(new Set(defaultIds).size, 6)
  assert.ok(defaultIds.every(id => /^user_api_default_/.test(id)))
  assert.ok(defaults.every(api => api.script === ''))

  // Opening settings or enumerating playback candidates must never fetch code.
  const fresh = fixture()
  const list = fresh.api.getUserApis()
  assert.deepEqual(list.map(api => api.id), defaultIds)
  assert.deepEqual(fresh.downloads, [])
  assert.equal(fresh.state.defaultSourcesVersion, 2)
  assert.equal(fresh.state.userApis.length, 6)
  assert.ok(fresh.state.userApis.every(api => api.script === ''))
  assert.strictEqual(fresh.api.getUserApis(), list)
  assert.equal(fixture(fresh.state).api.getUserApis().length, 6, 'restart must not duplicate descriptors')

  // Existing installs gain defaults without replacing scripts or unrelated data.
  const existing = imported()
  const configuredDefault = { ...defaults[0], name: 'My renamed default', version: 'custom', script: existing.script, allowShowUpdateAlert: true }
  const legacy = { id: 'user_api_legacy', script: script('Legacy source', '0.9'), allowShowUpdateAlert: true }
  const upgrade = fixture({ userApis: [existing, configuredDefault, legacy], selectedSource: existing.id })
  const upgraded = upgrade.api.getUserApis()
  assert.equal(upgraded.length, 8)
  assert.deepEqual(upgrade.state.userApis[0], existing)
  assert.deepEqual(upgrade.state.userApis[1], configuredDefault)
  assert.equal(upgraded.find(api => api.id === legacy.id).name, 'Legacy source')
  assert.equal(upgraded.find(api => api.id === legacy.id).version, '0.9')
  assert.equal(upgrade.state.selectedSource, existing.id)
  assert.deepEqual(upgrade.downloads, [])
  assert.equal(await upgrade.api.getScript(existing.id), script('Existing source', '1.0.0'))

  // A one-time marker keeps intentional deletion intact, including an empty list.
  const deletedId = defaultIds[2]
  fresh.api.removeApi([deletedId])
  assert.ok(!fixture(fresh.state).api.getUserApis().some(api => api.id === deletedId))
  const allDeleted = fixture({ userApis: [], defaultSourcesVersion: 2 })
  assert.deepEqual(allDeleted.api.getUserApis(), [])
  assert.deepEqual(allDeleted.downloads, [])

  const versionOne = fixture({ userApis: [defaults.find(api => api.id === 'user_api_default_sixyin')], defaultSourcesVersion: 1 })
  assert.deepEqual(versionOne.api.getUserApis().map(api => api.id), ['user_api_default_sixyin', 'user_api_default_qdy'])
  assert.equal(versionOne.state.defaultSourcesVersion, 2)
  assert.deepEqual(fixture(versionOne.state).api.getUserApis().map(api => api.id), ['user_api_default_sixyin', 'user_api_default_qdy'])

  // Importing or getting a script before list enumeration must initialize storage.
  const coldImport = fixture({ userApis: [existing] })
  const added = await coldImport.api.importApi(script('New manual source'))
  assert.equal(coldImport.api.getUserApis().length, 8)
  assert.deepEqual(coldImport.state.userApis.find(api => api.id === existing.id), existing)
  assert.ok(coldImport.state.userApis.some(api => api.id === added.id))
  assert.deepEqual(coldImport.downloads, [])
  const coldCached = fixture({ userApis: [existing], defaultSourcesVersion: 1 })
  assert.equal(await coldCached.api.getScript(existing.id), script('Existing source', '1.0.0'))
  assert.deepEqual(coldCached.downloads, [])

  // Concurrent runtime windows share one download and persist compressed code.
  const download = deferred()
  const concurrent = fixture({}, () => download.promise)
  const first = concurrent.api.getScript(defaultIds[0])
  const second = concurrent.api.getScript(defaultIds[0])
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(concurrent.downloads, [defaultUrls[0]])
  const downloaded = script('Downloaded fixture', '9.9.9')
  download.resolve(downloaded)
  assert.deepEqual(await Promise.all([first, second]), [downloaded, downloaded])
  const saved = concurrent.state.userApis.find(api => api.id === defaultIds[0])
  assert.match(saved.script, /^gz_/)
  assert.equal(zlib.inflateSync(Buffer.from(saved.script.slice(3), 'base64')).toString(), downloaded)
  assert.equal(saved.name, 'Downloaded fixture')
  assert.equal(saved.version, '9.9.9')
  const restarted = fixture(concurrent.state, async() => { throw new Error('network should not be used') })
  assert.equal(await restarted.api.getScript(defaultIds[0]), downloaded)
  assert.deepEqual(restarted.downloads, [])

  // Failures do not poison the pending entry or persist invalid responses.
  let attempts = 0
  const retry = fixture({}, async() => { if (++attempts === 1) throw new Error('temporary network failure'); return downloaded })
  await assert.rejects(retry.api.getScript(defaultIds[1]), /temporary network failure/)
  assert.equal(retry.state.userApis.find(api => api.id === defaultIds[1]).script, '')
  assert.equal(await retry.api.getScript(defaultIds[1]), downloaded)
  assert.equal(attempts, 2)
  let invalidAttempts = 0
  const invalid = fixture({}, async() => ++invalidAttempts === 1 ? '<html>404</html>' : downloaded)
  await assert.rejects(invalid.api.getScript(defaultIds[2]), /无效|脚本/)
  assert.equal(invalid.state.userApis.find(api => api.id === defaultIds[2]).script, '')
  assert.equal(await invalid.api.getScript(defaultIds[2]), downloaded)

  // An in-flight download must never resurrect a source deleted by the user.
  const inflight = deferred()
  const removed = fixture({}, () => inflight.promise)
  const loading = removed.api.getScript(defaultIds[3])
  await new Promise(resolve => setImmediate(resolve))
  removed.api.removeApi([defaultIds[3]])
  inflight.resolve(downloaded)
  await assert.rejects(loading, /移除|删除|不存在|找不到/)
  assert.ok(!removed.api.getUserApis().some(api => api.id === defaultIds[3]))
  assert.ok(!removed.state.userApis.some(api => api.id === defaultIds[3]))
  assert.ok(!fixture(removed.state).api.getUserApis().some(api => api.id === defaultIds[3]))
  await checkRemoteDownload()
  console.log('Default user APIs: descriptors, migration, deletion, cold initialization, lazy cache, concurrent download, retry, removal race and bounded HTTP download passed.')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
