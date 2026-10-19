const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../src/renderer/ui/services/nativeQrLogin.ts')
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const started = (flowId = 'flow-1') => ({ flowId, image: 'data:image/png;base64,fixture', status: 'waiting', expiresAt: 100000 })

function fixture(actions) {
  const calls = [], timers = new Map()
  let sequence = 0, now = 1000
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === 'vue') return { shallowRef: value => ({ value }) }
      if (name === 'electron') return { ipcRenderer: { async invoke(channel, params) {
        calls.push({ channel, params })
        if (channel.endsWith('_cancel')) return
        const action = actions.shift()
        assert.ok(action, `Unexpected request: ${channel}`)
        return typeof action === 'function' ? action(params) : action
      } } }
      throw new Error(`Unexpected module: ${name}`)
    },
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    Date: class extends Date { static now() { return now } },
    Error,
  }, { filename })
  return {
    ...exports, calls, timers,
    async tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); await flush() },
    now(value) { now = value },
  }
}

for (const platform of ['qq', 'netease']) {
  test(`${platform}: waiting, scanned, confirmed, and automatic close`, async() => {
    const f = fixture([started(), { flowId: 'flow-1', status: 'waiting' }, { flowId: 'flow-1', status: 'scanned' }, { flowId: 'flow-1', status: 'confirmed' }])
    await f.startNativeQrLogin(platform)
    assert.equal(f.nativeQrLogin.value.platform, platform)
    assert.equal(f.nativeQrLogin.value.status, 'waiting')
    assert.equal(f.calls[0].channel, 'platform_native_login_start')
    assert.equal(f.calls[0].params.platform, platform)
    await f.tick()
    assert.equal(f.nativeQrLogin.value.status, 'waiting')
    await f.tick()
    assert.equal(f.nativeQrLogin.value.status, 'scanned')
    await f.tick()
    assert.equal(f.nativeQrLogin.value.status, 'confirmed')
    assert.equal([...f.timers.values()][0].delay, 1200)
    await f.tick()
    assert.equal(f.nativeQrLogin.value, null)
    assert.equal(f.timers.size, 0)
  })
}

test('close cancels loading and discards a late QR response', async() => {
  const pending = deferred()
  const f = fixture([() => pending.promise])
  const opening = f.startNativeQrLogin('qq')
  assert.equal(f.nativeQrLogin.value.status, 'loading')
  f.closeNativeQrLogin()
  assert.equal(f.calls.at(-1).params.platform, 'qq')
  assert.equal(f.calls.at(-1).params.flowId, undefined)
  pending.resolve(started('old-flow'))
  await opening
  assert.equal(f.nativeQrLogin.value, null)
  assert.equal(f.calls.at(-1).params.flowId, 'old-flow')
  assert.equal(f.timers.size, 0)
})

test('refresh cancels the old flow and late responses never replace the new QR', async() => {
  const old = deferred()
  const f = fixture([() => old.promise, started('new-flow')])
  const first = f.startNativeQrLogin('qq')
  await f.startNativeQrLogin('qq')
  old.resolve(started('old-flow'))
  await first
  assert.equal(f.nativeQrLogin.value.flowId, 'new-flow')
  assert.equal(f.calls.at(-1).params.flowId, 'old-flow')
  assert.equal(f.timers.size, 1)
  f.closeNativeQrLogin()
})

test('switching platform invalidates an in-flight check', async() => {
  const old = deferred()
  const f = fixture([started('qq-flow'), () => old.promise, started('netease-flow')])
  await f.startNativeQrLogin('qq')
  await f.tick()
  await f.startNativeQrLogin('netease')
  old.resolve({ flowId: 'qq-flow', status: 'confirmed' })
  await flush()
  assert.equal(f.nativeQrLogin.value.platform, 'netease')
  assert.equal(f.nativeQrLogin.value.flowId, 'netease-flow')
  assert.equal(f.nativeQrLogin.value.status, 'waiting')
  assert.equal(f.timers.size, 1)
  f.closeNativeQrLogin()
})

test('expired QR stops polling without making a request', async() => {
  const f = fixture([started()])
  await f.startNativeQrLogin('netease')
  f.now(100001)
  await f.tick()
  assert.equal(f.nativeQrLogin.value.status, 'expired')
  assert.equal(f.calls.filter(call => call.channel.endsWith('_check')).length, 0)
  assert.equal(f.timers.size, 0)
})

test('server expiry stops polling and refresh requests a new QR', async() => {
  const f = fixture([started(), { flowId: 'flow-1', status: 'expired' }, started('flow-2')])
  await f.startNativeQrLogin('qq')
  await f.tick()
  assert.equal(f.nativeQrLogin.value.status, 'expired')
  assert.equal(f.timers.size, 0)
  await f.startNativeQrLogin('qq')
  assert.equal(f.nativeQrLogin.value.flowId, 'flow-2')
  assert.equal(f.nativeQrLogin.value.status, 'waiting')
  f.closeNativeQrLogin()
})

test('network errors remain in the modal and Electron error prefixes are stripped', async() => {
  const error = new Error("Error invoking remote method 'platform_native_login_check': Error: 网络连接失败")
  const f = fixture([started(), () => { throw error }, () => { throw new Error('请检查网络') }])
  await f.startNativeQrLogin('qq')
  await f.tick()
  assert.equal(f.nativeQrLogin.value.status, 'error')
  assert.equal(f.nativeQrLogin.value.error, '网络连接失败')
  assert.equal(f.timers.size, 0)
  await f.startNativeQrLogin('netease')
  assert.equal(f.nativeQrLogin.value.status, 'error')
  assert.equal(f.nativeQrLogin.value.error, '请检查网络')
  f.closeNativeQrLogin()
})
