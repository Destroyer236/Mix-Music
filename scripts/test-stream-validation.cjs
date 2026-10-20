/* Validate actual media lengths and retry the resolver without accepting previews as full songs. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(relative, dependencies = {}) {
  const filename = path.join(root, relative)
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  const native = mod.require.bind(mod)
  mod.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : native(name)
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
  return mod.exports
}
const media = new Map()
let audioCreated = 0
global.Audio = class {
  constructor() { audioCreated++ }
  load() {
    if (!this.src) return
    queueMicrotask(() => {
      const value = media.get(this.src)
      if (value === 'error') this.onerror?.()
      else { this.duration = value; this.onloadedmetadata?.() }
    })
  }
  removeAttribute() { this.src = '' }
}
const validation = load('src/renderer/ui/services/streamValidation.ts')
const song = { id: 'wy_287063', source: 'wy', name: '我怀念的', singer: '孙燕姿', interval: '04:49', meta: { songId: 287063 } }
function fixture(candidates) {
  const calls = []
  const accepted = []
  const online = load('src/renderer/core/music/online.ts', {
    '@renderer/store/list/action': {}, '@renderer/utils/ipc': {}, './utils': {},
    '@renderer/ui/services/streamValidation': validation,
    '@renderer/ui/services/platformPlayback': {
      preferredQuality: { value: 'auto' },
      acceptStream: (_song, stream) => accepted.push(stream),
      resolvePlatformStream: async(_song, refresh, _toggle, _quality, options) => {
        calls.push({ refresh, ...options })
        const item = candidates.find(item => !options.rejectedUrls.includes(item.url))
        if (!item) throw new Error('No other source')
        return item
      },
    },
  })
  return { calls, accepted, get: (options = {}) => online.getMusicUrl({ musicInfo: song, isRefresh: false, ...options }) }
}
const stream = (url, extra = {}) => ({ url: 'https://fixture.test/' + url, type: '320k', platform: '公益', musicInfo: song, ...extra })
async function main() {
  assert.equal(validation.isTruncatedStream('04:49', 60), true)
  assert.equal(validation.isTruncatedStream('04:49', 30), true)
  assert.equal(validation.isTruncatedStream('04:49', 288.7), false)
  assert.equal(validation.isTruncatedStream('01:00', 60), false, 'genuine short tracks remain playable')
  assert.equal(validation.isTruncatedStream('', 60), false, 'unknown duration must not become an invented full length')
  const short = stream('short.mp3'), full = stream('full.mp3'), broken = stream('broken.mp3')
  media.set(short.url, 60); media.set(full.url, 289.07); media.set(broken.url, 'error')
  let f = fixture([short, full])
  assert.equal(await f.get(), full.url)
  assert.deepEqual(f.calls[1].rejectedUrls, [short.url])
  assert.equal(f.calls[1].refresh, false)
  assert.equal(f.accepted.length, 1)
  assert.notEqual(f.accepted[0].isTrial, true)
  f = fixture([short])
  assert.equal(await f.get(), short.url)
  assert.equal(f.accepted[0].isTrial, true)
  assert.equal(f.accepted[0].qualityLabel, '试听')
  f = fixture([broken, full])
  assert.equal(await f.get(), full.url)
  assert.deepEqual(f.calls[1].rejectedUrls, [broken.url])
  f = fixture([stream('official-preview.mp3', { isTrial: true })])
  const before = audioCreated
  await f.get()
  assert.equal(audioCreated, before, 'already labelled final preview needs no second probe')
  assert.equal(f.accepted[0].isTrial, true)
  const cached = audioCreated
  await Promise.all([validation.readStreamDuration(full.url), validation.readStreamDuration(full.url)])
  assert.equal(audioCreated, cached, 'verified URLs reuse cached metadata')
  f = fixture([short, full])
  assert.equal(await f.get({ rejectedUrls: [short.url] }), full.url)
  assert.deepEqual(f.calls[0].rejectedUrls, [short.url])
  console.log('Stream validation: one-minute previews, full recording, genuine short songs, invalid media, cache, rejection propagation and final preview fallback passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
