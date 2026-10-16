// Regression: opening a second external lyric must not disconnect the first.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

let connect
const musicInfo = { id: 'fixture', name: '同步歌曲', singer: '歌手', album: '专辑', lrc: '[00:00.00]同步歌词', tlrc: null, rlrc: null, lxlrc: null, pic: null }
const setting = { 'player.playbackRate': 1.5 }
const dependencies = {
  '@common/utils/lyric-font-player': { default: class { setPlaybackRate() {} } },
  '@renderer/plugins/player': { getCurrentTime: () => 2.5, getAnalyser: () => null },
  '@renderer/store/player/lyric': { lyric: { line: 0, offset: 0, tempOffset: 200 } },
  '@renderer/store/player/state': { musicInfo, isPlay: { value: false } },
  '@renderer/store/player/action': {},
  '@common/utils/vueTools': {},
  '@renderer/store/setting': { appSetting: setting },
  '@renderer/utils/ipc': { onNewDesktopLyricProcess(listener) { connect = listener } },
}
const exportsObject = {}
const filename = path.join(__dirname, '../src/renderer/core/lyric.ts')
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(code, { exports: exportsObject, require: name => dependencies[name], console: { log() {} }, window: {}, Uint8Array, setTimeout }, { filename })
exportsObject.init()
function port() { return { messages: [], closed: false, postMessage(value) { this.messages.push(value) }, close() { this.closed = true }, start() {} } }
const desktop = port()
const island = port()
const taskbar = port()
for (const [clientId, entry] of [['desktop', desktop], ['island', island], ['taskbar', taskbar]]) connect({ event: { ports: [entry] }, params: { clientId } })
exportsObject.sendInfo()
for (const entry of [desktop, island, taskbar]) {
  assert.equal(entry.closed, false)
  assert.equal(entry.messages.at(-1).data.played_time, 2500)
  assert.equal(entry.messages.at(-1).data.playbackRate, 1.5)
  assert.equal(entry.messages.at(-1).data.offset, 200)
}
musicInfo.pic = 'data:image/png;base64,fixture'
exportsObject.sendCover()
exportsObject.setPlaybackRate(2)
for (const entry of [desktop, island, taskbar]) {
  assert.equal(entry.messages.at(-2).action, 'set_cover')
  assert.equal(entry.messages.at(-2).data, musicInfo.pic)
  assert.equal(entry.messages.at(-1).data, 2)
}
const reopened = port()
connect({ event: { ports: [reopened] }, params: { clientId: 'desktop' } })
assert.equal(desktop.closed, true)
assert.equal(island.closed, false)
assert.equal(taskbar.closed, false)
island.postMessage = () => { throw new Error('Window closed') }
exportsObject.sendCover()
assert.equal(island.closed, true)
assert.equal(reopened.messages.at(-1).data, musicInfo.pic)
assert.equal(taskbar.messages.at(-1).data, musicInfo.pic)
console.log('PASS external lyric channels: concurrent sync, milliseconds, covers, rate, reconnect and closed-window isolation')
