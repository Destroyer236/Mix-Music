const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

function loadSource(file, dependencies = {}, globals = {}) {
  const exports = {}
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports, require: name => dependencies[name] ?? require(name), ...globals }, { filename: file })
  return exports
}
const timing = loadSource('externalTiming.ts')

test('LRC accepts repeated timestamps and timestamp precision in translations', () => {
  const lines = timing.parseExternalLyric('[ar:artist]\n[00:01.20][00:04.000]Hello\n[00:07.00]World', '[00:01.200]你好\n[00:04.01]再次你好')
  assert.equal(lines.length, 3)
  assert.equal(lines[0].start, 1200)
  assert.equal(lines[0].end, 4000)
  assert.equal(lines[0].translation, '你好')
  assert.equal(lines[1].translation, '再次你好')
  assert.equal(timing.findExternalLine(lines, 1199), -1)
  assert.equal(timing.findExternalLine(lines, 4000), 1)
})

test('LXLRC retains real word starts and durations relative to its line', () => {
  const [line] = timing.parseExternalLyric('[00:10.000]<100,400>你<600,500>好')
  assert.equal(line.text, '你好')
  assert.equal(line.timed, true)
  assert.equal(line.words[0].start, 10100)
  assert.equal(line.words[1].end, 11100)
  assert.equal(timing.wordProgress(line.words[0], 10099), 0)
  assert.equal(timing.wordProgress(line.words[0], 10300), .5)
  assert.equal(timing.wordProgress(line.words[0], 10500), 1)
})

test('generated word timing preserves text and covers the interval before the next line', () => {
  const [line] = timing.parseExternalLyric('[00:01.000]Hello 世界 !\n[00:05.000]Next')
  assert.equal(line.timed, false)
  assert.equal(line.words.map(word => word.text).join(''), line.text)
  assert.equal(line.words[0].start, 1000)
  assert.equal(line.words.at(-1).end, 5000)
  assert.ok(line.words.every(word => word.end >= word.start))
})

test('horizontal scrolling starts at the beginning and reaches the final word', () => {
  const [line] = timing.parseExternalLyric('[00:01.000]A long line\n[00:09.000]Next')
  assert.equal(timing.lyricScrollOffset(1000, line, 1000, 200), 0)
  assert.equal(timing.lyricScrollOffset(2000, line, 1000, 200), 0)
  assert.equal(timing.lyricScrollOffset(9000, line, 1000, 200), -200)
  assert.equal(timing.lyricScrollOffset(9000, line, 1000, 0), 0)
})

function createState() {
  let clock = 0
  let frame
  let incoming
  const listeners = new Map()
  const sent = []
  const ipcRenderer = {
    on(name, handler) { listeners.set(name, handler) },
    send(...args) { sent.push(args) },
    async invoke() { return {} },
  }
  const port = { start() {}, close() {}, postMessage() {}, set onmessage(value) { incoming = value } }
  const state = loadSource('externalState.ts', {
    vue: { reactive: value => value, ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }) },
    electron: { ipcRenderer },
    '@common/ipcNames': { WIN_LYRIC_RENDERER_EVENT_NAME: { provide_main_window_channel: 'port', main_window_inited: 'main-ready' } },
    '@common/externalLyric': { externalLyricDefaults: {}, getExternalLyricConfig: () => ({}) },
    './externalTiming': timing,
  }, {
    URLSearchParams,
    window: { location: { search: '?mode=desktop' }, addEventListener() {} },
    performance: { now: () => clock },
    requestAnimationFrame: callback => { frame = callback; return 1 },
    cancelAnimationFrame() {},
  })
  return {
    state, sent,
    async connect() { await state.initializeExternal(); listeners.get('port')({ ports: [port] }) },
    emit: event => incoming({ data: event }),
    tick(milliseconds) { clock += milliseconds; frame() },
    reconnect: () => listeners.get('externalLyric:reconnect')(),
  }
}

test('player MessagePort uses milliseconds, offsets, seek, pause and playback rate', async () => {
  const harness = createState()
  await harness.connect()
  harness.emit({ action: 'set_info', data: { id: 'a', name: 'A', singer: 'Artist', lrc: '[00:01.000]First\n[00:04.000]Second', lxlrc: null, tlrc: null, pic: 'cover', played_time: 1500, isPlay: true, playbackRate: 1, offset: 200 } })
  assert.equal(harness.state.now.value, 1700)
  assert.equal(harness.state.primaryIndex.value, 0)
  harness.tick(500)
  assert.equal(harness.state.now.value, 2200)
  harness.emit({ action: 'set_playbackRate', data: 2 })
  harness.tick(500)
  assert.equal(harness.state.now.value, 3200)
  harness.emit({ action: 'set_pause' })
  harness.tick(1000)
  assert.equal(harness.state.now.value, 3200)
  harness.emit({ action: 'set_status', data: { played_time: 4500, isPlay: false } })
  assert.equal(harness.state.now.value, 4700)
  assert.equal(harness.state.primaryIndex.value, 1)
  harness.emit({ action: 'set_play', data: 1000 })
  harness.tick(100)
  assert.equal(harness.state.now.value, 1400)
  harness.emit({ action: 'set_stop' })
  assert.equal(harness.state.track.id, null)
  assert.equal(harness.state.lines.value.length, 0)
  harness.reconnect()
  assert.equal(harness.sent.at(-1)[0], 'externalLyric:connect')
})

test('late cover updates do not reset playback or lyrics and can clear a stale cover', async () => {
  const harness = createState()
  await harness.connect()
  harness.emit({ action: 'set_info', data: { id: 'a', name: 'A', singer: 'Artist', lrc: '[00:00.000]First', lxlrc: null, tlrc: null, pic: '', played_time: 1500, isPlay: false } })
  harness.emit({ action: 'set_cover', data: 'data:image/png;base64,fixture' })
  assert.equal(harness.state.track.cover, 'data:image/png;base64,fixture')
  assert.equal(harness.state.now.value, 1500)
  assert.equal(harness.state.lines.value[0].text, 'First')
  harness.emit({ action: 'set_cover', data: null })
  assert.equal(harness.state.track.cover, '')
})
