/* Legacy user API windows must not outlive asynchronous script loading. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const load = (relative, dependencies) => {
  const file = path.resolve(__dirname, '..', relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file)
  return instance.exports
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async() => new Promise(resolve => setImmediate(resolve))
const api = id => ({ id, name: id })

async function run() {
  process.env.NODE_ENV = 'production'
  global.lx = { appSetting: {}, event_app: new EventEmitter() }
  global.envParams = { cmdParams: {} }
  const windows = []
  const sent = []
  let loadError
  let clearing
  class Window extends EventEmitter {
    constructor() {
      super()
      windows.push(this)
      this.destroyed = false
      this.webContents = new EventEmitter()
      this.webContents.mainFrame = {}
      this.webContents.session = {
        setPermissionRequestHandler() {},
        clearAuthCache: async() => {},
        clearStorageData: async() => {},
        clearCache: async() => { if (clearing) await clearing.promise },
      }
      this.webContents.setWindowOpenHandler = () => {}
    }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
    async loadURL() {
      if (loadError) throw loadError
      this.emit('ready-to-show')
    }
  }
  const downloads = new Map()
  const main = load('src/main/modules/userApi/main.ts', {
    electron: { BrowserWindow: Window },
    '@common/mainIpc': { mainSend: (win, name, data) => sent.push({ win, name, data }) },
    '@main/utils': { openDevTools() {} },
    './rendererEvent/name': { __esModule: true, default: { initEnv: 'initEnv', proxyUpdate: 'proxyUpdate' } },
    './utils': { getScript: async id => downloads.has(id) ? downloads.get(id).promise : 'script:' + id },
    fs: { promises: { readFile: async() => '<html></html>' } },
  })

  const initial = deferred()
  downloads.set('first', initial)
  const first = main.createWindow(api('first'))
  await flush()
  assert.equal(windows.length, 0, 'remote download happens before window creation')
  initial.resolve('downloaded:first')
  await first
  assert.equal(windows.length, 1)
  assert.equal(sent.length, 1, 'ready-to-show listener is registered before loadURL')
  assert.equal(sent[0].data.script, 'downloaded:first')

  const cancelled = deferred()
  downloads.set('cancelled', cancelled)
  const loading = main.createWindow(api('cancelled'))
  await flush()
  await main.closeWindow()
  cancelled.resolve('must-not-run')
  await loading
  assert.equal(windows.length, 1, 'closing during script download cancels late window creation')

  const stale = deferred()
  downloads.set('stale', stale)
  const oldLoading = main.createWindow(api('stale'))
  await flush()
  await main.createWindow(api('current'))
  stale.reject(new Error('old network failure'))
  await oldLoading
  assert.equal(windows.length, 2)
  assert.equal(sent.at(-1).data.script, 'script:current')
  assert.equal(global.lx.event_app.listenerCount('updated_config'), 1)

  clearing = deferred()
  const oldWindow = windows.at(-1)
  const closing = main.closeWindow()
  await main.createWindow(api('next'))
  const nextWindow = windows.at(-1)
  clearing.resolve()
  await closing
  clearing = null
  assert.equal(oldWindow.isDestroyed(), true)
  assert.equal(nextWindow.isDestroyed(), false, 'late cleanup destroys only its original window')
  assert.equal(main.ownsApiEvent({ sender: nextWindow.webContents, senderFrame: nextWindow.webContents.mainFrame }), true)
  assert.equal(global.lx.event_app.listenerCount('updated_config'), 1)

  loadError = new Error('load failed')
  await assert.rejects(main.createWindow(api('broken')), /load failed/)
  assert.equal(windows.at(-1).isDestroyed(), true)
  assert.equal(global.lx.event_app.listenerCount('updated_config'), 0)
  loadError = null

  const statuses = []
  const selected = api('failure')
  const rendererEvents = load('src/main/modules/userApi/rendererEvent/rendererEvent.ts', {
    '@common/mainIpc': {}, './name': {},
    '../main': { createWindow: async() => { throw new Error('script download failed') } },
    '../utils': { getUserApis: () => [selected] },
    '@main/modules/winMain': { sendStatusChange: status => statuses.push(status) },
  })
  await assert.rejects(rendererEvents.loadApi(selected.id), /script download failed/)
  assert.deepEqual(statuses, [{ status: false, apiInfo: selected, message: 'script download failed' }])

  const waitingClose = deferred()
  const loaded = []
  const selection = load('src/main/modules/userApi/index.ts', {
    './main': { closeWindow: async() => waitingClose.promise },
    './utils': { getUserApis: () => ['a', 'b', 'c'].map(api) },
    './rendererEvent/rendererEvent': { loadApi: async id => { loaded.push(id) } },
    './playback': {},
  })
  await selection.setApi('a')
  const choosingB = selection.setApi('b')
  await selection.setApi('c')
  waitingClose.resolve()
  await choosingB
  assert.deepEqual(loaded, ['a', 'c'], 'a delayed previous selection cannot replace the current source')
  console.log('User API window: lazy script loading, early ready event, cancellation, stale downloads, close race, failure status and rapid source switching passed.')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
