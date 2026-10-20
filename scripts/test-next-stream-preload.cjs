/* Background URL preparation starts early, retries failures and discards stale work. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const filename = path.resolve(__dirname, '../src/renderer/core/useApp/usePlayer/usePreloadNextMusic.ts')
const flush = async() => { for (let i = 0; i < 25; i++) await Promise.resolve() }
function fixture() {
  const bus = new EventEmitter()
  global.window = { app_event: bus }
  const f = { time: 0, now: 0, calls: 0, probeResult: true, url: 'https://fixture.test/full.wav', watches: [], cleanups: [], pending: null }
  const timers = new Map()
  const clock = { Date: { now: () => f.now }, setTimeout: callback => { const key = {}; timers.set(key, callback); return key }, clearTimeout: key => timers.delete(key) }
  class Audio {
    constructor() { this.listeners = new Map() }
    addEventListener(event, callback) { this.listeners.set(event, callback) }
    removeEventListener(event) { this.listeners.delete(event) }
    removeAttribute() { this.src = '' }
    pause() {}
    load() { if (this.src && f.probeResult !== null) queueMicrotask(() => this.listeners.get(f.probeResult ? 'canplay' : 'error')?.()) }
  }
  global.Audio = Audio
  const dependencies = {
    'test:clock': clock,
    '@common/utils/vueTools': { watch: (_sources, callback) => f.watches.push(callback), onBeforeUnmount: callback => f.cleanups.push(callback) },
    '@renderer/plugins/player': { onTimeupdate: callback => { f.update = callback; return () => {} }, getCurrentTime: () => f.time },
    '@renderer/store/player/playProgress': { playProgress: { maxPlayTime: 300, nowPlayTime: 0 } },
    '@renderer/store/player/state': { musicInfo: { id: 'current' } },
    '@renderer/core/player': { getNextPlayMusicInfo: async() => ({ musicInfo: { id: 'next' } }), resetRandomNextMusicInfo() {} },
    '@renderer/core/music': { getMusicUrl: async() => { f.calls++; return f.pending ? f.pending : f.url } },
    '@renderer/store/setting': { appSetting: {} }, '@renderer/store/player/repeatMode': { repeatMode: {} },
  }
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.require = name => dependencies[name]
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  mod._compile('const {Date,setTimeout,clearTimeout}=require("test:clock");\n' + code, filename)
  mod.exports.default()
  f.tick = async time => { f.time = time; f.update(); await flush() }
  f.expire = async() => { for (const [key, callback] of [...timers]) { if (timers.delete(key)) callback() }; await flush() }
  f.close = () => f.cleanups.forEach(callback => callback())
  return f
}
async function main() {
  let f = fixture()
  await f.tick(10); assert.equal(f.calls, 0)
  await f.tick(15); assert.equal(f.calls, 1, 'prepare the next track while current playback is still early')
  await f.tick(16); assert.equal(f.calls, 1)
  f.now = 180001
  await f.tick(210); assert.equal(f.calls, 2, 'refresh a prepared URL before its cache expires')
  f.close()
  f = fixture(); f.url = ''
  await f.tick(15); assert.equal(f.calls, 1)
  f.url = 'https://fixture.test/recovered.wav'
  await f.tick(16); assert.equal(f.calls, 1)
  await f.tick(18); assert.equal(f.calls, 2, 'failed URL preparation must remain retryable')
  f.close()
  f = fixture(); f.probeResult = null
  await f.tick(15); assert.equal(f.calls, 1)
  await f.expire(); assert.equal(f.calls, 2, 'a stalled audio probe must time out and allow a refresh')
  await f.expire()
  f.probeResult = true
  await f.tick(18); assert.equal(f.calls, 3, 'a failed refresh must not mark the next track ready')
  f.close()
  f = fixture()
  let complete
  f.pending = new Promise(resolve => { complete = resolve })
  await f.tick(15)
  window.app_event.emit('musicToggled')
  complete('https://fixture.test/old.wav'); await flush()
  f.pending = null
  await f.tick(15)
  assert.equal(f.calls, 2, 'late completion after switching tracks must not mark the new next track ready')
  f.watches[0]()
  await f.tick(18); assert.equal(f.calls, 3, 'playback preference changes invalidate prepared resources')
  f.close()
  console.log('Next stream preload: early start, refresh, retry throttle, stuck probe, stale completion and preference invalidation passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
