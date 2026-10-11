const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function load(file, imports = {}, globals = {}) {
  const module = { exports: {} }
  const source = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(source, {
    module, exports: module.exports, Error, console, process,
    require(name) { if (name in imports) return imports[name]; throw new Error(`Unexpected import ${name}`) },
    ...globals,
  }, { filename: file })
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const constants = load('src/common/constants.ts')
const defaults = load('src/common/defaultSetting.ts', { 'node:path': path, 'node:os': os }).default
const startup = load('src/main/utils/startupPreferences.ts', { 'node:fs': fs, 'node:path': path, '@common/constants': constants })

test('startup uses the persisted hardware preference before ready, defaulting to acceleration', t => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-startup-'))
  t.after(() => fs.rmSync(dataPath, { recursive: true, force: true }))
  const file = path.join(dataPath, `${constants.STORE_NAMES.APP_SETTINGS}.json`)
  let disabled = 0
  const app = { disableHardwareAcceleration() { disabled++ } }
  assert.equal(defaults['common.disableHardwareAcceleration'], false)
  assert.equal(startup.applyStartupPreferences(app, dataPath).disableHardwareAcceleration, false)
  for (const input of [false, 'true', null]) {
    fs.writeFileSync(file, JSON.stringify({ setting: { 'common.disableHardwareAcceleration': input } }))
    startup.applyStartupPreferences(app, dataPath)
  }
  assert.equal(disabled, 0)
  fs.writeFileSync(file, JSON.stringify({ setting: { 'common.disableHardwareAcceleration': true } }))
  assert.equal(startup.applyStartupPreferences(app, dataPath).disableHardwareAcceleration, true)
  assert.equal(disabled, 1)
  fs.writeFileSync(file, '{invalid')
  assert.equal(startup.readStartupPreferences(dataPath).disableHardwareAcceleration, false)
  assert.equal(disabled, 1)
  const entry = read('src/main/index.ts')
  assert(entry.indexOf('setUserDataPath()') < entry.indexOf('applyStartupPreferences(app, global.lxDataPath)'))
  assert(entry.indexOf('applyStartupPreferences(app, global.lxDataPath)') < entry.indexOf('app.whenReady()'))
})

const platform = load('src/common/platformPlayback.ts')
const schema = load('src/renderer/ui/settings/schema.ts', {
  '@common/defaultSetting': { default: defaults, __esModule: true }, '@common/platformPlayback': platform,
  '@common/config': { windowSizeList: [] }, '@root/lang': { langList: [] },
  './labels.json': { __esModule: true, default: JSON.parse(read('src/renderer/ui/settings/labels.json')) },
})
function fixture({ save, syncEnabled = false } = {}) {
  const setting = vue.reactive({ ...defaults, 'sync.enable': syncEnabled })
  const disk = { ...defaults }
  const calls = []
  const mount = [], unmount = [], deviceListeners = new Set()
  const imports = {
    vue: { ...vue, onMounted(fn) { mount.push(fn) }, onBeforeUnmount(fn) { unmount.push(fn) } },
    '@renderer/store/setting': { appSetting: setting, mergeSetting: patch => Object.assign(setting, patch) },
    '@renderer/utils/ipc': {
      async updateSetting(patch) {
        calls.push(['save', plain(patch)])
        await save?.()
        Object.assign(disk, patch)
      },
      async restartApp() { calls.push(['restart']) },
      async getSystemFonts() { return [] },
      async getUserApiList() { return [] },
      async getCacheSize() { return 0 },
      async getOtherSourceCount() { return 0 },
      async getMusicUrlCount() { return 0 },
      async getLyricRawCount() { return 0 },
      async getLyricEditedCount() { return 0 },
      async getSyncServerDevices() { calls.push(['syncDevices']); return [] },
    },
    '@renderer/store/list/state': {}, '@renderer/store/list/action': {}, '@renderer/store': { userApi: {}, sync: {}, versionInfo: {} },
    '@renderer/core/apiSource': {}, '@renderer/core/player/utils': {}, '@renderer/plugins/player': {}, '@renderer/utils': {},
    '@common/utils/nodejs': {}, '@common/utils/common': { sizeFormate: String }, '@common/utils/migrateSetting': {},
    '@renderer/composables/useAppearance': {}, '@renderer/store/dislikeList': { dislikeInfo: { rules: '' } },
    '@renderer/core/dislikeList': {}, './schema': schema, '@renderer/ui/services/platformPlayback': {},
    '@common/localMusic': {}, '../services/localLibrary': {},
  }
  const navigator = { mediaDevices: {
    async enumerateDevices() { calls.push(['enumerate']); return [{ kind: 'audiooutput', deviceId: 'test' }, { kind: 'videoinput' }] },
    addEventListener(name, listener) { deviceListeners.add(listener) },
    removeEventListener(name, listener) { deviceListeners.delete(listener) },
  } }
  return { setting, disk, calls, mount, unmount, deviceListeners, settings: load('src/renderer/ui/settings/useSettings.ts', imports, { navigator }).useSettings() }
}
const settle = async() => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const hardwareField = schema.settingFields.find(field => field.key === 'common.disableHardwareAcceleration')

test('hardware changes are saved before prompting and Later keeps the saved next-start preference', async() => {
  let finishSave
  const save = new Promise(resolve => { finishSave = resolve })
  const f = fixture({ save: () => save })
  const pending = f.settings.setPreference(hardwareField, true)
  assert.equal(f.settings.confirmation.value, null)
  assert.equal(f.disk['common.disableHardwareAcceleration'], false)
  finishSave()
  await settle()
  assert.equal(f.disk['common.disableHardwareAcceleration'], true)
  assert.equal(f.setting['common.disableHardwareAcceleration'], true)
  assert.deepEqual(plain(f.settings.confirmation.value), {
    title: '重新启动 LinkLine', message: '修改已保存，是否立即重启 LinkLine 以生效？',
    danger: false, confirmLabel: '立即重启', cancelLabel: '稍后',
  })
  f.settings.answerConfirmation(false)
  await pending
  assert.deepEqual(f.calls, [['save', { 'common.disableHardwareAcceleration': true }]])
  await f.settings.setPreference(hardwareField, true)
  assert.equal(f.settings.confirmation.value, null)
})

test('Immediate Restart invokes app restart only after a successful disk write and explicit answer', async() => {
  const f = fixture()
  const pending = f.settings.setPreference(hardwareField, true)
  await settle()
  assert.deepEqual(f.calls, [['save', { 'common.disableHardwareAcceleration': true }]])
  f.settings.answerConfirmation(true)
  await pending
  assert.deepEqual(f.calls, [['save', { 'common.disableHardwareAcceleration': true }], ['restart']])
  const fail = fixture({ save: () => { throw new Error('disk write failed') } })
  await fail.settings.setPreference(hardwareField, true)
  assert.equal(fail.settings.failed.value, true)
  assert.equal(fail.settings.confirmation.value, null)
  assert.equal(fail.setting['common.disableHardwareAcceleration'], false)
  assert.equal(fail.disk['common.disableHardwareAcceleration'], false)
  assert.equal(fail.calls.some(call => call[0] === 'restart'), false)
})

test('lyrics translation defaults on and existing explicit disabled preferences are retained', () => {
  assert.equal(defaults['player.isShowLyricTranslation'], true)
  const settings = load('src/renderer/store/setting.ts', {
    '@common/utils/vueTools': vue, '@common/defaultSetting': { __esModule: true, default: defaults },
    '@common/platformPlayback': platform, '@renderer/utils/ipc': {},
  }, { window: { lxData: {} }, localStorage: { removeItem() {} } })
  assert.equal(settings.appSetting['player.isShowLyricTranslation'], true)
  settings.initSetting({ 'player.isShowLyricTranslation': false })
  assert.equal(settings.appSetting['player.isShowLyricTranslation'], false)
  const validated = schema.validateSettingBackup({ 'player.isShowLyricTranslation': false, 'common.disableHardwareAcceleration': true })
  assert.equal(validated['player.isShowLyricTranslation'], false)
  assert.equal(validated['common.disableHardwareAcceleration'], true)
  assert.equal(hardwareField.category, 'general')
  assert.equal(hardwareField.label, '关闭硬件加速')
})

test('settings overview avoids audio capture discovery and disabled sync service, then discovers outputs on demand', async() => {
  const f = fixture()
  for (const mounted of f.mount) mounted()
  await settle()
  assert.deepEqual(f.calls, [])
  assert.equal(f.deviceListeners.size, 0)
  await f.settings.setDeviceEnumerationActive(true)
  assert.deepEqual(f.calls, [['enumerate']])
  assert.equal(f.deviceListeners.size, 1)
  assert.equal(f.settings.devices.value.length, 1)
  await f.settings.setDeviceEnumerationActive(true)
  assert.equal(f.calls.length, 1)
  const listener = [...f.deviceListeners][0]
  listener()
  await settle()
  assert.equal(f.calls.length, 2)
  await f.settings.setDeviceEnumerationActive(false)
  assert.equal(f.deviceListeners.size, 0)
  listener() // A late native event after leaving the audio page must not restart discovery.
  await settle()
  assert.equal(f.calls.length, 2)
  await f.settings.setDeviceEnumerationActive(true)
  for (const unmounted of f.unmount) unmounted()
  assert.equal(f.deviceListeners.size, 0)
  const sync = fixture({ syncEnabled: true })
  for (const mounted of sync.mount) mounted()
  await settle()
  assert.deepEqual(sync.calls, [['syncDevices']])
})

test('restart IPC validates main window sender and performs app.relaunch plus graceful quit', async() => {
  const handlers = new Map()
  const webContents = {}
  const calls = [], deferred = []
  const win = new Proxy({ getWebContents: () => webContents }, { get: (target, key) => target[key] || (() => {}) })
  const names = load('src/common/ipcNames.ts')
  const close = load('src/common/windowClose.ts')
  load('src/main/modules/winMain/rendererEvent/app.ts', {
    electron: { app: { relaunch() { calls.push('relaunch') } } },
    '@common/mainIpc': { mainOn() {}, mainHandle(name, listener) { handlers.set(name, listener) } },
    '@common/ipcNames': names, '@main/modules/winMain': win,
    '@main/app': { quitApp() { calls.push('quit') } }, '@main/utils': {}, '@common/utils/electron': {}, '@common/windowClose': close,
  }, { setImmediate(fn) { deferred.push(fn) } }).default()
  const restart = handlers.get(names.WIN_MAIN_RENDERER_EVENT_NAME.restart_app)
  await assert.rejects(restart({ event: { sender: {} } }), /无效的窗口请求/)
  assert.deepEqual(calls, [])
  await restart({ event: { sender: webContents } })
  assert.deepEqual(calls, ['relaunch'])
  deferred[0]()
  assert.deepEqual(calls, ['relaunch', 'quit'])
})
