/* Run the real player plugin against media-element metadata/reset semantics. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
let audio
class AudioFixture extends EventTarget {
  constructor() {
    super()
    audio = this
    this.currentTime = 60
    this.duration = NaN
    this.autoplay = false
    this.paused = true
  }

  set src(value) { this._src = value; this.currentTime = 0 }
  get src() { return this._src }
  pause() { this.paused = true }
  removeAttribute() {}
}
global.window = { Audio: AudioFixture }
const file = path.resolve(__dirname, '../src/renderer/plugins/player/index.ts')
const instance = new Module(file, module)
instance.filename = file
instance.paths = Module._nodeModulePaths(path.dirname(file))
const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify('file:///fixture/'))
instance._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
const player = instance.exports
player.createAudio()
player.setResource('https://audio.test/bad320.mp3', { time: 60, autoplay: false })
assert.equal(player.getCurrentTime(), 0, 'a newly assigned media resource resets currentTime before metadata')
assert.equal(player.getResourceTime(), 60, 'the requested position survives an HTTP/decode failure before metadata')
const captured = player.getResourceTime()
player.setStop()
assert.equal(player.getResourceTime(), 0, 'Stop clears the pending restore point')
player.setResource('https://audio.test/good128.mp3', { time: captured, autoplay: false })
audio.duration = 180
audio.dispatchEvent(new Event('loadedmetadata'))
assert.equal(player.getCurrentTime(), 60)
assert.equal(player.getAutoplay(), false)

player.setResource('https://audio.test/seek.mp3', { time: 60, autoplay: false })
player.setCurrentTime(24)
assert.equal(player.getResourceTime(), 24, 'an explicit seek replaces the pending restore point')
audio.currentTime = 0
audio.dispatchEvent(new Event('loadedmetadata'))
assert.equal(player.getCurrentTime(), 24)
audio.currentTime = 28
assert.equal(player.getResourceTime(), 28, 'after metadata, the actual playback clock is authoritative')

player.setResource('https://audio.test/old.mp3', { time: 90, autoplay: false })
player.setResource('https://audio.test/next.mp3')
audio.dispatchEvent(new Event('loadedmetadata'))
assert.equal(player.getCurrentTime(), 0, 'new playback cannot inherit an old pending seek')
player.setResource('https://audio.test/preview.mp3', { time: 70, autoplay: false })
audio.duration = 30
audio.dispatchEvent(new Event('loadedmetadata'))
assert.equal(player.getCurrentTime(), 30, 'restore is bounded by the delivered duration')
player.setStop()
console.log('Real player plugin: pending metadata position, paused HTTP fallback, explicit seek, stop, new resource and duration bounds passed.')
