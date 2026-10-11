const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const vue = require('vue')

function load(file, imports, extra = {}) {
  const module = { exports: {} }
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (name in imports) return imports[name]
    throw new Error('Unexpected import: ' + name)
  }, __dirname, process: { env: { NODE_ENV: 'production' } }, ...extra })
  return module.exports
}

function nativeFixture(isLinux = false) {
  const bounds = { x: -1000, y: 100, width: 450, height: 300 }
  const setting = { 'desktopLyric.isLock': true, 'desktopLyric.isAlwaysOnTop': false, 'desktopLyric.style.opacity': 95, 'desktopLyric.style.fontSize': 20 }
  const screen = new EventEmitter()
  let point = { x: 0, y: 0 }
  screen.getCursorScreenPoint = () => point
  const intervals = new Map()
  let nextTimer = 0
  let win
  const mouseCalls = []
  const events = []
  class Window extends EventEmitter {
    constructor() { super(); win = this }
    loadURL() { return Promise.resolve() }
    getBounds() { return bounds }
    setBounds() {}
    isDestroyed() { return false }
    showInactive() {}
    moveTop() {}
    setIgnoreMouseEvents(ignore, options) { mouseCalls.push({ ignore, forward: options?.forward }) }
    close() { this.emit('closed') }
  }
  const main = load('src/main/modules/winLyric/main.ts', {
    'node:path': path,
    electron: { BrowserWindow: Window, screen },
    '@common/utils': { debounce: callback => callback, getPlatform: () => isLinux ? 'linux' : 'win32', isWin: !isLinux, isLinux },
    './utils': { initWindowSize: () => bounds, minWidth: 320, minHeight: 180 },
    '@common/mainIpc': { mainSend(window, name, value) { assert.equal(window, win); events.push({ name, value }) } },
    '@common/ipcNames': { WIN_LYRIC_RENDERER_EVENT_NAME: { mouse_enter_leave: 'lyric-hover' } },
    '@common/utils/electron': { encodePath: value => value },
  }, {
    global: { envParams: { workAreaSize: {} }, lx: { appSetting: setting, theme: { shouldUseDarkColors: false, theme: {} }, event_app: { update_config() {}, desktop_lyric_window_created() {} } } },
    setInterval(callback, delay) { assert.equal(delay, 100); intervals.set(++nextTimer, callback); return nextTimer },
    clearInterval(timer) { intervals.delete(timer) },
  })
  main.createWindow()
  win.emit('ready-to-show')
  return { main, setting, mouseCalls, events, intervals, move(x, y) { point = { x, y }; for (const callback of intervals.values()) callback() } }
}

test('locked lyrics reveal their button only inside the card and retain click-through elsewhere', () => {
  const fixture = nativeFixture()
  const { main, mouseCalls, events, intervals, move } = fixture
  try {
    assert.equal(intervals.size, 1)
    assert.deepEqual(events, [{ name: 'lyric-hover', value: false }])
    assert.deepEqual(mouseCalls, [{ ignore: true, forward: true }])
    move(-800, 200)
    assert.deepEqual(events.at(-1), { name: 'lyric-hover', value: true })
    assert.equal(mouseCalls.length, 1)
    move(-700, 250)
    assert.equal(events.length, 2)
    assert.equal(mouseCalls.length, 1)
    move(-600, 130)
    assert.deepEqual(mouseCalls.at(-1), { ignore: false, forward: true })
    assert.equal(events.length, 2)
    move(-800, 200)
    assert.deepEqual(mouseCalls.at(-1), { ignore: true, forward: true })
    move(-996, 200) // Transparent outer padding is outside the lyric card.
    assert.deepEqual(events.at(-1), { name: 'lyric-hover', value: false })
    move(-400, 200)
    assert.equal(events.length, 3)
  } finally { main.closeWindow() }
  assert.equal(intervals.size, 0)
})

test('hover tracking works without forwarded native mouse events and cleans up when unlocked', () => {
  const { main, setting, mouseCalls, events, intervals, move } = nativeFixture(true)
  try {
    move(-800, 200)
    assert.deepEqual(events.at(-1), { name: 'lyric-hover', value: true })
    assert.deepEqual(mouseCalls.at(-1), { ignore: true, forward: false })
    move(-600, 130)
    assert.deepEqual(mouseCalls.at(-1), { ignore: false, forward: false })
    setting['desktopLyric.isLock'] = false
    main.applyMousePolicy()
    assert.equal(intervals.size, 0)
    assert.deepEqual(mouseCalls.at(-1), { ignore: false, forward: undefined })
  } finally { main.closeWindow() }
})

test('locked hover state follows native IPC instead of click-through DOM leave, with independent hover hiding', () => {
  const callbacks = new Map()
  const setting = vue.reactive({ 'desktopLyric.isLock': true, 'desktopLyric.isHoverHide': false })
  let onNativeHover
  let dispose
  let removed = false
  const body = {
    addEventListener(name, callback) { callbacks.set(name, callback) },
    removeEventListener(name, callback) { assert.equal(callbacks.get(name), callback); callbacks.delete(name) },
  }
  const useHoverHide = load('src/renderer-lyric/useApp/useHoverHide.ts', {
    '@common/utils/vueTools': { ...vue, onBeforeUnmount(callback) { dispose = callback } },
    '@lyric/store/state': { setting },
    '@lyric/utils/ipc': { onMouseEnterLeave(callback) { onNativeHover = callback; return () => { removed = true } } },
  }, { document: { body, querySelector: () => ({ getBoundingClientRect: () => ({ left: 7, right: 443, top: 7, bottom: 293 }) }) } }).default
  const state = useHoverHide()
  assert.equal(state.isMouseEnter.value, false)
  onNativeHover({ params: true })
  assert.equal(state.isMouseEnter.value, true)
  assert.equal(state.isHoverHide.value, false)
  callbacks.get('mouseleave')()
  assert.equal(state.isMouseEnter.value, true)
  setting['desktopLyric.isHoverHide'] = true
  assert.equal(state.isHoverHide.value, true)
  onNativeHover({ params: false })
  assert.equal(state.isHoverHide.value, false)
  setting['desktopLyric.isLock'] = false
  callbacks.get('mousemove')({ clientX: 100, clientY: 100 })
  assert.equal(state.isMouseEnter.value, true)
  callbacks.get('mousemove')({ clientX: 4, clientY: 100 })
  assert.equal(state.isMouseEnter.value, false)
  callbacks.get('mousemove')({ clientX: 100, clientY: 100 })
  callbacks.get('mouseleave')()
  assert.equal(state.isMouseEnter.value, false)
  dispose()
  assert.equal(callbacks.size, 0)
  assert.equal(removed, true)
})
