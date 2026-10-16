const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../src/main/modules/platformAccounts/qishuiLogin.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const subject = new Module(filename, module)
subject.filename = filename
subject.paths = module.paths
subject._compile(compiled, filename)
const { createQishuiLogin } = subject.exports
const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const response = (data, cookies = [], headers = {}) => new Response(JSON.stringify({ message: 'success', data }), { headers: [...Object.entries(headers), ...cookies.map(value => ['Set-Cookie', value])] })
const qr = (patch = {}) => response({ token: 'private-upstream-token', qrcode: png, expire_time: Math.floor(Date.now() / 1000) + 300, ...patch }, ['passport_csrf_token=flow-csrf; Domain=.qishui.com; Path=/; Secure; HttpOnly'])
const confirmed = () => response({ status: 'confirmed', error_code: 0 }, ['sessionid=fresh-account; Domain=.qishui.com; Path=/; Secure; HttpOnly; SameSite=None'])
const key = value => `${String(value.domain ?? 'api.qishui.com').replace(/^\./, '')}|${value.path ?? '/'}|${value.name}`

function fixture(actions = [], callback = async() => {}, options = {}) {
  const requests = []
  const jar = new Map((options.original ?? []).map(cookie => [key(cookie), cookie]))
  const mutations = []
  let callbacks = 0
  const context = {
    session: {
      async fetch(url, init) {
        requests.push({ url: new URL(url), init })
        const action = actions.shift()
        assert.ok(action, 'unexpected network request')
        return typeof action === 'function' ? action(url, init) : action
      },
      cookies: {
        async get() { return [...jar.values()] },
        async set(cookie) {
          mutations.push({ op: 'set', name: cookie.name })
          jar.set(key(cookie), { ...cookie, domain: cookie.domain ?? 'api.qishui.com', path: cookie.path ?? '/', hostOnly: !cookie.domain })
          await options.onSet?.(cookie)
        },
        async remove(url, name) {
          mutations.push({ op: 'remove', name })
          for (const [id, cookie] of jar) if (cookie.name === name && new URL(url).hostname === String(cookie.domain).replace(/^\./, '')) jar.delete(id)
        },
        async flushStore() {},
      },
    },
    async cookies() { return Object.fromEntries([...jar.values()].map(cookie => [cookie.name, cookie.value])) },
  }
  const login = createQishuiLogin(context, async() => { callbacks++; await callback(context) })
  return { login, context, requests, jar, mutations, callbacks: () => callbacks }
}

test('QR stays private; poll uses exact official endpoint and staged CSRF; confirmed is idempotent', async() => {
  const f = fixture([qr(), response({ status: 'scanned' }), confirmed()], async context => {
    assert.equal((await context.cookies()).sessionid, 'fresh-account')
  })
  const started = await f.login.start(17)
  assert.deepEqual(Object.keys(started).sort(), ['expiresAt', 'flowId', 'image', 'status'])
  assert.match(started.flowId, /^[0-9a-f-]{36}$/)
  assert.notEqual(started.flowId, 'private-upstream-token')
  assert.equal(started.image, png)
  assert.equal(f.jar.size, 0)
  assert.equal(f.requests[0].url.origin, 'https://api.qishui.com')
  assert.equal(f.requests[0].url.pathname, '/passport/web/get_qrcode/')
  assert.equal(f.requests[0].url.searchParams.get('aid'), '386088')
  assert.equal(f.requests[0].url.searchParams.get('passport_jssdk_type'), 'lite')
  assert.equal(f.requests[0].init.credentials, 'omit')
  assert.equal(f.requests[0].init.redirect, 'error')
  assert.equal((await f.login.check(17, started.flowId)).status, 'scanned')
  assert.equal(f.requests[1].url.pathname, '/passport/web/check_qrconnect/')
  assert.equal(f.requests[1].init.headers.get('cookie'), 'passport_csrf_token=flow-csrf')
  assert.equal(new URLSearchParams(f.requests[1].init.body).get('token'), 'private-upstream-token')
  assert.equal((await f.login.check(17, started.flowId)).status, 'confirmed')
  assert.equal((await f.login.check(17, started.flowId)).status, 'confirmed')
  assert.equal(f.callbacks(), 1)
  assert.equal(f.requests.length, 3)
  assert.equal(f.login.cancel(17, started.flowId), false, 'completed flow cannot cancel successful sync')
})

test('ownership and stale flow guards reject calls without network or account mutation', async() => {
  const f = fixture([qr()])
  const started = await f.login.start(1)
  await assert.rejects(f.login.check(2, started.flowId), /不属于/)
  assert.throws(() => f.login.cancel(2, started.flowId), /不属于/)
  await assert.rejects(f.login.check(1, 'unknown'), /已取消/)
  assert.equal(f.login.cancel(1, 'unknown'), false)
  assert.equal(f.requests.length, 1)
  assert.equal(f.login.cancel(1, started.flowId), true)
  assert.equal(f.login.cancel(1, started.flowId), false)
  await assert.rejects(f.login.check(1, started.flowId), /已取消/)
  await assert.rejects(f.login.start(0), /无效/)
})

test('concurrent check calls share exactly one upstream check and one callback', async() => {
  const wait = deferred()
  const f = fixture([qr(), () => wait.promise])
  const started = await f.login.start(1)
  const a = f.login.check(1, started.flowId)
  const b = f.login.check(1, started.flowId)
  assert.equal(f.requests.length, 2)
  wait.resolve(confirmed())
  const values = await Promise.all([a, b])
  assert.equal(values[0].status, 'confirmed')
  assert.deepEqual(values[0], values[1])
  assert.equal(f.callbacks(), 1)
})

test('cancel during QR creation discards late cookies and response', async() => {
  const wait = deferred()
  const f = fixture([() => wait.promise])
  const starting = f.login.start(1)
  const rejected = assert.rejects(starting, /已取消/)
  await tick()
  assert.equal(f.login.cancel(1), true)
  assert.equal(f.requests[0].init.signal.aborted, true)
  wait.resolve(qr())
  await rejected
  assert.equal(f.jar.size, 0)
  assert.equal(f.callbacks(), 0)
})

test('restart discards old pending QR without invalidating the newer flow', async() => {
  const wait = deferred()
  const f = fixture([() => wait.promise, qr({ token: 'second-token' }), response({ status: 'new' })])
  const old = f.login.start(1)
  const rejected = assert.rejects(old, /已取消/)
  await tick()
  const current = await f.login.start(1)
  wait.resolve(qr())
  await rejected
  assert.equal(f.login.cancel(1, 'stale-flow-id'), false)
  assert.equal((await f.login.check(1, current.flowId)).status, 'waiting')
  f.login.cancelAll()
})

test('cancel in-flight confirmed response never commits its session or callback', async() => {
  const wait = deferred()
  const f = fixture([qr(), () => wait.promise])
  const started = await f.login.start(1)
  const pending = f.login.check(1, started.flowId)
  const rejected = assert.rejects(pending, /已取消/)
  f.login.cancelAll()
  wait.resolve(confirmed())
  await rejected
  assert.equal(f.jar.size, 0)
  assert.equal(f.callbacks(), 0)
})

test('cancel during cookie transfer rolls back before allowing the next QR to start', async() => {
  const gate = deferred()
  let entered = false
  const original = { name: 'sessionid', value: 'original-account', domain: '.qishui.com', path: '/', secure: true, httpOnly: true, hostOnly: false }
  const f = fixture([qr(), confirmed(), qr()], async() => {}, { original: [original], async onSet(cookie) { if (cookie.value === 'fresh-account') { entered = true; await gate.promise } } })
  const started = await f.login.start(1)
  const checking = f.login.check(1, started.flowId)
  const rejected = assert.rejects(checking, /已取消/)
  while (!entered) await tick()
  assert.equal(f.login.cancel(1, started.flowId), true)
  const next = f.login.start(1)
  await tick()
  assert.equal(f.requests.length, 2, 'restart waits for cookie rollback')
  gate.resolve()
  await rejected
  await next
  assert.equal((await f.context.cookies()).sessionid, 'original-account')
  assert.equal(f.callbacks(), 0)
  f.login.cancelAll()
})

test('cancel during profile verification rolls back and rejects confirmation', async() => {
  const gate = deferred()
  const f = fixture([qr(), confirmed()], async() => gate.promise)
  const started = await f.login.start(1)
  const pending = f.login.check(1, started.flowId)
  const rejected = assert.rejects(pending, /已取消/)
  while (f.callbacks() === 0) await tick()
  f.login.cancelAll()
  gate.resolve()
  await rejected
  assert.equal(f.jar.size, 0)
})

test('profile verification failure restores the previous persisted login', async() => {
  const original = { name: 'sessionid', value: 'original-account', domain: '.qishui.com', path: '/', secure: true, httpOnly: true, hostOnly: false }
  const f = fixture([qr(), confirmed()], async() => { throw new Error('profile denied') }, { original: [original] })
  const started = await f.login.start(1)
  await assert.rejects(f.login.check(1, started.flowId), /profile denied/)
  assert.equal((await f.context.cookies()).sessionid, 'original-account')
  f.login.cancelAll()
})

test('a confirmed status without newly issued authentication cookie cannot reuse an older account', async() => {
  const original = { name: 'sessionid', value: 'old-account', domain: '.qishui.com', path: '/', secure: true }
  const f = fixture([qr(), response({ status: 'confirmed' })], async() => {}, { original: [original] })
  const started = await f.login.start(1)
  await assert.rejects(f.login.check(1, started.flowId), /未完成登录授权/)
  assert.equal(f.callbacks(), 0)
  assert.equal((await f.context.cookies()).sessionid, 'old-account')
  f.login.cancelAll()
})

test('expired QR is rejected at creation and expires before polling without network', async() => {
  const f = fixture([qr({ expire_time: Math.floor(Date.now() / 1000) - 1 }), qr()])
  await assert.rejects(f.login.start(1), /已过期/)
  const started = await f.login.start(1)
  const now = Date.now
  Date.now = () => started.expiresAt + 1
  try {
    assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
    assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
    assert.equal(f.requests.length, 2)
  } finally { Date.now = now; f.login.cancelAll() }
})

test('expiration while a check is in-flight discards session cookies', async() => {
  const wait = deferred()
  const f = fixture([qr(), () => wait.promise])
  const started = await f.login.start(1)
  const pending = f.login.check(1, started.flowId)
  const now = Date.now
  Date.now = () => started.expiresAt + 1
  try {
    wait.resolve(confirmed())
    assert.equal((await pending).status, 'expired')
    assert.equal(f.callbacks(), 0)
    assert.equal(f.jar.size, 0)
  } finally { Date.now = now; f.login.cancelAll() }
})

test('upstream expiry and numeric scan statuses are recognized', async() => {
  const f = fixture([qr(), response({ status: 1 }), response({ status: 2 }), response({ status: 4 })])
  const started = await f.login.start(1)
  for (const status of ['waiting', 'scanned', 'expired']) assert.equal((await f.login.check(1, started.flowId)).status, status)
  f.login.cancelAll()
})

test('unknown status, invalid JSON, business errors and security challenges never become success', async() => {
  for (const bad of [response({ status: 'alien' }), new Response('not json'), response({ error_code: 4031 }), response({ status: 'confirmed' }, [], { 'bdturing-verify': 'challenge' }), response({ status: 'confirmed' }, [], { 'x-tt-verify-passport-decision': 'verify' }), response({ status: 'confirmed', captcha: 'challenge' })]) {
    const f = fixture([qr(), bad])
    const started = await f.login.start(1)
    await assert.rejects(f.login.check(1, started.flowId), /汽水音乐/)
    assert.equal(f.callbacks(), 0)
    assert.equal(f.jar.size, 0)
    f.login.cancelAll()
  }
})

test('arbitrary images, invalid binary MIME and missing tokens are rejected', async() => {
  for (const patch of [{ qrcode: 'https://outside.example/qr.png' }, { qrcode: 'data:image/svg+xml;base64,PHN2Zz4=' }, { qrcode: 'data:image/png;base64,dGV4dA==' }, { token: '' }, { qrcode: png + '\n' }]) {
    const f = fixture([qr(patch)])
    await assert.rejects(f.login.start(1), /汽水音乐/)
    assert.equal(f.jar.size, 0)
  }
})

test('third-party cookie domains are rejected and tokens never leave the controller result', async() => {
  const f = fixture([response({ token: 'secret', qrcode: png, expire_time: Math.floor(Date.now() / 1000) + 300 }, ['bad=secret; Domain=.evil.example; Path=/']), response({ status: 'new' })])
  const started = await f.login.start(1)
  assert.ok(!JSON.stringify(started).includes('secret'))
  await f.login.check(1, started.flowId)
  assert.equal(f.requests[1].init.headers.get('cookie'), null)
  f.login.cancelAll()
})

test('sessionid_ss is accepted while passport_assist_user alone does not authorize an account', async() => {
  for (const [name, accepted] of [['sessionid_ss', true], ['passport_assist_user', false]]) {
    const f = fixture([qr(), response({ status: 'confirmed' }, [`${name}=fresh-account; Domain=.qishui.com; Path=/; Secure`])])
    const started = await f.login.start(1)
    if (accepted) assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    else await assert.rejects(f.login.check(1, started.flowId), /未完成登录授权/)
    assert.equal(f.callbacks(), Number(accepted))
    f.login.cancelAll()
    await f.login.settled()
  }
})

test('request timeout aborts the request and reports a recoverable network error', async() => {
  const nativeTimer = global.setTimeout
  global.setTimeout = (callback, delay, ...args) => nativeTimer(callback, delay === 20_000 ? 1 : delay, ...args)
  const f = fixture([(_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))])
  try {
    await assert.rejects(f.login.start(1), /超时/)
    assert.equal(f.requests[0].init.signal.aborted, true)
    assert.equal(f.jar.size, 0)
  } finally { global.setTimeout = nativeTimer; f.login.cancelAll() }
})

test('settled waits for rollback so logout cannot have an old session restored afterward', async() => {
  const gate = deferred()
  const original = { name: 'sessionid', value: 'old-account', domain: '.qishui.com', path: '/', secure: true }
  const f = fixture([qr(), confirmed()], () => gate.promise, { original: [original] })
  const started = await f.login.start(1)
  const pending = f.login.check(1, started.flowId)
  const rejected = assert.rejects(pending, /已取消/)
  while (!f.callbacks()) await tick()
  f.login.cancelAll()
  let done = false
  const settling = f.login.settled().then(() => { done = true })
  await tick()
  assert.equal(done, false)
  gate.resolve()
  await rejected
  await settling
  assert.equal((await f.context.cookies()).sessionid, 'old-account')
  f.jar.clear()
  await tick()
  assert.equal(f.jar.size, 0)
})

test('profile verifier can reject expiry at its final acceptance guard', async() => {
  const nativeNow = Date.now
  let deadline = 0
  const f = fixture([qr(), confirmed()], async() => {
    Date.now = () => deadline + 1
    assert.equal(f.login.isActive(), false)
    throw new Error('expired before accepting profile')
  })
  try {
    const started = await f.login.start(1)
    deadline = started.expiresAt
    assert.equal(f.login.isActive(), true)
    await assert.rejects(f.login.check(1, started.flowId), /expired before accepting profile/)
    assert.equal(f.jar.size, 0)
  } finally { Date.now = nativeNow; f.login.cancelAll() }
})
