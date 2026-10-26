/* Download tasks cross the Comlink worker boundary via structured clone, which
   rejects Vue proxies. Guards the store action against passing reactive track
   objects (platform playlists come back through IPC unmarked) to the worker. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const vue = require('vue')

const root = path.resolve(__dirname, '..')

function load(relative, dependencies = {}) {
  const file = path.join(root, relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('@common/')) return load(`src/common/${name.slice(8)}.ts`)
    if (name.startsWith('@renderer/')) return load(`src/renderer/${name.slice(10)}.ts`)
    if (name.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), name)
      for (const extension of ['.ts', '.js']) {
        if (fs.existsSync(resolved + extension)) return load(path.relative(root, resolved + extension))
      }
    }
    return nativeRequire(name)
  }
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file)
  return instance.exports
}

const track = (id, extra = {}) => ({
  id, source: 'kw', name: `Song ${id}`, singer: 'Singer', interval: '03:00',
  meta: { albumName: 'Album', picUrl: '', qualitys: [{ type: '128k' }] }, ...extra,
})

async function main() {
  const received = []
  const workerCalls = { downloadTasksCreate: [] }
  global.window = {
    i18n: { t: text => text },
    app_event: { downloadListUpdate: () => {} },
    lx: {
      worker: {
        download: {
          // Mirror the real boundary: the call is Comlink → worker.postMessage,
          // which structured-clones every argument.
          createDownloadTasks: async(...args) => {
            received.push(structuredClone(args))
            return args[0].map(item => ({ id: `${item.id}_${args[1]}`, metadata: { musicInfo: item, quality: args[1] } }))
          },
        },
      },
    },
  }
  const deps = {
    '@renderer/utils/ipc': {
      downloadTasksGet: async() => [],
      downloadTasksCreate: async list => { workerCalls.downloadTasksCreate.push(list) },
      downloadTasksRemove: async() => {},
      downloadTasksUpdate: async() => {},
    },
    '@renderer/core/music/online': { getMusicUrl: async() => '', getPicUrl: async() => null, getLyricInfo: async() => null },
    '@renderer/worker/utils': { proxyCallback: fn => fn },
    '@renderer/utils': { arrPush: (a, b) => a.push(...b), arrUnshift: (a, b) => a.unshift(...b), joinPath: (...p) => p.join('/') },
    '../setting': { appSetting: vue.reactive({ 'download.fileName': '%', 'download.maxDownloadNum': 3 }) },
    '..': { qualityList: vue.shallowRef({ kw: ['128k'] }) },
    '../index': { proxy: { enable: false, host: '', port: '', envProxy: null } },
    './utils': { buildSavePath: () => 'C:\\tmp' },
  }

  // The failing user flow: platform playlist tracks read out of a deep-reactive
  // ref() container, plus a raw object carrying a nested reactive field.
  const reactiveStore = vue.reactive({ tracks: [track('proxy_track')] })
  const nested = track('nested_track')
  nested.meta.qualitys = vue.reactive([{ type: '128k' }])
  const list = [...reactiveStore.tracks, nested]
  list[0].meta.albumName // touch through the proxy chain like the UI does

  const { createDownloadTasks } = load('src/renderer/store/download/action.ts', deps)
  await createDownloadTasks(list, '128k')

  assert.equal(received.length, 1, 'worker call recorded')
  for (const arg of received[0]) {
    const label = typeof arg === 'object' ? JSON.stringify(arg).slice(0, 60) : String(arg)
    void label // structuredClone above already threw if any argument was uncloneable
  }
  const sent = received[0][0]
  assert.equal(sent.length, 2, 'both tracks forwarded')
  assert.ok(!vue.isProxy(sent[0]) && !vue.isProxy(sent[1]), 'forwarded track objects are raw')
  assert.ok(!vue.isProxy(sent[0].meta.qualitys) && !vue.isProxy(sent[1].meta.qualitys), 'nested reactive fields are detached')
  assert.equal(sent[0].name, 'Song proxy_track', 'track data survives the round trip')
  assert.equal(workerCalls.downloadTasksCreate[0].length, 2, 'both distinct tasks entered the list')
  console.log('download task clone guard: OK')
}

main().catch(error => { console.error(error); process.exit(1) })
