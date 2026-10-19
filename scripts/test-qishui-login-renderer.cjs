/* Offline QR interaction regressions; IPC and time are fully isolated. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { renderToString } = require('@vue/server-renderer')

const filename = path.resolve(__dirname, '../src/renderer/ui/services/qishuiLogin.ts')
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = () => new Promise(resolve => setImmediate(resolve))
const started = (flowId = 'flow-1') => ({ flowId, image: 'data:image/png;base64,fixture', status: 'waiting', expiresAt: 100000 })
const reject = message => () => { throw new Error(message) }
const deferred = () => {
  let fulfill, fail
  const promise = new Promise((resolve, reject) => { fulfill = resolve; fail = reject })
  return { promise, resolve: fulfill, reject: fail }
}

function fixture(actions) {
  const calls = []
  const timers = new Map()
  let sequence = 0
  let now = 1000
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === 'vue') return vue
      if (name === 'electron') {
        return {
          ipcRenderer: {
            async invoke(channel, params) {
              calls.push({ channel, params })
              if (channel.endsWith('_cancel')) return
              const action = actions.shift()
              assert.ok(action, `Unexpected request: ${channel}`)
              return typeof action === 'function' ? action(params) : action
            },
          },
        }
      }
      throw new Error(`Unexpected module: ${name}`)
    },
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    Date: class extends Date { static now() { return now } },
    Error,
  }, { filename })
  return {
    ...exports,
    calls,
    timers,
    async tick() {
      const next = timers.entries().next().value
      assert.ok(next, 'Expected a scheduled poll or close')
      const [id, timer] = next
      timers.delete(id)
      timer.callback()
      await flush()
    },
    now(value) { now = value },
    checks() { return calls.filter(call => call.channel.endsWith('_check')) },
  }
}

async function renderDialog(login) {
  const filename = path.resolve(__dirname, '../src/renderer/ui/components/QishuiLogin.vue')
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'qishui-login-test', inlineTemplate: true })
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === 'vue') return vue
      if (name === '../services/qishuiLogin') return login
      if (name === './UiModal.vue') return { default: { setup: (_, { slots }) => () => vue.h('section', [slots.default?.(), slots.footer?.()]) } }
      throw new Error(`Unexpected component module: ${name}`)
    },
  }, { filename })
  return renderToString(vue.createSSRApp(exports.default))
}

test('waiting, scanned, confirmed and automatic close follow a single QR flow', async() => {
  const f = fixture([started(), { status: 'waiting' }, { status: 'scanned' }, { status: 'confirmed' }])
  await f.startQishuiLogin()
  assert.equal(f.qishuiLogin.value.status, 'waiting')
  assert.equal(f.calls[0].channel, 'platform_qishui_login_start')
  await f.tick()
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'scanned')
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'confirmed')
  assert.equal([...f.timers.values()][0].delay, 1200)
  await f.tick()
  assert.equal(f.qishuiLogin.value, null)
  assert.equal(f.timers.size, 0)
  assert.ok(f.checks().every(call => call.params.flowId === 'flow-1'))
})

test('official verification extends the QR deadline and stays open until confirmation', async() => {
  const f = fixture([started(), { status: 'verifying', expiresAt: 601000 }, { status: 'verifying' }, { status: 'confirmed' }])
  await f.startQishuiLogin()
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'verifying')
  assert.equal(f.qishuiLogin.value.expiresAt, 601000)
  assert.equal([...f.timers.values()][0].delay, 2500)
  f.now(100001)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'verifying')
  assert.equal(f.qishuiLogin.value.expiresAt, 601000)
  assert.equal(f.timers.size, 1)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'confirmed')
  assert.equal([...f.timers.values()][0].delay, 1200)
  await f.tick()
  assert.equal(f.qishuiLogin.value, null)
})

test('official verification expires at its extended deadline without another request', async() => {
  const f = fixture([started(), { status: 'verifying', expiresAt: 601000 }])
  await f.startQishuiLogin()
  await f.tick()
  f.now(601000)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'expired')
  assert.equal(f.checks().length, 1)
  assert.equal(f.timers.size, 0)
  f.closeQishuiLogin()
})

test('verification without an optional deadline relies on server expiry instead of the old QR deadline', async() => {
  const f = fixture([started(), { status: 'verifying' }, { status: 'verifying' }, { status: 'expired' }])
  await f.startQishuiLogin()
  await f.tick()
  f.now(100001)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'verifying')
  assert.equal(f.checks().length, 2)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'expired')
  assert.equal(f.timers.size, 0)
  f.closeQishuiLogin()
})

test('the verification dialog explains the official window and keeps close and refresh available', async() => {
  const f = fixture([started(), { status: 'verifying', expiresAt: 601000 }])
  await f.startQishuiLogin()
  await f.tick()
  const html = await renderDialog(f)
  assert.match(html, /role="status"[^>]*>请在弹出的汽水音乐官方窗口中完成安全验证<\/p>/)
  assert.match(html, /<button[^>]*>关闭<\/button>/)
  assert.match(html, /<button[^>]*>刷新二维码<\/button>/)
  assert.doesNotMatch(html, /disabled/)
  assert.equal(f.timers.size, 1)
  f.closeQishuiLogin()
})

test('closing during official verification cancels the flow and prevents a late confirmation reopening it', async() => {
  const pending = deferred()
  const f = fixture([started(), { status: 'verifying', expiresAt: 601000 }, () => pending.promise])
  await f.startQishuiLogin()
  await f.tick()
  await f.tick()
  f.closeQishuiLogin()
  assert.equal(f.calls.at(-1).channel, 'platform_qishui_login_cancel')
  assert.equal(f.calls.at(-1).params.flowId, 'flow-1')
  pending.resolve({ status: 'confirmed' })
  await flush()
  assert.equal(f.qishuiLogin.value, null)
  assert.equal(f.timers.size, 0)
})

test('refreshing during official verification cancels the old window and ignores its late result', async() => {
  const pending = deferred()
  const f = fixture([started(), { status: 'verifying', expiresAt: 601000 }, () => pending.promise, started('flow-2'), { status: 'scanned' }])
  await f.startQishuiLogin()
  await f.tick()
  await f.tick()
  await f.startQishuiLogin()
  assert.equal(f.calls.find(call => call.channel.endsWith('_cancel')).params.flowId, 'flow-1')
  pending.resolve({ status: 'confirmed', expiresAt: 601000 })
  await flush()
  assert.equal(f.qishuiLogin.value.flowId, 'flow-2')
  assert.equal(f.qishuiLogin.value.expiresAt, started().expiresAt)
  assert.equal(f.qishuiLogin.value.status, 'waiting')
  assert.equal(f.timers.size, 1)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'scanned')
  assert.equal(f.checks().at(-1).params.flowId, 'flow-2')
  f.closeQishuiLogin()
})

for (const message of ['汽水音乐登录请求超时，请检查网络后重试', '汽水音乐登录连接失败，请检查网络后重试']) {
  test(`a temporary failure keeps the same QR polling until confirmation: ${message}`, async() => {
    const f = fixture([started(), reject(message), { status: 'confirmed' }])
    await f.startQishuiLogin()
    await f.tick()
    assert.equal(f.qishuiLogin.value.status, 'waiting')
    assert.equal(f.qishuiLogin.value.flowId, 'flow-1')
    assert.equal(f.qishuiLogin.value.image, started().image)
    assert.equal(f.timers.size, 1)
    await f.tick()
    assert.equal(f.qishuiLogin.value.status, 'confirmed')
    assert.equal(f.qishuiLogin.value.error, '')
    assert.equal(f.calls.filter(call => call.channel.endsWith('_start')).length, 1)
    assert.equal(f.calls.filter(call => call.channel.endsWith('_cancel')).length, 0)
    assert.ok(f.checks().every(call => call.params.flowId === 'flow-1'))
    f.closeQishuiLogin()
  })
}

test('a scanned QR survives temporary failures and clears the warning after a successful response', async() => {
  const prefix = "Error invoking remote method 'platform_qishui_login_check': Error: "
  const f = fixture([started(), { status: 'scanned' }, reject(prefix + '汽水音乐登录请求超时，请检查网络后重试'), { status: 'scanned' }, { status: 'confirmed' }])
  await f.startQishuiLogin()
  await f.tick()
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'scanned')
  assert.doesNotMatch(f.qishuiLogin.value.error, /Error invoking remote method/)
  assert.equal(f.timers.size, 1)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'scanned')
  assert.equal(f.qishuiLogin.value.error, '')
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'confirmed')
  f.closeQishuiLogin()
})

test('rate limiting preserves a scanned QR, skips cooldown checks and resumes official verification', async() => {
  const f = fixture([started(), { status: 'scanned', retryAt: 6000 }, { status: 'verifying', expiresAt: 601000 }, { status: 'confirmed' }])
  await f.startQishuiLogin()
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'scanned')
  assert.equal(f.qishuiLogin.value.retryAt, 6000)
  assert.equal(f.qishuiLogin.value.image, started().image)
  assert.equal(f.qishuiLogin.value.error, '')
  assert.equal([...f.timers.values()][0].delay, 5000)
  const limited = await renderDialog(f)
  assert.match(limited, /role="status"[^>]*>汽水音乐查询暂时受限，正在等待自动重试…<\/p>/)
  assert.doesNotMatch(limited, /class="ui-qishui-code inactive"|请在手机上确认|class="error"/)
  f.now(2000)
  await f.tick()
  assert.equal(f.checks().length, 1, 'An early timer must not poll during the server cooldown')
  assert.equal([...f.timers.values()][0].delay, 4000)
  f.now(6000)
  await f.tick()
  assert.equal(f.checks().length, 2)
  assert.equal(f.qishuiLogin.value.status, 'verifying')
  assert.equal(f.qishuiLogin.value.retryAt, undefined)
  assert.doesNotMatch(await renderDialog(f), /查询暂时受限/)
  assert.match(await renderDialog(f), /请在弹出的汽水音乐官方窗口中完成安全验证/)
  assert.equal([...f.timers.values()][0].delay, 2500)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'confirmed')
  f.closeQishuiLogin()
})

test('a normal response clears the rate limit notice and returns to the regular poll interval', async() => {
  const f = fixture([started(), { status: 'waiting', retryAt: 11000 }, { status: 'scanned' }])
  await f.startQishuiLogin()
  await f.tick()
  assert.equal([...f.timers.values()][0].delay, 10000)
  f.now(11000)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'scanned')
  assert.equal(f.qishuiLogin.value.retryAt, undefined)
  assert.equal([...f.timers.values()][0].delay, 2500)
  assert.doesNotMatch(await renderDialog(f), /查询暂时受限/)
  f.closeQishuiLogin()
})

test('rate limit waiting ends at QR expiration without another request', async() => {
  const f = fixture([started(), { status: 'scanned', retryAt: 150000 }])
  await f.startQishuiLogin()
  await f.tick()
  assert.equal([...f.timers.values()][0].delay, 99000, 'A long cooldown must wake at the QR deadline')
  f.now(100000)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'expired')
  assert.equal(f.qishuiLogin.value.retryAt, undefined)
  assert.equal(f.qishuiLogin.value.error, '')
  assert.equal(f.checks().length, 1)
  assert.equal(f.timers.size, 0)
  assert.doesNotMatch(await renderDialog(f), /查询暂时受限/)
  f.closeQishuiLogin()
})

test('closing and refreshing during a rate limit wait cancel its timer and clear the notice', async() => {
  const f = fixture([started(), { status: 'scanned', retryAt: 31000 }, started('flow-2')])
  await f.startQishuiLogin()
  await f.tick()
  assert.equal([...f.timers.values()][0].delay, 30000)
  f.closeQishuiLogin()
  assert.equal(f.qishuiLogin.value, null)
  assert.equal(f.timers.size, 0)
  assert.equal(f.calls.at(-1).channel, 'platform_qishui_login_cancel')
  assert.equal(f.calls.at(-1).params.flowId, 'flow-1')
  await f.startQishuiLogin()
  assert.equal(f.qishuiLogin.value.flowId, 'flow-2')
  assert.equal(f.qishuiLogin.value.retryAt, undefined)
  assert.equal(f.qishuiLogin.value.status, 'waiting')
  assert.equal([...f.timers.values()][0].delay, 2500)
  assert.doesNotMatch(await renderDialog(f), /查询暂时受限/)
  f.closeQishuiLogin()
})

test('temporary retries stop at QR expiration without another request', async() => {
  const f = fixture([started(), reject('汽水音乐登录请求超时，请检查网络后重试')])
  await f.startQishuiLogin()
  await f.tick()
  assert.equal(f.timers.size, 1)
  f.now(100001)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'expired')
  assert.equal(f.qishuiLogin.value.error, '')
  assert.equal(f.checks().length, 1)
  assert.equal(f.timers.size, 0)
  f.closeQishuiLogin()
})

test('business rejection, security challenges and unknown errors stop polling', async() => {
  for (const message of ['汽水音乐查询扫码状态失败：登录应用参数被平台拒绝（错误码 22）', '汽水音乐查询扫码状态失败：平台返回错误（错误码 2156）', '汽水音乐要求安全验证，请先在官方客户端完成验证后重新登录', '汽水音乐未返回可识别的扫码状态，请刷新二维码后重试']) {
    const f = fixture([started(), reject("Error invoking remote method 'platform_qishui_login_check': Error: " + message)])
    await f.startQishuiLogin()
    await f.tick()
    assert.equal(f.qishuiLogin.value.status, 'error')
    assert.equal(f.qishuiLogin.value.error, message)
    assert.equal(f.timers.size, 0)
    f.closeQishuiLogin()
  }
})

test('a QR creation failure remains terminal until the user requests a fresh QR', async() => {
  const f = fixture([reject('汽水音乐登录连接失败，请检查网络后重试'), started('flow-2')])
  await f.startQishuiLogin()
  assert.equal(f.qishuiLogin.value.status, 'error')
  assert.equal(f.timers.size, 0)
  await f.startQishuiLogin()
  assert.equal(f.qishuiLogin.value.flowId, 'flow-2')
  assert.equal(f.qishuiLogin.value.error, '')
  f.closeQishuiLogin()
})

test('closing during a temporary retry clears the timer and cancels the flow', async() => {
  const f = fixture([started(), reject('汽水音乐登录连接失败，请检查网络后重试')])
  await f.startQishuiLogin()
  await f.tick()
  assert.equal(f.timers.size, 1)
  f.closeQishuiLogin()
  assert.equal(f.qishuiLogin.value, null)
  assert.equal(f.timers.size, 0)
  assert.equal(f.calls.at(-1).channel, 'platform_qishui_login_cancel')
  assert.equal(f.calls.at(-1).params.flowId, 'flow-1')
})

test('a late temporary error cannot restart polling after the dialog was closed', async() => {
  const pending = deferred()
  const f = fixture([started(), () => pending.promise])
  await f.startQishuiLogin()
  await f.tick()
  f.closeQishuiLogin()
  pending.reject(new Error('汽水音乐登录请求超时，请检查网络后重试'))
  await flush()
  assert.equal(f.qishuiLogin.value, null)
  assert.equal(f.timers.size, 0)
})

test('refresh invalidates a late error without replacing or duplicating the new poll', async() => {
  const pending = deferred()
  const f = fixture([started(), () => pending.promise, started('flow-2'), { status: 'confirmed' }])
  await f.startQishuiLogin()
  await f.tick()
  await f.startQishuiLogin()
  pending.reject(new Error('汽水音乐登录连接失败，请检查网络后重试'))
  await flush()
  assert.equal(f.qishuiLogin.value.flowId, 'flow-2')
  assert.equal(f.qishuiLogin.value.status, 'waiting')
  assert.equal(f.qishuiLogin.value.error, '')
  assert.equal(f.timers.size, 1)
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'confirmed')
  assert.equal(f.checks().at(-1).params.flowId, 'flow-2')
  f.closeQishuiLogin()
})

test('server expiry stops polling and a fresh QR remains available', async() => {
  const f = fixture([started(), { status: 'expired' }, started('flow-2')])
  await f.startQishuiLogin()
  await f.tick()
  assert.equal(f.qishuiLogin.value.status, 'expired')
  assert.equal(f.timers.size, 0)
  await f.startQishuiLogin()
  assert.equal(f.qishuiLogin.value.flowId, 'flow-2')
  assert.equal(f.qishuiLogin.value.status, 'waiting')
  f.closeQishuiLogin()
})

test('closing while QR creation is pending discards and cancels its late response', async() => {
  const pending = deferred()
  const f = fixture([() => pending.promise])
  const opening = f.startQishuiLogin()
  assert.equal(f.qishuiLogin.value.status, 'loading')
  f.closeQishuiLogin()
  pending.resolve(started())
  await opening
  assert.equal(f.qishuiLogin.value, null)
  assert.equal(f.timers.size, 0)
  assert.equal(f.calls.at(-1).channel, 'platform_qishui_login_cancel')
  assert.equal(f.calls.at(-1).params.flowId, 'flow-1')
})
