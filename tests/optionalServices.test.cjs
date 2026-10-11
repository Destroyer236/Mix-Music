const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, imports) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: name => {
      assert(name in imports, `Unexpected dependency: ${name}`)
      return typeof imports[name] === 'function' ? imports[name]() : imports[name]
    },
  })
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))

test('renderer workers remain unstarted until used, with independent APIs and one creation per worker', async() => {
  const created = []; const called = []
  const factory = name => () => {
    created.push(name)
    return { getMusicFilePic: async id => { called.push([name, id]); return `cover:${id}` }, writeMeta: async id => { called.push([name, id]); return id } }
  }
  const { default: createWorkers } = load('src/renderer/worker/index.ts', { './utils': { createMainWorker: factory('main'), createDownloadWorker: factory('download') } })
  const workers = createWorkers()
  assert.deepEqual(created, [])
  await Promise.resolve(workers.main)
  await Promise.resolve(workers.download)
  assert.deepEqual(created, [], 'Promise assimilation must not start a worker')
  const first = workers.main.getMusicFilePic
  assert.deepEqual(created, [], 'reading a method must not start a worker')
  assert.equal(await first('first'), 'cover:first')
  assert.equal(await workers.main.getMusicFilePic('second'), 'cover:second')
  assert.deepEqual(created, ['main'])
  await workers.download.writeMeta('download')
  assert.deepEqual(created, ['main', 'download'])
  assert.deepEqual(called, [['main', 'first'], ['main', 'second'], ['download', 'download']])
})

test('disabled remote-control status and stop requests do not load or start a server', async() => {
  const handlers = new Map(); const calls = []
  let loads = 0
  const service = {
    startServer: async(port, bindLan) => { calls.push(['start', port, bindLan]); return { status: true, message: '', address: '127.0.0.1' } },
    stopServer: async() => { calls.push(['stop']); return { status: false, message: '', address: '' } },
    getStatus: () => ({ status: true, message: '', address: '127.0.0.1' }),
  }
  const module = load('src/main/modules/winMain/rendererEvent/openAPI.ts', {
    '@common/mainIpc': { mainHandle: (name, handler) => handlers.set(name, handler) },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: { open_api_action: 'open-api' } },
    '@main/modules/openApi': () => { loads++; return service },
  })
  module.default()
  const send = params => handlers.get('open-api')({ params })
  assert.deepEqual(plain(await send({ action: 'status' })), { status: false, message: '', address: '' })
  await send({ action: 'enable', data: { enable: false, port: '23330', bindLan: false } })
  assert.equal(loads, 0)
  await send({ action: 'enable', data: { enable: true, port: '23330', bindLan: false } })
  assert.equal(loads, 1)
  await send({ action: 'status' })
  await send({ action: 'enable', data: { enable: false } })
  assert.equal(loads, 1)
  assert.deepEqual(calls, [['start', 23330, false], ['stop']])
})

test('cross-device sync stays unloaded when disabled and still supports explicit pairing and stored devices', async() => {
  const handlers = new Map(); const calls = []
  let loads = 0
  const service = {
    startServer: async port => calls.push(['server', port]),
    stopServer: async() => calls.push(['stop-server']),
    connectServer: async(host, auth) => calls.push(['client', host, auth]),
    disconnectServer: async() => calls.push(['stop-client']),
    getServerStatus: () => ({ status: true }),
    getClientStatus: () => ({ status: true }),
    generateCode: async() => '123456',
    getServerDevices: async() => [{ clientId: 'saved-device' }],
    removeServerDevice: async id => calls.push(['remove', id]),
  }
  const module = load('src/main/modules/winMain/rendererEvent/sync.ts', {
    '@common/mainIpc': { mainHandle: (name, handler) => handlers.set(name, handler) },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: { sync_action: 'sync', sync_get_server_devices: 'devices', sync_remove_server_device: 'remove-device' } },
    '../main': { sendEvent() {} },
    '@main/modules/sync': () => { loads++; return service },
  })
  module.default()
  const send = params => handlers.get('sync')({ params })
  assert.equal((await send({ action: 'get_server_status' })).status, false)
  assert.equal((await send({ action: 'get_client_status' })).status, false)
  await send({ action: 'enable_server', data: { enable: false } })
  await send({ action: 'enable_client', data: { enable: false } })
  assert.equal(loads, 0)
  await Promise.all([
    send({ action: 'enable_server', data: { enable: true, port: '23332' } }),
    send({ action: 'enable_client', data: { enable: true, host: 'fixture', authCode: '654321' } }),
  ])
  assert.equal(loads, 1, 'concurrent first callers share a single service load')
  assert.equal((await send({ action: 'get_server_status' })).status, true)
  assert.equal(await send({ action: 'generate_code' }), '123456')
  assert.deepEqual(plain(await handlers.get('devices')({})), [{ clientId: 'saved-device' }])
  await handlers.get('remove-device')({ params: 'saved-device' })
  await send({ action: 'enable_server', data: { enable: false } })
  await send({ action: 'enable_client', data: { enable: false } })
  assert.deepEqual(calls, [['server', 23332], ['client', 'fixture', '654321'], ['remove', 'saved-device'], ['stop-server'], ['stop-client']])
})
