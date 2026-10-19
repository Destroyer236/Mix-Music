// Regression: stalled taskbar hosting and renderer crashes recover without
// reviving disabled lyrics or letting callbacks from an old host affect a new one.
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function fakeTimers() {
  let now = 0
  const pending = new Set()
  function setTimeout(callback, delay = 0) {
    const timer = { at: now + delay, callback, unref() {} }
    pending.add(timer)
    return timer
  }
  function clearTimeout(timer) { pending.delete(timer) }
  function advance(milliseconds) {
    const end = now + milliseconds
    while (true) {
      const next = [...pending].filter(timer => timer.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      pending.delete(next)
      now = next.at
      next.callback()
    }
    now = end
  }
  return { setTimeout, clearTimeout, setInterval: setTimeout, clearInterval: clearTimeout, advance, pending }
}

function load(relative, dependencies = {}, context = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exportsObject = {}
  vm.runInNewContext(output, {
    exports: exportsObject,
    require(name) {
      if (name in dependencies) return dependencies[name]
      if (name.startsWith('node:')) return require(name)
      throw new Error(`Unexpected dependency: ${name}`)
    },
    console: { error() {} },
    __dirname: path.dirname(filename),
    ...context,
  }, { filename })
  return exportsObject
}

const preferences = load('src/common/externalLyric.ts')
const validLayout = {
  space: { left: { x: 100, y: 0, width: 300, height: 48 }, right: { x: 900, y: 0, width: 400, height: 48 } },
  extra: { isCentered: false, isLight: false, systemType: 'win11', scale: 1 },
}

function hostFixture(patch = {}) {
  const timers = fakeTimers()
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stdout.setEncoding = () => {}
  child.stderr = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdin.writable = true
  child.commands = []
  child.stdin.write = value => { child.commands.push(JSON.parse(value)) }
  child.stdin.end = () => { child.stdin.writable = false }
  child.exitCode = null
  child.killCount = 0
  child.kill = () => { child.killCount++ }
  const bounds = []
  const shapes = []
  const win = { getNativeWindowHandle: () => Buffer.alloc(8), isDestroyed: () => false, isVisible: () => true, setBounds(value) { bounds.push(JSON.parse(JSON.stringify(value))) }, setShape(value) { shapes.push(JSON.parse(JSON.stringify(value))) } }
  const setting = { ...preferences.externalLyricDefaults, ...patch }
  const layouts = []
  const errors = []
  const module = load('src/main/modules/externalLyric/taskbarHost.ts', {
    'node:child_process': { spawn: () => child },
    'node:fs': { mkdtempSync: () => 'fixture', writeFileSync() {}, unlinkSync() {}, rmdirSync() {} },
    electron: { app: { getPath: () => 'fixture' }, screen: { getPrimaryDisplay: () => ({ scaleFactor: 1 }) } },
    '@common/externalLyric': preferences,
    './taskbarNative': { taskbarNativeScript: 'fixture' },
  }, { ...timers, process: { pid: 123 }, global: { lx: { appSetting: setting } } })
  const host = module.startTaskbarHost(win, layout => layouts.push(layout), error => errors.push(error))
  function emit(value) { child.stdout.emit('data', JSON.stringify(value) + '\n') }
  return { timers, child, layouts, errors, host, emit, bounds, shapes, win }
}

function configureHost(fixture, patch) {
  fixture.host.configure(preferences.getExternalLyricConfig({ ...preferences.externalLyricDefaults, ...patch }, 'taskbar'))
}

test('unchanged layouts remain healthy with scan heartbeats', () => {
  const fixture = hostFixture()
  fixture.emit(validLayout)
  for (let index = 0; index < 30; index++) {
    fixture.timers.advance(10000)
    fixture.emit({ heartbeat: true })
  }
  assert.equal(fixture.layouts.length, 1, 'heartbeats must not resize or show the window again')
  assert.equal(fixture.errors.length, 0)
  fixture.host.stop()
})

test('repeated layouts never resize, reshape or show the embedded window', () => {
  const fixture = hostFixture()
  fixture.emit(validLayout)
  for (let index = 0; index < 20; index++) fixture.emit(validLayout)
  assert.equal(fixture.bounds.length, 1)
  assert.equal(fixture.shapes.length, 1)
  assert.equal(fixture.layouts.length, 1)
  assert.deepEqual(fixture.bounds[0], { x: 900, y: 0, width: 400, height: 48 })
  assert.deepEqual(fixture.child.commands, [{ width: 400 }], 'the native host must not move/resize the HWND after Electron applies its bounds')
  fixture.host.stop()
})

test('SPlayer side selection, DPI conversion, margins and fixed width share one consistent region', () => {
  const fixture = hostFixture({ 'externalLyric.taskbar.position': 'right', 'externalLyric.taskbar.autoMaxWidth': false, 'externalLyric.taskbar.maxWidth': 240, 'externalLyric.taskbar.leftMargin': 10, 'externalLyric.taskbar.rightMargin': 20 })
  fixture.emit({
    space: { left: { x: 160, y: 0, width: 600, height: 96 }, right: { x: 1800, y: 0, width: 800, height: 96 } },
    extra: { isCentered: true, isLight: true, systemType: 'win11', scale: 2 },
  })
  assert.deepEqual(fixture.bounds.at(-1), { x: 1040, y: 0, width: 240, height: 48 })
  assert.equal(fixture.layouts.at(-1).maxWidth, 240)
  assert.equal(fixture.layouts.at(-1).anchor, 'right')
  configureHost(fixture, { 'externalLyric.taskbar.position': 'left' })
  assert.deepEqual(fixture.bounds.at(-1), { x: 80, y: 0, width: 300, height: 48 })
  assert.equal(fixture.layouts.at(-1).anchor, 'left')
  fixture.host.stop()
})

test('auto follows the larger side for centered icons and falls back when the selected side is empty', () => {
  const fixture = hostFixture()
  const centered = structuredClone(validLayout)
  centered.extra.isCentered = true
  centered.space.left.width = 700
  fixture.emit(centered)
  assert.equal(fixture.layouts.at(-1).anchor, 'left')
  assert.equal(fixture.bounds.at(-1).width, 700)
  configureHost(fixture, { 'externalLyric.taskbar.position': 'right' })
  assert.equal(fixture.layouts.at(-1).anchor, 'right')
  centered.space.right.width = 0
  fixture.emit(centered)
  assert.equal(fixture.layouts.at(-1).anchor, 'left')
  fixture.host.stop()
})

test('unknown scans preserve the region; measured no-space hides and later layouts restore', () => {
  const fixture = hostFixture()
  fixture.emit(validLayout)
  fixture.emit({ heartbeat: true })
  fixture.emit({ space: null, extra: validLayout.extra })
  assert.equal(fixture.layouts.length, 1)
  assert.equal(fixture.bounds.length, 1)
  fixture.emit({ ...validLayout, space: { left: { ...validLayout.space.left, width: 0 }, right: { ...validLayout.space.right, width: 80 } } })
  assert.equal(fixture.layouts.at(-1).maxWidth, 0)
  assert.equal(fixture.bounds.length, 1, 'no-space must not collapse the compositor viewport')
  fixture.emit(validLayout)
  assert.equal(fixture.layouts.at(-1).maxWidth, 400)
  assert.equal(fixture.bounds.length, 1)
  fixture.host.stop()
})

test('reattachment repairs identical bounds once and content width only updates the shape', () => {
  const fixture = hostFixture({ 'externalLyric.taskbar.autoAdjustOccupiedSpace': true })
  fixture.emit(validLayout)
  fixture.host.contentWidth(175)
  assert.deepEqual(fixture.shapes.at(-1), [{ x: 225, y: 0, width: 175, height: 48 }])
  fixture.host.contentWidth(175)
  assert.equal(fixture.shapes.length, 2)
  fixture.emit({ ...validLayout, extra: { ...validLayout.extra, reattached: true } })
  assert.equal(fixture.bounds.length, 2)
  assert.equal(fixture.layouts.at(-1).reattached, true)
  assert.equal(fixture.shapes.length, 3)
  fixture.emit(validLayout)
  assert.equal(fixture.bounds.length, 2)
  assert.equal(fixture.layouts.length, 2)
  fixture.host.stop()
})

test('a blocked native scan reports one failure and terminates the stalled process', () => {
  const fixture = hostFixture()
  fixture.emit(validLayout)
  fixture.timers.advance(29999)
  assert.equal(fixture.errors.length, 0)
  fixture.timers.advance(1)
  assert.equal(fixture.errors.length, 1)
  assert.match(fixture.errors[0].message, /响应超时/)
  assert.equal(fixture.child.commands.at(-1).stop, true)
  fixture.emit(validLayout)
  fixture.emit({ heartbeat: true })
  fixture.timers.advance(2000)
  assert.equal(fixture.child.killCount, 1)
  fixture.child.emit('exit', 1)
  fixture.child.emit('error', new Error('late native error'))
  fixture.timers.advance(60000)
  assert.equal(fixture.errors.length, 1)
  assert.equal(fixture.layouts.length, 1)
})

test('heartbeat activity cannot bypass initial layout timeout', () => {
  const fixture = hostFixture()
  for (let index = 0; index < 5; index++) {
    fixture.timers.advance(5000)
    fixture.emit({ heartbeat: true })
  }
  fixture.timers.advance(5000)
  assert.equal(fixture.errors.length, 1)
  assert.match(fixture.errors[0].message, /初始化超时/)
})

test('intentional stop cancels initialization and running watchdogs', () => {
  for (const initialized of [false, true]) {
    const fixture = hostFixture()
    if (initialized) fixture.emit(validLayout)
    fixture.emit({ heartbeat: true })
    fixture.host.stop()
    fixture.timers.advance(60000)
    assert.equal(fixture.errors.length, 0)
    assert.equal(fixture.timers.pending.size, 0)
  }
})

function windowFixture() {
  const timers = fakeTimers()
  const windows = []
  const hosts = []
  const events = new EventEmitter()
  const app = new EventEmitter()
  const screen = new EventEmitter()
  const ipcMain = new EventEmitter()
  ipcMain.handle = () => {}
  const area = { x: 0, y: 0, width: 1600, height: 900 }
  screen.getPrimaryDisplay = () => ({ workArea: area })
  screen.getDisplayMatching = () => ({ workArea: area })
  const setting = { ...preferences.externalLyricDefaults, 'externalLyric.taskbar.enabled': true }
  events.update_config = patch => { Object.assign(setting, patch); events.emit('updated_config', Object.keys(patch)) }
  events.desktop_lyric_window_created = () => {}
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super()
      this.bounds = options
      this.destroyed = false
      this.shown = 0
      this.hidden = 0
      this.visible = false
      this.webContents = new EventEmitter()
      this.webContents.setWindowOpenHandler = () => {}
      this.messages = []
      this.webContents.send = (channel, value) => { this.messages.push({ channel, value }) }
      windows.push(this)
    }

    loadURL() { return new Promise((_resolve, reject) => { this.rejectLoad = reject }) }
    isDestroyed() { return this.destroyed }
    getBounds() { return this.bounds }
    isVisible() { return this.visible }
    showInactive() { this.shown++; this.visible = true }
    hide() { this.hidden++; this.visible = false }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  const module = load('src/main/modules/externalLyric/index.ts', {
    electron: { app, BrowserWindow, screen, ipcMain, MessageChannelMain: class { constructor() { this.port1 = {}; this.port2 = {} } } },
    '@common/constants': { APP_EVENT_NAMES: {} },
    '@common/hotKey': { HOTKEY_DESKTOP_LYRIC: {} },
    '@common/ipcNames': { WIN_LYRIC_RENDERER_EVENT_NAME: {}, WIN_MAIN_RENDERER_EVENT_NAME: {} },
    '@common/externalLyric': preferences,
    '../winMain': { getWebContents: () => ({ postMessage() {} }) },
    './windowGeometry': load('src/main/modules/externalLyric/windowGeometry.ts'),
    './taskbarHost': {
      startTaskbarHost(win, onLayout, onError) {
        const host = { win, onLayout, onError, stopped: 0, stop() { this.stopped++ }, configure() {}, contentWidth() {} }
        hosts.push(host)
        return host
      },
    },
  }, { ...timers, process: { platform: 'win32', env: { NODE_ENV: 'production' } }, global: { lx: { appSetting: setting, event_app: events, theme: { shouldUseDarkColors: false } } } })
  module.default()
  events.emit('main_window_inited')
  function ready() { windows.at(-1).emit('ready-to-show'); return hosts.at(-1) }
  function crash(win = windows.at(-1)) { win.webContents.emit('render-process-gone', {}, { reason: 'crashed' }) }
  return { timers, windows, hosts, events, app, setting, module, ready, crash, ipcMain }
}

test('renderer crash recreates enabled lyrics and ignores every stale window callback', async() => {
  const fixture = windowFixture()
  const old = fixture.windows[0]
  const oldHost = fixture.ready()
  fixture.crash(old)
  assert.equal(old.destroyed, true)
  assert.equal(oldHost.stopped, 1)
  assert.equal(fixture.setting['externalLyric.taskbar.enabled'], true)
  fixture.timers.advance(999)
  assert.equal(fixture.windows.length, 1)
  fixture.timers.advance(1)
  const replacement = fixture.windows[1]
  const newHost = fixture.ready()
  oldHost.onError(new Error('late host failure'))
  oldHost.onLayout({ maxWidth: 0 })
  old.emit('closed')
  fixture.crash(old)
  old.rejectLoad(new Error('old load aborted'))
  await Promise.resolve()
  assert.equal(replacement.destroyed, false)
  assert.equal(replacement.hidden, 0)
  assert.equal(newHost.stopped, 0)
  assert.equal(fixture.module.lyricWindows.get('taskbar'), replacement)
  assert.equal(fixture.setting['externalLyric.taskbar.enabled'], true)
  assert.equal(fixture.timers.pending.size, 0)
})

test('repeated failures back off and a healthy layout resets the delay', () => {
  const fixture = windowFixture()
  fixture.ready().onError(new Error('native startup failed'))
  fixture.timers.advance(1000)
  fixture.ready().onError(new Error('native startup failed again'))
  fixture.timers.advance(1999)
  assert.equal(fixture.windows.length, 2)
  fixture.timers.advance(1)
  fixture.ready().onLayout({ maxWidth: 400 })
  fixture.crash()
  fixture.timers.advance(1000)
  assert.equal(fixture.windows.length, 4)
})

test('taskbar windows use the upstream toolbar options and change visibility only when needed', () => {
  const fixture = windowFixture()
  const win = fixture.windows[0]
  assert.equal(win.bounds.type, 'toolbar')
  assert.equal(win.bounds.movable, false)
  assert.equal(win.bounds.webPreferences.zoomFactor, 1)
  assert.equal(win.bounds.webPreferences.disableDialogs, true)
  const host = fixture.ready()
  const layout = { maxWidth: 400, height: 48, anchor: 'right', isLight: false, systemType: 'win11', isCentered: false }
  host.onLayout(layout)
  host.onLayout(layout)
  assert.equal(win.shown, 1)
  assert.equal(win.messages.at(-1).value.maxWidth, 400)
  assert.equal(win.messages.at(-1).value.isLight, false)
  host.onLayout({ ...layout, reattached: true })
  assert.equal(win.shown, 2)
  host.onLayout({ ...layout, maxWidth: 0 })
  host.onLayout({ ...layout, maxWidth: 0 })
  assert.equal(win.hidden, 1)
  host.onLayout(layout)
  assert.equal(win.shown, 3)
})

test('a lyric channel reconnect retains the native layout rather than the monitor width', () => {
  const fixture = windowFixture()
  const win = fixture.windows[0]
  const host = fixture.ready()
  const layout = { maxWidth: 320, height: 48, anchor: 'right', isLight: false, systemType: 'win11', isCentered: false }
  host.onLayout(layout)
  fixture.ipcMain.emit('externalLyric:connect', { sender: win.webContents })
  assert.equal(win.messages.findLast(message => message.channel === 'externalLyric:layout').value.maxWidth, 320)
  assert.equal(win.messages.findLast(message => message.channel === 'externalLyric:layout').value.anchor, 'right')
  assert.equal(win.messages.findLast(message => message.channel === 'externalLyric:layout').value.isLight, false)
})

for (const action of ['disable', 'quit', 'main-close']) {
  test(`${action} cancels a pending recovery even when no window exists`, () => {
    const fixture = windowFixture()
    const host = fixture.ready()
    fixture.crash()
    assert.equal(fixture.timers.pending.size, 1)
    if (action === 'disable') fixture.events.update_config({ 'externalLyric.taskbar.enabled': false })
    else if (action === 'quit') fixture.app.emit('before-quit')
    else fixture.events.emit('main_window_close')
    assert.equal(fixture.timers.pending.size, 0, 'the recovery timer must actually be removed')
    host.onError(new Error('late failure after shutdown'))
    fixture.crash(fixture.windows[0])
    fixture.timers.advance(60000)
    assert.equal(fixture.windows.length, 1)
    assert.equal(fixture.timers.pending.size, 0)
  })
}

test('unexpected native window destruction recovers without disabling lyrics', () => {
  const fixture = windowFixture()
  const host = fixture.ready()
  fixture.windows[0].destroy()
  assert.equal(host.stopped, 1)
  fixture.timers.advance(1000)
  assert.equal(fixture.windows.length, 2)
  assert.equal(fixture.setting['externalLyric.taskbar.enabled'], true)
})
