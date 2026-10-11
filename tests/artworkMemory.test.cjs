const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const sfc = require('@vue/compiler-sfc')

const root = path.join(__dirname, '..')
function load(source, imports, globals = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: name => {
      assert(name in imports, `Unexpected import: ${name}`)
      return imports[name]
    },
    ...globals,
  })
  return module.exports
}
const settle = async() => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)) }
const track = id => ({ id: String(id), source: 'local', name: String(id), meta: { filePath: String(id), picUrl: '' } })
function artworkFixture(resolve, synchronous = false) {
  const requests = []
  const readPic = id => { requests.push(id); return resolve(id) }
  const service = load(fs.readFileSync(path.join(root, 'src/renderer/ui/services/artwork.ts'), 'utf8'), {
    '@renderer/core/music/online': { getPicUrl: async() => '' },
  }, { window: { lx: { worker: { main: { getMusicFilePic: synchronous ? readPic : async id => readPic(id) } } } } })
  return { service, requests }
}

test('artwork requests share a promise while pending and enforce a maximum of four concurrent reads', async() => {
  const pending = new Map()
  const h = artworkFixture(id => new Promise(resolve => pending.set(id, resolve)))
  const first = h.service.resolveArtwork(track(0))
  const duplicate = h.service.resolveArtwork(track(0))
  const remaining = Array.from({ length: 8 }, (_, i) => h.service.resolveArtwork(track(i + 1)))
  assert.equal(h.requests.length, 4)
  pending.get('0')('cover:0')
  assert.deepEqual(await Promise.all([first, duplicate]), ['cover:0', 'cover:0'])
  await settle()
  assert.equal(h.requests.length, 5)
  for (let id = 1; id < 9; id++) {
    pending.get(String(id))(`cover:${id}`)
    await settle()
  }
  await Promise.all(remaining)
  assert.equal(h.requests.filter(id => id === '0').length, 1)
})

test('pending artwork remains deduplicated when the settled cache is overrun', async() => {
  const pending = new Map()
  const h = artworkFixture(id => new Promise(resolve => pending.set(id, resolve)))
  const requests = Array.from({ length: 200 }, (_, id) => h.service.resolveArtwork(track(id)))
  const duplicate = h.service.resolveArtwork(track(0))
  assert.equal(h.requests.filter(id => id === '0').length, 1)
  for (let id = 0; id < 200; id++) {
    const resolve = pending.get(String(id))
    assert.equal(typeof resolve, 'function')
    resolve(`cover:${id}`)
    await settle()
  }
  await Promise.all([...requests, duplicate])
  assert.equal(h.requests.filter(id => id === '0').length, 1)
  const reloaded = h.service.resolveArtwork(track(0))
  assert.equal(h.requests.filter(id => id === '0').length, 2, 'completed pending entry was removed when its settled entry was evicted')
  pending.get('0')('cover:0-reloaded')
  assert.equal(await reloaded, 'cover:0-reloaded')
})

test('failed artwork leaves no pending or settled entry and can be retried', async() => {
  let attempts = 0
  const h = artworkFixture(() => {
    attempts++
    if (attempts === 1) throw new Error('temporarily unavailable')
    return 'cover:recovered'
  })
  assert.equal(await h.service.resolveArtwork(track(1)), '')
  await settle()
  assert.equal(await h.service.resolveArtwork(track(1)), 'cover:recovered')
  assert.equal(h.requests.length, 2)
  assert.equal(await h.service.resolveArtwork(track(1)), 'cover:recovered')
  assert.equal(h.requests.length, 2)
})

test('a synchronous lazy-worker startup failure releases its artwork request slot', async() => {
  let attempts = 0
  const h = artworkFixture(() => {
    if (++attempts === 1) throw new Error('worker startup failed')
    return Promise.resolve('cover:retry')
  }, true)
  assert.equal(await h.service.resolveArtwork(track(1)), '')
  await settle()
  assert.equal(await h.service.resolveArtwork(track(1)), 'cover:retry')
  assert.equal(h.requests.length, 2)
})

test('normal and refresh artwork requests retain separate in-flight keys', async() => {
  const pending = []
  const h = artworkFixture(() => new Promise(resolve => pending.push(resolve)))
  const normal = h.service.resolveArtwork(track(1))
  const refreshed = h.service.resolveArtwork(track(1), null, true)
  const normalDuplicate = h.service.resolveArtwork(track(1))
  const refreshDuplicate = h.service.resolveArtwork(track(1), null, true)
  assert.equal(h.requests.length, 2)
  pending[0]('cover:normal')
  pending[1]('cover:refresh')
  assert.deepEqual(await Promise.all([normal, refreshed, normalDuplicate, refreshDuplicate]), ['cover:normal', 'cover:refresh', 'cover:normal', 'cover:refresh'])
  await settle()
  assert.equal(await h.service.resolveArtwork(track(1)), 'cover:normal')
  assert.equal(await h.service.resolveArtwork(track(1), null, true), 'cover:refresh')
  assert.equal(h.requests.length, 2)
})

test('artwork cache evicts old entries while refreshing recently used covers', async() => {
  const h = artworkFixture(id => `cover:${id}`)
  for (let id = 0; id < 128; id++) await h.service.resolveArtwork(track(id))
  await h.service.resolveArtwork(track(0))
  await h.service.resolveArtwork(track(128))
  assert.equal(h.requests.length, 129)
  await h.service.resolveArtwork(track(0))
  assert.equal(h.requests.length, 129, 'recently reused cover survives entry eviction')
  await h.service.resolveArtwork(track(1))
  assert.equal(h.requests.length, 130, 'oldest untouched cover must be read again')
})

test('large embedded artwork has a byte budget independent of the entry count', async() => {
  const h = artworkFixture(id => `data:image/jpeg;base64,${id}${'x'.repeat(120_000)}`)
  for (let id = 0; id < 45; id++) await h.service.resolveArtwork(track(id))
  await settle()
  assert.equal(h.requests.length, 45)
  await h.service.resolveArtwork(track(44))
  assert.equal(h.requests.length, 45)
  await h.service.resolveArtwork(track(0))
  assert.equal(h.requests.length, 46, 'large data URLs are evicted before hitting the entry limit')
})

function renderFixture(service) {
  let observer, callback
  const renderer = vue.createRenderer({
    createElement: tag => ({ tag, children: [], props: {}, parent: null }),
    createText: text => ({ tag: '#text', text, parent: null }),
    createComment: text => ({ tag: '#comment', text, parent: null }),
    setText(node, text) { node.text = text },
    setElementText(node, text) { node.text = text; node.children = [] },
    patchProp(node, key, _old, value) { node.props[key] = value },
    insert(node, parent, anchor = null) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
      node.parent = parent
    },
    remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  })
  const descriptor = sfc.parse(fs.readFileSync(path.join(root, 'src/renderer/ui/components/TrackArtwork.vue'), 'utf8')).descriptor
  const compiled = sfc.compileScript(descriptor, { id: 'artwork-test', inlineTemplate: true })
  const component = load(compiled.content, { vue, './UiIcon.vue': { render: () => null }, '../services/artwork': service }, {
    IntersectionObserver: class {
      constructor(handler) { callback = handler; observer = this; this.disconnected = false }
      observe() {}
      disconnect() { this.disconnected = true }
    },
  }).default
  const container = { children: [] }
  const props = vue.reactive({ track: track(1) })
  const app = renderer.createApp({ render: () => vue.h(component, props) })
  app.mount(container)
  const images = () => {
    const output = []
    const collect = node => { if (node.tag === 'img') output.push(node); for (const child of node.children ?? []) collect(child) }
    collect(container)
    return output
  }
  return { app, props, images, observer, visible(value) { callback([{ isIntersecting: value }]) } }
}

test('offscreen artwork releases its image node and reloads correctly on return', async t => {
  const requests = []
  const h = renderFixture({ resolveArtwork: async track => { requests.push(track.id); return `cover:${track.id}` } })
  t.after(() => h.app.unmount())
  assert.equal(h.images().length, 0)
  h.visible(true)
  await settle()
  assert.equal(h.images()[0].props.src, 'cover:1')
  assert.equal(h.observer.disconnected, false, 'visibility tracking continues after first display')
  h.visible(false)
  await vue.nextTick()
  assert.equal(h.images().length, 0)
  h.visible(true)
  await settle()
  assert.equal(h.images()[0].props.src, 'cover:1')
  assert.deepEqual(requests, ['1', '1'])
})

test('a late artwork result cannot restore an offscreen image or replace a newer track', async t => {
  const pending = new Map()
  const h = renderFixture({ resolveArtwork: track => new Promise(resolve => pending.set(track.id, resolve)) })
  t.after(() => h.app.unmount())
  h.visible(true)
  h.visible(false)
  pending.get('1')('stale:first')
  await settle()
  assert.equal(h.images().length, 0)
  h.props.track = track(2)
  await vue.nextTick()
  h.visible(true)
  h.props.track = track(3)
  await vue.nextTick()
  pending.get('3')('cover:3')
  await settle()
  pending.get('2')('stale:second')
  await settle()
  assert.equal(h.images()[0].props.src, 'cover:3')
})

test('a refreshed expired URL remains usable after its row leaves and reenters the screen', async t => {
  const requests = []
  const h = renderFixture({ resolveArtwork: async(track, _listId, refresh) => { requests.push(refresh); return `renewed:${track.id}` } })
  t.after(() => h.app.unmount())
  h.props.track.meta.picUrl = 'expired:cover'
  await vue.nextTick()
  h.visible(true)
  await settle()
  assert.equal(h.images()[0].props.src, 'expired:cover')
  h.images()[0].props.onError()
  await settle()
  assert.equal(h.images()[0].props.src, 'renewed:1')
  h.visible(false)
  await vue.nextTick()
  h.visible(true)
  await settle()
  assert.equal(h.images()[0].props.src, 'renewed:1')
  assert.deepEqual(requests, [true, true])
})
