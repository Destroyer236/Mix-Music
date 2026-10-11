const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
function load(file, imports = {}, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Set, require(name) { if (name in imports) return imports[name]; throw new Error(name) }, ...globals })
  return module.exports
}
const runtime = load('src/main/utils/runtimePerformance.ts')

test('runtime sets a conservative heap budget, merging existing media-key and V8 switches', () => {
  for (const old of ['--expose-gc --max-old-space-size=4096', '--max_old_space_size 2048 --trace-gc', '']) {
    const flags = new Map([['js-flags', old], ['disable-features', 'HardwareMediaKeyHandling,MediaRouter']])
    runtime.applyRuntimePerformance({ getSwitchValue: name => flags.get(name) || '', appendSwitch: (name, value = '') => flags.set(name, value) })
    assert.match(flags.get('js-flags'), /--max-old-space-size=512$/)
    assert(!/4096|2048/.test(flags.get('js-flags')))
    assert.equal(new Set(flags.get('disable-features').split(',')).size, flags.get('disable-features').split(',').length)
    assert(flags.get('disable-features').includes('HardwareMediaKeyHandling'))
    if (old.includes('--expose-gc')) assert(flags.get('js-flags').includes('--expose-gc'))
    if (old.includes('--trace-gc')) assert(flags.get('js-flags').includes('--trace-gc'))
    assert(flags.has('disable-extensions'))
    assert(flags.has('disable-background-networking'))
    // Never remove the networking, audio or graphics services needed for music.
    assert(!flags.has('disable-gpu'))
    assert(!flags.has('disable-audio-output'))
    assert(!/NetworkService|AudioService/.test(flags.get('disable-features')))
  }
})

test('database worker budget is accepted by V8 and produces a bounded heap', async() => {
  assert.equal(runtime.DATABASE_WORKER_LIMITS.maxOldGenerationSizeMb, 512)
  const { Worker } = require('node:worker_threads')
  const worker = new Worker("require('node:worker_threads').parentPort.postMessage(require('node:v8').getHeapStatistics().heap_size_limit)", { eval: true, resourceLimits: runtime.DATABASE_WORKER_LIMITS })
  const limit = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject) })
  await worker.terminate()
  assert(limit / 1048576 >= 512)
  assert(limit / 1048576 < 640)
})

test('worker failures reject active and future calls while normal calls preserve arguments', async() => {
  const { EventEmitter } = require('node:events')
  const { protectWorkerCalls } = load('src/main/worker/utils/workerLifetime.ts')
  const worker = new EventEmitter()
  const guarded = protectWorkerCalls({ sum: async(a, b) => a + b, pending: async() => new Promise(() => {}) }, worker)
  assert.equal(await guarded.sum(2, 3), 5)
  assert.equal(guarded.then, undefined)
  const pending = guarded.pending()
  worker.emit('error', new Error('ERR_WORKER_OUT_OF_MEMORY'))
  worker.emit('exit', 1)
  await assert.rejects(pending, /请重启 LinkLine.*ERR_WORKER_OUT_OF_MEMORY/)
  await assert.rejects(guarded.sum(1, 2), /请重启 LinkLine/)
})

test('unexpected worker exit also settles pending calls', async() => {
  const { EventEmitter } = require('node:events')
  const worker = new EventEmitter()
  const guarded = load('src/main/worker/utils/workerLifetime.ts').protectWorkerCalls({ pending: async() => new Promise(() => {}) }, worker)
  const pending = guarded.pending()
  worker.emit('exit', 1)
  await assert.rejects(pending, /服务已停止/)
})

test('protected Comlink calls invoke the remote method without serializing the proxy as an apply argument', async t => {
  const { EventEmitter } = require('node:events')
  const { MessageChannel } = require('node:worker_threads')
  const Comlink = require('comlink')
  const nodeEndpoint = require('comlink/dist/umd/node-adapter')
  const { port1, port2 } = new MessageChannel()
  t.after(() => { port1.close(); port2.close() })
  Comlink.expose({ sum: (a, b) => a + b }, nodeEndpoint(port1))
  const guarded = load('src/main/worker/utils/workerLifetime.ts').protectWorkerCalls(Comlink.wrap(nodeEndpoint(port2)), new EventEmitter())
  assert.equal(await guarded.sum(3, 7), 10)
})
