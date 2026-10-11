const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const vueRouter = require('vue-router')

const root = path.resolve(__dirname, '..')
const LOCAL_LIBRARY_ID = 'userlist_linkline_local'
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const settle = async() => { await vue.nextTick(); for (let i = 0; i < 20; i++) await Promise.resolve(); await vue.nextTick() }

test('the independent local route preserves legacy local-library entry links', async() => {
  const module = { exports: {} }
  vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'src/renderer/router.ts'), 'utf8')), {
    module, exports: module.exports,
    require(name) {
      if (name === 'vue-router') return { ...vueRouter, createWebHashHistory: vueRouter.createMemoryHistory }
      if (name === '@common/localMusic') return { LOCAL_LIBRARY_ID }
      if (name.endsWith('.vue')) return {}
      throw new Error(`Unexpected import ${name}`)
    },
  })
  const router = module.exports.default
  const localRoute = router.getRoutes().find(route => route.path === '/local')
  assert.equal(localRoute.name, 'LocalMusic')
  assert.equal(localRoute.meta.name, 'LocalMusic')
  // Avoid fetching the lazy page in this routing-only fixture.
  localRoute.components.default = {}
  await router.push(`/list?id=${LOCAL_LIBRARY_ID}`)
  assert.equal(router.currentRoute.value.path, '/local')
  await router.push('/list?id=love')
  assert.equal(router.currentRoute.value.path, '/list')
  assert.equal(router.currentRoute.value.query.id, 'love')
})

function libraryFixture({ previousId = 'default', ensure, select, scan, initialId = 'default' } = {}) {
  const source = fs.readFileSync(path.join(root, 'src/renderer/ui/views/Library.vue'), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
  const module = { exports: {} }, mounts = [], unmounts = [], guards = []
  const scope = vue.effectScope()
  const route = vue.reactive({ path: '/list', query: initialId ? { id: initialId } : {} })
  const calls = { navigation: [], loads: [], scan: [], saved: [], selected: [] }
  let disposed = false
  const dispose = () => { if (disposed) return; disposed = true; for (const fn of unmounts) fn(); scope.stop() }
  const navigate = async(target, kind) => {
    calls.navigation.push({ target, kind })
    const location = typeof target === 'string' ? { path: target, query: {} } : target
    if (location.path === '/local') dispose()
    route.path = location.path
    route.query = location.query || {}
    await settle()
  }
  const router = { push: target => navigate(target, 'push'), replace: target => navigate(target, 'replace') }
  const imports = {
    vue: { ...vue, onMounted: fn => mounts.push(fn), onBeforeUnmount: fn => unmounts.push(fn) },
    'vue-router': { useRoute: () => route, useRouter: () => router, onBeforeRouteUpdate: fn => guards.push(fn) },
    '@renderer/store/list/state': { defaultList: { id: 'default', name: '试听列表' }, loveList: { id: 'love', name: '我的收藏' }, userLists: vue.reactive([]) },
    '@renderer/store/list/action': { getListMusics: async id => { calls.loads.push(id); return [] } },
    '@common/constants': { LIST_IDS: { TEMP: 'temp' } },
    '@common/localMusic': { LOCAL_LIBRARY_ID, LOCAL_AUDIO_EXTENSIONS: ['mp3', 'flac'] },
    '../services/localLibrary': {
      ensureLocalLibrary: ensure || (async() => {}),
      importLocalAudio: async(...args) => { calls.scan.push(args); return scan ? scan(...args) : { cancelled: false, imported: 2, skipped: 0, failed: 0, metadataFailed: 0, errors: [] } },
    },
    '@renderer/core/player': {},
    '@renderer/utils/ipc': { showSelectDialog: async options => { calls.selected.push(options); return select ? select(options) : { canceled: false, filePaths: ['/fixture/music'] } } },
    '@renderer/utils/data': { getListPrevSelectId: async() => previousId, saveListPrevSelectId: id => calls.saved.push(id) },
    '@renderer/utils': {},
    '../services/platformAccounts': { platformPlaylists: vue.ref([]), initializePlatformAccounts: async() => {}, refreshFavorites: async() => {} },
  }
  scope.run(() => vm.runInNewContext(transpile(`${source}\nmodule.exports = { chooseList, importAudio, listId, importing, importCancelled, actionError }`), {
    module, exports: module.exports,
    Error,
    window: { app_event: { on() {}, off() {} } },
    require(name) { if (name in imports) return imports[name]; if (name.endsWith('.vue')) return {}; throw new Error(`Unexpected import ${name}`) },
  }))
  return { ...module.exports, calls, route, guards, mount: () => Promise.all(mounts.map(fn => fn())), dispose }
}

test('the music-library rail opens the local page without loading it as an ordinary playlist', async t => {
  const f = libraryFixture()
  t.after(f.dispose)
  await f.chooseList(LOCAL_LIBRARY_ID)
  assert.equal(f.calls.navigation[0].target, '/local')
  assert.equal(f.calls.loads.length, 0)
  assert.equal(f.listId.value, 'default')
})

test('same-component legacy query updates redirect before displaying the old local playlist', async t => {
  const f = libraryFixture()
  t.after(f.dispose)
  const redirect = f.guards[0]({ path: '/list', query: { id: LOCAL_LIBRARY_ID } })
  assert.equal(redirect.path, '/local')
  assert.equal(redirect.replace, true)
  // The watcher also protects callers that change a route outside the guard.
  f.route.query.id = LOCAL_LIBRARY_ID
  await settle()
  assert.equal(f.route.path, '/local')
  assert.equal(f.calls.loads.length, 0)
  assert.equal(f.listId.value, 'default')
})

test('remembering the local library opens its new independent page', async t => {
  const f = libraryFixture({ initialId: null, previousId: LOCAL_LIBRARY_ID })
  t.after(f.dispose)
  await f.mount()
  assert.equal(f.calls.navigation[0].target, '/local')
  assert.equal(f.calls.navigation[0].kind, 'replace', 'back navigation must not loop through the remembered local list')
  assert.equal(f.calls.loads.length, 0)
})

test('a delayed library initialization cannot navigate or load tracks after leaving the page', async t => {
  const pending = deferred()
  const f = libraryFixture({ initialId: null, previousId: LOCAL_LIBRARY_ID, ensure: () => pending.promise })
  t.after(f.dispose)
  const mounting = f.mount()
  f.dispose()
  pending.resolve()
  await mounting
  assert.equal(f.calls.navigation.length, 0)
  assert.equal(f.calls.loads.length, 0)
})

test('library folder import remains mounted through scanning and opens the local page only after completion', async t => {
  const pending = deferred()
  const f = libraryFixture({ scan: () => pending.promise })
  t.after(f.dispose)
  const importing = f.importAudio('folder')
  await settle()
  assert.equal(f.calls.navigation.length, 0)
  assert.equal(f.calls.scan.length, 1)
  assert.equal(f.calls.scan[0][2](), false, 'automatic navigation must not cancel the scanner')
  assert.equal(f.importing.value, true)
  assert.deepEqual(Array.from(f.calls.selected[0].properties), ['openDirectory', 'multiSelections'])
  pending.resolve({ cancelled: false, imported: 1205, skipped: 0, failed: 0, metadataFailed: 0, errors: [] })
  await importing
  assert.equal(f.importing.value, false)
  assert.equal(f.calls.navigation[0].target, '/local')
})

test('cancelled file selection and failed scans retain the original library page', async t => {
  const cancelled = libraryFixture({ select: () => ({ canceled: true, filePaths: [] }) })
  const failed = libraryFixture({ scan: async() => { throw new Error('Scan fixture failed') } })
  t.after(cancelled.dispose)
  t.after(failed.dispose)
  await cancelled.importAudio('files')
  assert.equal(cancelled.calls.scan.length, 0)
  assert.equal(cancelled.calls.navigation.length, 0)
  await failed.importAudio('folder')
  assert.equal(failed.calls.navigation.length, 0)
  assert.match(failed.actionError.value, /Scan fixture failed/)
  assert.equal(failed.importing.value, false)
})

test('leaving the library while the native picker is pending does not start a scan', async t => {
  const pending = deferred()
  const f = libraryFixture({ select: () => pending.promise })
  t.after(f.dispose)
  const importing = f.importAudio('files')
  f.dispose()
  pending.resolve({ canceled: false, filePaths: ['/fixture/song.mp3'] })
  await importing
  assert.equal(f.calls.scan.length, 0)
  assert.equal(f.calls.navigation.length, 0)
})
