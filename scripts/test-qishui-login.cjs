const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')
const QRCode = require('qrcode')
const { PNG } = require('pngjs')
const qrPayloads = []
const computerName = 'Link Line 测试 PC'
const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) LinkLine/1.2.0 Chrome/134.0.6998.205 Electron/35.2.1 Safari/537.36'
const sdkParams = { aid: '386088', passport_jssdk_version: '2.4.13', passport_jssdk_type: 'normal', is_from_ttaccountsdk: '1', account_sdk_source: 'web', language: 'zh', p_js_v: '2.4.13', p_js_t: 'pro', p_ver: '1.0.29', is_new_login: '1', is_from_iesaccountsaas: '1', device_platform: 'PC', version_code: '3.7.0' }

const filename = path.resolve(__dirname, '../src/main/modules/platformAccounts/qishuiLogin.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const subject = new Module(filename, module)
subject.filename = filename
subject.paths = module.paths
const nativeRequire = subject.require.bind(subject)
subject.require = name => {
  if (name === 'node:os') return { ...nativeRequire(name), hostname: () => computerName }
  if (name !== 'qrcode') return nativeRequire(name)
  const encoder = {
    ...QRCode,
    toDataURL(...args) { qrPayloads.push({ payload: args[0], options: args[1] }); return QRCode.toDataURL(...args) },
  }
  return { ...encoder, default: encoder }
}
subject._compile(compiled, filename)
const { createQishuiLogin } = subject.exports
const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let fulfill, fail
  const promise = new Promise((resolve, reject) => { fulfill = resolve; fail = reject })
  return { promise, resolve: fulfill, reject: fail }
}
const response = (data, cookies = [], headers = {}) => new Response(JSON.stringify({ message: 'success', data }), { headers: [...Object.entries(headers), ...cookies.map(value => ['Set-Cookie', value])] })
// Electron's Headers exposes getSetCookie(), but can collapse all response
// fields into its first array element. Node's native Response does not do this.
const collapsedCookies = (reply, hasGetSetCookie = true) => {
  const values = reply.headers.getSetCookie()
  Object.defineProperty(reply.headers, 'getSetCookie', { value: hasGetSetCookie ? () => values.length ? [values.join(', ')] : [] : undefined })
  return reply
}
const qr = (patch = {}, cookies = ['passport_csrf_token=flow-csrf; Domain=.qishui.com; Path=/; Secure; HttpOnly']) => {
  const data = { token: 'private-upstream-token', qrcode: png, expire_time: Math.floor(Date.now() / 1000) + 300, ...patch }
  return response({ qrcode_index_url: `https://bff-pc.qishui.com/qrcode_index?token=${encodeURIComponent(data.token)}`, ...data }, cookies)
}
const confirmed = () => response({ status: 'confirmed', error_code: 0 }, ['sessionid=fresh-account; Domain=.qishui.com; Path=/; Secure; HttpOnly; SameSite=None'])
const key = value => `${String(value.domain ?? 'api.qishui.com').replace(/^\./, '')}|${value.path ?? '/'}|${value.name}`
const cookieMatches = (cookie, url) => {
  const domain = String(cookie.domain ?? 'api.qishui.com').replace(/^\./, '')
  const hostMatches = url.hostname === domain || (!cookie.hostOnly && url.hostname.endsWith(`.${domain}`))
  const cookiePath = cookie.path ?? '/'
  return hostMatches && (url.pathname === cookiePath || url.pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`))
}

// Use the real encoder and verify its returned PNG pixels. The captured input
// checks the exact URL bytes, including token preservation and percent encoding.
function encodedQr(image) {
  assert.match(image, /^data:image\/png;base64,/)
  const capture = qrPayloads.at(-1)
  assert.ok(capture, 'The login controller must generate the PC QR locally')
  assert.equal(typeof capture.payload, 'string')
  const actual = PNG.sync.read(Buffer.from(image.split(',')[1], 'base64'))
  const symbol = QRCode.create(capture.payload, capture.options)
  const size = symbol.modules.size
  const margin = capture.options?.margin ?? 4
  const scale = actual.width / (size + margin * 2)
  assert.equal(actual.width, actual.height)
  assert.ok(scale >= 1)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = Math.floor((col + margin + 0.5) * scale)
      const y = Math.floor((row + margin + 0.5) * scale)
      const index = (y * actual.width + x) * 4
      assert.equal(actual.data[index] < 128 ? 1 : 0, symbol.modules.get(row, col), `QR pixel mismatch at ${row},${col}`)
    }
  }
  return new URL(capture.payload)
}

function fixture(actions = [], callback = async() => {}, options = {}) {
  const requests = []
  const jar = new Map((options.original ?? []).map(cookie => [key(cookie), cookie]))
  const mutations = []
  let callbacks = 0
  const context = {
    session: {
      getUserAgent() { return browserUserAgent },
      async fetch(url, init) {
        requests.push({ url: new URL(url), init })
        const action = actions.shift()
        assert.ok(action, 'unexpected network request')
        return typeof action === 'function' ? action(url, init) : action
      },
      cookies: {
        async get(filter = {}) { return [...jar.values()].filter(cookie => !filter.url || cookieMatches(cookie, new URL(filter.url))) },
        async set(cookie) {
          mutations.push({ op: 'set', name: cookie.name })
          jar.set(key(cookie), { ...cookie, domain: cookie.domain ?? 'api.qishui.com', path: cookie.path ?? '/', hostOnly: !cookie.domain })
          await options.onSet?.(cookie)
        },
        async remove(url, name) {
          mutations.push({ op: 'remove', name })
          for (const [id, cookie] of jar) if (cookie.name === name && cookieMatches(cookie, new URL(url))) jar.delete(id)
        },
        async flushStore() {},
      },
    },
    async cookies() { return Object.fromEntries([...jar.values()].filter(cookie => cookieMatches(cookie, new URL('https://api.qishui.com/'))).map(cookie => [cookie.name, cookie.value])) },
  }
  const login = createQishuiLogin(context, async() => { callbacks++; await callback(context) }, options.passportFactory)
  return { login, context, requests, jar, mutations, callbacks: () => callbacks }
}

function passportFactoryFixture(plans = []) {
  const calls = []
  const clients = []
  const factory = async(userAgent, signal) => {
    const plan = plans.shift()
    assert.ok(plan, 'unexpected Passport client initialization')
    const requests = []
    const client = {
      requests,
      destroyed: 0,
      async fetch(url, init) {
        requests.push({ url: new URL(url), init })
        const action = plan.actions.shift()
        assert.ok(action, 'unexpected Passport client request')
        return typeof action === 'function' ? action(url, init) : action
      },
      async destroy() { this.destroyed++ },
    }
    calls.push({ userAgent, signal })
    clients.push(client)
    await plan.initializing
    if (plan.failure) throw plan.failure
    return client
  }
  return { factory, calls, clients }
}

test('browser Passport client owns get and check with stable identity and closes after confirmation', async() => {
  const transport = passportFactoryFixture([{ actions: [qr(), response({ status: 'scanned' }), confirmed()] }])
  const f = fixture([], async context => { assert.equal((await context.cookies()).sessionid, 'fresh-account') }, { passportFactory: transport.factory })
  try {
    const started = await f.login.start(1)
    f.context.session.getUserAgent = () => 'different browser UA after start'
    assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
    assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    await tick()
    assert.equal(transport.calls.length, 1)
    assert.equal(transport.calls[0].userAgent, browserUserAgent)
    assert.ok(transport.calls[0].signal instanceof AbortSignal)
    const client = transport.clients[0]
    assert.deepEqual(client.requests.map(request => request.url.pathname), ['/passport/web/get_qrcode/', '/passport/web/check_qrconnect/', '/passport/web/check_qrconnect/'])
    assert.ok(client.requests.every(request => request.init.headers.get('user-agent') === browserUserAgent))
    assert.equal(client.requests[1].init.headers.get('x-tt-passport-csrf-token'), 'flow-csrf')
    assert.equal(client.destroyed, 1)
    assert.equal(f.requests.length, 0, 'Passport must not use the persistent account session transport')
    assert.equal(f.callbacks(), 1)
    assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    assert.equal(client.requests.length, 3)
  } finally { f.login.cancelAll() }
})

test('browser Passport clients are isolated and destroyed on refresh and cancellation', async() => {
  const transport = passportFactoryFixture([{ actions: [qr()] }, { actions: [qr({ token: 'second-flow-token' }), response({ status: 'new' })] }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  try {
    const first = await f.login.start(1)
    const second = await f.login.start(1)
    assert.notEqual(first.flowId, second.flowId)
    assert.equal(transport.clients.length, 2)
    assert.notEqual(transport.calls[0].signal, transport.calls[1].signal)
    assert.equal(transport.calls[0].signal.aborted, true)
    await tick()
    assert.equal(transport.clients[0].destroyed, 1)
    assert.equal((await f.login.check(1, second.flowId)).status, 'waiting')
    assert.equal(transport.clients[0].requests.length, 1)
    assert.equal(transport.clients[1].requests.length, 2)
    assert.equal(f.login.cancel(1, second.flowId), true)
    await tick()
    assert.equal(transport.calls[1].signal.aborted, true)
    assert.equal(transport.clients[1].destroyed, 1)
    assert.equal(f.requests.length, 0)
    assert.deepEqual(f.mutations, [])
  } finally { f.login.cancelAll() }
})

test('browser Passport client closes on both local expiry and upstream expired status', async() => {
  for (const upstream of [false, true]) {
    const transport = passportFactoryFixture([{ actions: [qr(), ...(upstream ? [response({ status: 'expired' })] : [])] }])
    const f = fixture([], async() => {}, { passportFactory: transport.factory })
    const nativeNow = Date.now
    try {
      const started = await f.login.start(1)
      if (!upstream) Date.now = () => started.expiresAt + 1
      assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
      await tick()
      assert.equal(transport.clients[0].destroyed, 1)
      assert.equal(transport.calls[0].signal.aborted, true)
      assert.equal(transport.clients[0].requests.length, upstream ? 2 : 1)
      assert.equal(f.requests.length, 0)
      assert.equal(f.callbacks(), 0)
      assert.deepEqual(f.mutations, [])
    } finally { Date.now = nativeNow; f.login.cancelAll() }
  }
})

test('browser Passport client initialization failure never falls back to raw fetch', async() => {
  const transport = passportFactoryFixture([{ actions: [qr()], failure: new Error('client initialization denied') }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  await assert.rejects(f.login.start(1))
  assert.equal(transport.calls.length, 1)
  assert.equal(transport.calls[0].signal.aborted, true)
  assert.equal(transport.clients[0].requests.length, 0)
  assert.equal(f.requests.length, 0)
  assert.equal(f.callbacks(), 0)
  assert.deepEqual(f.mutations, [])
  f.login.cancelAll()
})

test('browser Passport client returned after cancellation is destroyed without making a request', async() => {
  const gate = deferred()
  const transport = passportFactoryFixture([{ actions: [qr()], initializing: gate.promise }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  const starting = f.login.start(1)
  const rejected = assert.rejects(starting, /已取消/)
  await tick()
  assert.equal(transport.calls.length, 1)
  assert.equal(f.login.cancel(1), true)
  gate.resolve()
  await rejected
  await tick()
  assert.equal(transport.calls[0].signal.aborted, true)
  assert.equal(transport.clients[0].destroyed, 1)
  assert.equal(transport.clients[0].requests.length, 0)
  assert.equal(f.requests.length, 0)
  assert.equal(f.callbacks(), 0)
  assert.deepEqual(f.mutations, [])
})

test('browser Passport client returned after refresh cannot replace the new flow', async() => {
  const gate = deferred()
  const transport = passportFactoryFixture([{ actions: [qr()], initializing: gate.promise }, { actions: [qr({ token: 'current-flow-token' }), response({ status: 'new' })] }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  const starting = f.login.start(1)
  const rejected = assert.rejects(starting, /已取消/)
  await tick()
  const current = await f.login.start(1)
  gate.resolve()
  await rejected
  await tick()
  try {
    assert.equal(transport.clients[0].destroyed, 1)
    assert.equal(transport.clients[0].requests.length, 0)
    assert.equal((await f.login.check(1, current.flowId)).status, 'waiting')
    assert.equal(transport.clients[1].destroyed, 0)
    assert.equal(transport.clients[1].requests.length, 2)
    assert.equal(f.requests.length, 0)
    assert.deepEqual(f.mutations, [])
  } finally { f.login.cancelAll() }
})

test('browser Passport client initialized after its deadline is destroyed before QR creation', async() => {
  const gate = deferred()
  const transport = passportFactoryFixture([{ actions: [qr()], initializing: gate.promise }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  const nativeNow = Date.now
  const starting = f.login.start(1)
  const rejected = assert.rejects(starting, /已过期/)
  await tick()
  const pastDeadline = nativeNow() + 6 * 60 * 1000
  Date.now = () => pastDeadline
  try {
    gate.resolve()
    await rejected
    await tick()
    assert.equal(transport.clients[0].destroyed, 1)
    assert.equal(transport.clients[0].requests.length, 0)
    assert.equal(f.requests.length, 0)
    assert.equal(f.callbacks(), 0)
    assert.deepEqual(f.mutations, [])
  } finally { Date.now = nativeNow; f.login.cancelAll() }
})

test('browser Passport client late confirmation after cancellation cannot persist cookies', async() => {
  const gate = deferred()
  const transport = passportFactoryFixture([{ actions: [qr(), () => gate.promise] }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  const started = await f.login.start(1)
  const checking = f.login.check(1, started.flowId)
  const rejected = assert.rejects(checking, /已取消/)
  await tick()
  f.login.cancelAll()
  gate.resolve(confirmed())
  await rejected
  await tick()
  assert.equal(transport.clients[0].destroyed, 1)
  assert.equal(f.requests.length, 0)
  assert.equal(f.callbacks(), 0)
  assert.deepEqual(f.mutations, [])
})

test('browser Passport client fatal request failures close the client and never bypass it with raw fetch', async() => {
  for (const phase of ['create', 'check']) {
    const failing = () => { throw new Error('汽水音乐登录安全组件不可用，请重新登录') }
    const transport = passportFactoryFixture([{ actions: phase === 'create' ? [failing] : [qr(), failing] }])
    const f = fixture([], async() => {}, { passportFactory: transport.factory })
    try {
      let started
      if (phase === 'create') await assert.rejects(f.login.start(1))
      else {
        started = await f.login.start(1)
        await assert.rejects(f.login.check(1, started.flowId))
      }
      await tick()
      assert.equal(transport.clients[0].destroyed, 1)
      const requests = transport.clients[0].requests.length
      if (started) await assert.rejects(f.login.check(1, started.flowId))
      assert.equal(transport.clients[0].requests.length, requests)
      assert.equal(f.requests.length, 0)
      assert.equal(f.callbacks(), 0)
      assert.deepEqual(f.mutations, [])
    } finally { f.login.cancelAll() }
  }
})

test('browser Passport client connection failures retain the same client for an explicit retry', async() => {
  const transport = passportFactoryFixture([{ actions: [qr(), () => { throw new Error('synthetic connection interruption') }, response({ status: 'new' })] }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  try {
    const started = await f.login.start(1)
    await assert.rejects(f.login.check(1, started.flowId), /连接失败/)
    assert.equal(transport.clients[0].destroyed, 0)
    assert.equal(transport.calls[0].signal.aborted, false)
    assert.equal((await f.login.check(1, started.flowId)).status, 'waiting')
    assert.equal(transport.calls.length, 1)
    assert.equal(transport.clients[0].requests.length, 3)
    assert.equal(f.requests.length, 0)
    assert.equal(f.callbacks(), 0)
    assert.deepEqual(f.mutations, [])
  } finally { f.login.cancelAll() }
})

test('browser Passport client still rejects 2156 and never adopts its browser cookie jar', async() => {
  for (const invalid of ['business-error', 'missing-cookie']) {
    const cookies = invalid === 'business-error' ? ['sessionid=rejected-account; Domain=.qishui.com; Path=/; Secure'] : []
    const transport = passportFactoryFixture([{ actions: [qr(), response({ status: 'confirmed', error_code: invalid === 'business-error' ? 2156 : 0 }, cookies)] }])
    const original = { name: 'sessionid', value: 'previous-account', domain: '.qishui.com', path: '/', secure: true }
    const f = fixture([], async() => {}, { passportFactory: transport.factory, original: [original] })
    try {
      const started = await f.login.start(1)
      // An SDK browser may have ambient cookies. Only newly issued cookies on
      // this successful response may authorize the controller's transaction.
      transport.clients[0].cookies = [{ name: 'sessionid', value: 'ambient-browser-account', domain: '.qishui.com', path: '/' }]
      await assert.rejects(f.login.check(1, started.flowId), invalid === 'business-error' ? /错误码 2156/ : /未完成登录授权/)
      await tick()
      assert.equal(transport.clients[0].destroyed, 1)
      assert.equal(f.callbacks(), 0)
      assert.equal((await f.context.cookies()).sessionid, 'previous-account')
      assert.deepEqual(f.mutations, [])
      assert.equal(f.requests.length, 0)
    } finally { f.login.cancelAll() }
  }
})

test('QR stays private; poll uses exact official endpoint and staged CSRF; confirmed is idempotent', async() => {
  const f = fixture([qr(), response({ status: 'scanned' }), confirmed()], async context => {
    assert.equal((await context.cookies()).sessionid, 'fresh-account')
  })
  const started = await f.login.start(17)
  assert.deepEqual(Object.keys(started).sort(), ['expiresAt', 'flowId', 'image', 'status'])
  assert.match(started.flowId, /^[0-9a-f-]{36}$/)
  assert.notEqual(started.flowId, 'private-upstream-token')
  const scan = encodedQr(started.image)
  assert.equal(scan.origin, 'https://bff-pc.qishui.com')
  assert.equal(scan.pathname, '/light/invoke/scan_login')
  assert.equal(scan.searchParams.get('token'), 'private-upstream-token')
  assert.equal(scan.searchParams.get('os'), process.platform === 'darwin' ? 'Mac' : 'Windows')
  assert.equal(scan.searchParams.get('computer_name'), computerName)
  assert.deepEqual([...scan.searchParams.keys()], ['token', 'os', 'computer_name'])
  assert.ok(qrPayloads.at(-1).payload.includes('computer_name=Link%20Line%20'))
  assert.ok(!qrPayloads.at(-1).payload.includes('+'))
  assert.equal(f.jar.size, 0)
  assert.equal(f.requests[0].url.origin, 'https://api.qishui.com')
  assert.equal(f.requests[0].url.pathname, '/passport/web/get_qrcode/')
  const createQuery = new URLSearchParams(f.requests[0].url.searchParams)
  createQuery.delete('biz_trace_id')
  assert.deepEqual(Object.fromEntries(createQuery), { ...sdkParams, next: 'https://api.qishui.com', need_logo: 'false', need_short_url: 'false' })
  assert.equal(f.requests[0].init.headers.get('user-agent'), browserUserAgent)
  assert.equal(f.requests[0].init.headers.get('x-ss-stub'), null)
  assert.equal(f.requests[0].init.credentials, 'omit')
  assert.equal(f.requests[0].init.redirect, 'error')
  assert.equal((await f.login.check(17, started.flowId)).status, 'scanned')
  assert.equal(f.requests[1].url.pathname, '/passport/web/check_qrconnect/')
  const checkQuery = new URLSearchParams(f.requests[1].url.searchParams)
  checkQuery.delete('biz_trace_id')
  assert.deepEqual(Object.fromEntries(checkQuery), sdkParams)
  assert.equal(f.requests[1].init.headers.get('user-agent'), browserUserAgent)
  assert.equal(f.requests[1].init.headers.get('cookie'), 'passport_csrf_token=flow-csrf')
  assert.equal(f.requests[1].init.headers.get('x-tt-passport-csrf-token'), 'flow-csrf')
  assert.equal(new URLSearchParams(f.requests[1].init.body).get('token'), 'private-upstream-token')
  assert.equal(f.requests[1].init.headers.get('x-ss-stub'), createHash('md5').update(f.requests[1].init.body).digest('hex').toUpperCase())
  assert.equal((await f.login.check(17, started.flowId)).status, 'confirmed')
  assert.equal((await f.login.check(17, started.flowId)).status, 'confirmed')
  assert.equal(f.callbacks(), 1)
  assert.equal(f.requests.length, 3)
  assert.equal(f.login.cancel(17, started.flowId), false, 'completed flow cannot cancel successful sync')
})

test('browser identity, verification portrait and trace stay stable through one flow and renew on refresh', async() => {
  const nextUserAgent = browserUserAgent.replace('LinkLine/1.2.0', 'LinkLine/1.2.1')
  const f = fixture([qr(), response({ status: 'new' }), qr({ token: 'second-token' }), response({ status: 'new' })])
  try {
    const first = await f.login.start(1)
    f.context.session.getUserAgent = () => nextUserAgent
    await f.login.check(1, first.flowId)
    const second = await f.login.start(1)
    await f.login.check(1, second.flowId)
    const portraits = f.requests.map(request => request.init.headers.get('x-tt-passport-verify-portrait'))
    for (const portrait of portraits) assert.match(portrait, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.login$/)
    assert.equal(portraits[0], portraits[1])
    assert.equal(portraits[2], portraits[3])
    assert.notEqual(portraits[0], portraits[2])
    const traces = f.requests.map(request => request.init.headers.get('x-tt-passport-trace-id'))
    for (const trace of traces) assert.match(trace, /^[0-9a-f]{8}$/)
    assert.equal(traces[0], traces[1])
    assert.equal(traces[2], traces[3])
    assert.notEqual(traces[0], traces[2])
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get('biz_trace_id')), traces)
    assert.deepEqual(f.requests.map(request => request.init.headers.get('user-agent')), [browserUserAgent, browserUserAgent, nextUserAgent, nextUserAgent])
    assert.ok(f.requests.every(request => !request.init.headers.get('user-agent').startsWith('LunaPC/')))
    assert.ok(!JSON.stringify([first, second]).includes('.login'))
    assert.ok(f.requests.every(request => !/(?:^|;\s*)passport_trace_id=/.test(request.init.headers.get('cookie') ?? '')))
    assert.deepEqual(f.mutations, [])
  } finally { f.login.cancelAll() }
})

test('PC scan_login always polls frontier mode regardless of the upstream web QR flag', async() => {
  for (const frontier of [true, false, undefined, 'false', 'true']) {
    const f = fixture([qr({ is_frontier: frontier }), response({ status: 'new' })])
    try {
      const started = await f.login.start(1)
      assert.equal((await f.login.check(1, started.flowId)).status, 'waiting')
      assert.equal(new URLSearchParams(f.requests[1].init.body).get('is_frontier'), 'true', `QR is_frontier=${String(frontier)}`)
      assert.equal(f.jar.size, 0)
    } finally { f.login.cancelAll() }
  }
})

test('business errors identify their request phase and code without exposing upstream details', async() => {
  for (const [phase, label] of [['start', '获取二维码'], ['check', '查询扫码状态']]) {
    for (const code of [22, '4031']) {
      const bad = response({ status: 'confirmed', error_code: code, description: 'private-upstream-token upstream-account-secret https://example.test/private' }, ['sessionid=rejected-session-secret; Domain=.qishui.com; Path=/; Secure'])
      const f = fixture(phase === 'start' ? [bad] : [qr(), bad])
      try {
        const operation = phase === 'start' ? f.login.start(1) : f.login.check(1, (await f.login.start(1)).flowId)
        await assert.rejects(operation, error => {
          assert.match(error.message, new RegExp(label))
          assert.match(error.message, new RegExp(`\\b${Number(code)}\\b`))
          assert.doesNotMatch(error.message, /安全验证|private-upstream-token|upstream-account-secret|rejected-session-secret|example\.test/)
          return true
        })
        assert.equal(f.callbacks(), 0)
        assert.equal(f.jar.size, 0)
        assert.deepEqual(f.mutations, [])
      } finally { f.login.cancelAll() }
    }
  }
})

test('phone-confirmed Passport rejection 2156 never authorizes an account or silently retries', async() => {
  for (const code of [2156, '2156']) {
    const original = { name: 'sessionid', value: 'previous-account-secret', domain: '.qishui.com', path: '/', secure: true }
    const rejected = () => response({
      status: 'confirmed',
      error_code: code,
      description: 'private-upstream-token rejected-account-secret https://example.test/verify?ticket=private-ticket',
      redirect_url: 'https://example.test/authorize?token=private-upstream-token',
    }, ['sessionid=rejected-account-secret; Domain=.qishui.com; Path=/; Secure'])
    const f = fixture([qr(), response({ status: 'scanned' }), rejected(), rejected()], async() => {}, { original: [original] })
    try {
      const started = await f.login.start(1)
      assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(f.login.check(1, started.flowId), error => {
          assert.match(error.message, /查询扫码状态.*错误码 2156/)
          assert.doesNotMatch(error.message, /private-|rejected-account-secret|previous-account-secret|example\.test|安全验证/)
          return true
        })
      }
      assert.equal(f.requests.length, 4, '2156 must not enter the transient-code cooldown')
      assert.equal(f.callbacks(), 0)
      assert.equal((await f.context.cookies()).sessionid, 'previous-account-secret')
      assert.deepEqual(f.mutations, [])
      assert.equal(f.requests.at(-1).init.headers.get('cookie'), 'passport_csrf_token=flow-csrf')
    } finally { f.login.cancelAll() }
  }
})

test('an unsuccessful response without a business code is reported as a phase-specific response error', async() => {
  for (const [phase, label] of [['start', '获取二维码'], ['check', '查询扫码状态']]) {
    const bad = new Response(JSON.stringify({ message: 'upstream-message-secret', data: { status: 'confirmed' } }), { headers: { 'Set-Cookie': 'sessionid=rejected-session-secret; Domain=.qishui.com; Path=/; Secure' } })
    const f = fixture(phase === 'start' ? [bad] : [qr(), bad])
    try {
      const operation = phase === 'start' ? f.login.start(1) : f.login.check(1, (await f.login.start(1)).flowId)
      await assert.rejects(operation, error => {
        assert.match(error.message, new RegExp(label))
        assert.match(error.message, /响应状态异常/)
        assert.doesNotMatch(error.message, /安全验证|upstream-message-secret|rejected-session-secret/)
        return true
      })
      assert.equal(f.callbacks(), 0)
      assert.equal(f.jar.size, 0)
      assert.deepEqual(f.mutations, [])
    } finally { f.login.cancelAll() }
  }
})

test('real verification challenges remain blocked and never persist response cookies', async() => {
  for (const phase of ['start', 'check']) {
    for (const [data, headers] of [[{ captcha: 'challenge-secret' }, {}], [{}, { 'bdturing-verify': 'challenge-secret' }], [{}, { 'x-tt-verify-passport-decision': 'challenge-secret' }]]) {
      const bad = response({ status: 'confirmed', error_code: 0, ...data }, ['sessionid=rejected-session-secret; Domain=.qishui.com; Path=/; Secure'], headers)
      const f = fixture(phase === 'start' ? [bad] : [qr(), bad])
      try {
        const operation = phase === 'start' ? f.login.start(1) : f.login.check(1, (await f.login.start(1)).flowId)
        await assert.rejects(operation, error => {
          assert.match(error.message, /安全验证/)
          assert.doesNotMatch(error.message, /challenge-secret|rejected-session-secret|private-upstream-token/)
          return true
        })
        assert.equal(f.callbacks(), 0)
        assert.equal(f.jar.size, 0)
        assert.deepEqual(f.mutations, [])
      } finally { f.login.cancelAll() }
    }
  }
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
  const entered = deferred()
  const original = { name: 'sessionid', value: 'original-account', domain: '.qishui.com', path: '/', secure: true, httpOnly: true, hostOnly: false }
  const f = fixture([qr(), confirmed(), qr()], async() => {}, { original: [original], async onSet(cookie) { if (cookie.value === 'fresh-account') { entered.resolve(); await gate.promise } } })
  const started = await f.login.start(1)
  const checking = f.login.check(1, started.flowId)
  const rejected = assert.rejects(checking, /已取消/)
  await entered.promise
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

test('missing or untrusted QR index URLs and tokens are rejected before rendering', async() => {
  const token = 'private-upstream-token'
  for (const patch of [
    { token: '' }, { token: 'x'.repeat(8193) }, { qrcode_index_url: undefined },
    { qrcode_index_url: 'not a URL' },
    { qrcode_index_url: `http://bff-pc.qishui.com/qrcode_index?token=${token}` },
    { qrcode_index_url: `https://outside.example/qrcode_index?token=${token}` },
    { qrcode_index_url: `https://bff-pc.qishui.com.evil.example/qrcode_index?token=${token}` },
    { qrcode_index_url: `https://user:secret@bff-pc.qishui.com/qrcode_index?token=${token}` },
    { qrcode_index_url: `https://bff-pc.qishui.com:444/qrcode_index?token=${token}` },
    { qrcode_index_url: 'https://bff-pc.qishui.com/qrcode_index' },
    { qrcode_index_url: 'https://bff-pc.qishui.com/qrcode_index?token=different-token' },
    { qrcode_index_url: `https://bff-pc.qishui.com/qrcode_index?token=${token}&token=${token}` },
  ]) {
    const f = fixture([qr(patch)])
    const captures = qrPayloads.length
    await assert.rejects(f.login.start(1), /汽水音乐/)
    assert.equal(f.jar.size, 0)
    assert.equal(qrPayloads.length, captures)
  }
})

test('third-party cookie domains are rejected and tokens never leave the controller result', async() => {
  const f = fixture([response({ token: 'secret', qrcode_index_url: 'https://api.qishui.com/qrcode_index?token=secret', qrcode: png, expire_time: Math.floor(Date.now() / 1000) + 300 }, ['bad=secret; Domain=.evil.example; Path=/']), response({ status: 'new' })])
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

test('generated PC QR preserves reserved and Unicode token bytes and ignores the upstream web image', async() => {
  const token = 'synthetic+a/b==& space汉字%?'
  const f = fixture([qr({ token, qrcode: 'https://untrusted.example/web-image.svg' }), response({ status: 'new' })])
  try {
    const started = await f.login.start(1)
    const scan = encodedQr(started.image)
    assert.equal(scan.searchParams.get('token'), token)
    const os = process.platform === 'darwin' ? 'Mac' : 'Windows'
    assert.equal(qrPayloads.at(-1).payload, `https://bff-pc.qishui.com/light/invoke/scan_login?token=${encodeURIComponent(token)}&os=${os}&computer_name=${encodeURIComponent(computerName)}`)
    assert.ok(!JSON.stringify(started).includes(token))
    await f.login.check(1, started.flowId)
    const body = f.requests[1].init.body
    assert.equal(new URLSearchParams(body).get('token'), token)
    assert.ok(!body.includes(token), 'Reserved token bytes must be URL-encoded in the request body')
    assert.equal(f.requests[1].init.headers.get('x-ss-stub'), createHash('md5').update(body).digest('hex').toUpperCase())
  } finally { f.login.cancelAll() }
})

test('CSRF uses only current-flow cookies matching the poll domain and path', async() => {
  const original = [
    { name: 'passport_csrf_token', value: 'old-csrf', domain: '.qishui.com', path: '/', secure: true },
    { name: 'sessionid', value: 'old-account', domain: '.qishui.com', path: '/', secure: true },
  ]
  for (const [cookies, expected, included, excluded] of [
    [
      ['passport_csrf_token=wrong-path; Domain=.qishui.com; Path=/other/', 'passport_csrf_token_default=flow-default; Domain=.qishui.com; Path=/'],
      'flow-default', ['passport_csrf_token_default=flow-default'], ['wrong-path'],
    ],
    [
      ['passport_csrf_token=root-token; Domain=.qishui.com; Path=/', 'passport_csrf_token=poll-token; Domain=.qishui.com; Path=/passport/web/check_qrconnect/', 'passport_csrf_token=wrong-prefix; Domain=.qishui.com; Path=/passport/web/check_qr'],
      'poll-token', ['passport_csrf_token=poll-token', 'passport_csrf_token=root-token'], ['wrong-prefix'],
    ],
    [
      ['passport_csrf_token=bad-domain; Domain=.evil.example; Path=/'],
      '', [], ['bad-domain'],
    ],
    [
      ['passport_csrf_token=expired-token; Domain=.qishui.com; Path=/; Max-Age=0'],
      '', [], ['expired-token'],
    ],
  ]) {
    const f = fixture([qr({}, cookies), response({ status: 'new' })], async() => {}, { original })
    try {
      const started = await f.login.start(1)
      assert.equal(f.requests[0].init.headers.get('cookie'), null)
      assert.equal(f.requests[0].init.headers.get('x-tt-passport-csrf-token'), '')
      await f.login.check(1, started.flowId)
      const headers = f.requests[1].init.headers
      assert.equal(headers.get('x-tt-passport-csrf-token'), expected)
      const sent = headers.get('cookie') ?? ''
      for (const value of included) assert.ok(sent.includes(value))
      for (const value of [...excluded, 'old-account', 'old-csrf']) assert.ok(!sent.includes(value))
      assert.deepEqual(f.mutations, [])
    } finally { f.login.cancelAll() }
  }
})

test('Electron collapsed Set-Cookie preserves CSRF, expiration commas and later login cookies', async() => {
  const cookieAttrs = 'Domain=.qishui.com; Path=/; Secure; HttpOnly'
  const f = fixture([
    collapsedCookies(qr({}, [
      `passport_csrf_token=flow-csrf; ${cookieAttrs}; Expires=Wed, 21 Oct 2037 07:28:00 GMT; SameSite=None`,
      `passport_csrf_token_default=flow-default; ${cookieAttrs}; Max-Age=5184000`,
      `reg-store-region=; ${cookieAttrs}; Max-Age=0`,
    ])),
    response({ status: 'new' }),
    collapsedCookies(response({ status: 'confirmed' }, [
      `passport_csrf_token=confirmed-csrf; ${cookieAttrs}`,
      `sessionid=fresh-account; ${cookieAttrs}; Expires=Wed, 21 Oct 2037 07:28:00 GMT; SameSite=None`,
      `reg-store-region=; ${cookieAttrs}; Max-Age=0`,
    ])),
  ], async context => { assert.equal((await context.cookies()).sessionid, 'fresh-account') })
  try {
    const started = await f.login.start(1)
    assert.equal((await f.login.check(1, started.flowId)).status, 'waiting')
    assert.equal(f.requests[1].init.headers.get('x-tt-passport-csrf-token'), 'flow-csrf')
    assert.equal(f.requests[1].init.headers.get('cookie'), 'passport_csrf_token=flow-csrf; passport_csrf_token_default=flow-default')
    assert.deepEqual(f.mutations, [])
    assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    assert.equal((await f.context.cookies()).passport_csrf_token, 'confirmed-csrf')
    assert.equal((await f.context.cookies()).sessionid, 'fresh-account')
    assert.ok(!('reg-store-region' in await f.context.cookies()))
    assert.equal(f.callbacks(), 1)
  } finally { f.login.cancelAll() }
})

test('a collapsed cookie deletion removes only its own flow cookie and preserves later updates', async() => {
  const cookieAttrs = 'Domain=.qishui.com; Path=/; Secure'
  const f = fixture([
    qr({}, [`passport_csrf_token=flow-csrf; ${cookieAttrs}`, `remove_me=old; ${cookieAttrs}`, `keep_me=old; ${cookieAttrs}`]),
    collapsedCookies(response({ status: 'new' }, [
      `remove_me=; ${cookieAttrs}; Max-Age=0`,
      `keep_me=updated; ${cookieAttrs}; Expires=Wed, 21 Oct 2037 07:28:00 GMT`,
    ])),
    response({ status: 'new' }),
  ])
  try {
    const started = await f.login.start(1)
    await f.login.check(1, started.flowId)
    await f.login.check(1, started.flowId)
    assert.equal(f.requests[2].init.headers.get('cookie'), 'passport_csrf_token=flow-csrf; keep_me=updated')
    assert.equal(f.requests[2].init.headers.get('x-tt-passport-csrf-token'), 'flow-csrf')
    assert.deepEqual(f.mutations, [])
    assert.equal(f.callbacks(), 0)
  } finally { f.login.cancelAll() }
})

test('both Headers APIs preserve default CSRF after an expired primary cookie and parse later auth cookies', async() => {
  const cookieAttrs = 'Domain=.qishui.com; Path=/; Secure; HttpOnly'
  for (const hasGetSetCookie of [true, false]) {
    const f = fixture([
      collapsedCookies(qr({}, [
        `passport_csrf_token=expired-primary; ${cookieAttrs}; Max-Age=0`,
        `passport_csrf_token_default=flow-default; ${cookieAttrs}; Expires=Wed, 21 Oct 2037 07:28:00 GMT`,
        `reg-store-region=; ${cookieAttrs}; Max-Age=0`,
      ]), hasGetSetCookie),
      collapsedCookies(response({ status: 'confirmed' }, [
        `passport_csrf_token_default=confirmed-default; ${cookieAttrs}`,
        `sessionid=fresh-account; ${cookieAttrs}; Expires=Wed, 21 Oct 2037 07:28:00 GMT`,
        `reg-store-region=; ${cookieAttrs}; Max-Age=0`,
      ]), hasGetSetCookie),
    ], async context => { assert.equal((await context.cookies()).sessionid, 'fresh-account') })
    try {
      const started = await f.login.start(1)
      assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
      assert.equal(f.requests[1].init.headers.get('x-tt-passport-csrf-token'), 'flow-default')
      assert.equal(f.requests[1].init.headers.get('cookie'), 'passport_csrf_token_default=flow-default')
      assert.equal((await f.context.cookies()).passport_csrf_token_default, 'confirmed-default')
      assert.equal((await f.context.cookies()).sessionid, 'fresh-account')
      assert.equal(f.callbacks(), 1)
    } finally { f.login.cancelAll() }
  }
})

test('collapsed authentication cookies still require confirmed status and successful profile verification', async() => {
  const original = { name: 'sessionid', value: 'previous-account', domain: '.qishui.com', path: '/', secure: true }
  const cookieAttrs = 'Domain=.qishui.com; Path=/; Secure'
  for (const phase of ['waiting', 'business-error', 'profile-error']) {
    const data = phase === 'waiting' ? { status: 'new' } : { status: 'confirmed', error_code: phase === 'business-error' ? 2156 : 0 }
    const f = fixture([
      qr(),
      collapsedCookies(response(data, [
        `passport_csrf_token=new-csrf; ${cookieAttrs}`,
        `sessionid=unverified-account; ${cookieAttrs}; Expires=Wed, 21 Oct 2037 07:28:00 GMT`,
        `reg-store-region=; ${cookieAttrs}; Max-Age=0`,
      ])),
    ], async() => { throw new Error('profile denied') }, { original: [original] })
    try {
      const started = await f.login.start(1)
      const checking = f.login.check(1, started.flowId)
      if (phase === 'waiting') assert.equal((await checking).status, 'waiting')
      else await assert.rejects(checking, phase === 'business-error' ? /错误码 2156/ : /profile denied/)
      assert.equal((await f.context.cookies()).sessionid, 'previous-account')
      assert.equal(f.callbacks(), phase === 'profile-error' ? 1 : 0)
      if (phase !== 'profile-error') assert.deepEqual(f.mutations, [])
    } finally { f.login.cancelAll() }
  }
})

test('Passport expiry code and refused scan statuses stop polling without cookie persistence', async() => {
  for (const data of [{ error_code: 2, status: 'confirmed' }, { status: 5 }, { status: 'refused' }]) {
    const f = fixture([qr(), response(data, ['sessionid=rejected-account; Domain=.qishui.com; Path=/'])])
    try {
      const started = await f.login.start(1)
      assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
      assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
      assert.equal(f.login.isActive(), false)
      assert.equal(f.requests.length, 2)
      assert.equal(f.callbacks(), 0)
      assert.deepEqual(f.mutations, [])
    } finally { f.login.cancelAll() }
  }
})

test('Passport transient codes back off for five seconds and fail after three retries', async() => {
  for (const code of [6, 7]) {
    const bad = () => response({ error_code: code, status: 'confirmed', description: 'private-server-details' }, ['sessionid=rejected-account; Domain=.qishui.com; Path=/'])
    const f = fixture([qr(), bad(), bad(), bad(), bad()])
    const nativeNow = Date.now
    let now = nativeNow()
    try {
      const started = await f.login.start(1)
      Date.now = () => now
      for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal((await f.login.check(1, started.flowId)).status, 'waiting')
        const requests = f.requests.length
        assert.equal((await f.login.check(1, started.flowId)).status, 'waiting')
        now += 4999
        assert.equal((await f.login.check(1, started.flowId)).status, 'waiting')
        assert.equal(f.requests.length, requests)
        now++
      }
      await assert.rejects(f.login.check(1, started.flowId), error => {
        assert.match(error.message, new RegExp(`错误码 ${code}`))
        assert.doesNotMatch(error.message, /private-server-details|rejected-account|private-upstream-token|安全验证/)
        return true
      })
      assert.equal(f.requests.length, 5)
      assert.equal(f.callbacks(), 0)
      assert.deepEqual(f.mutations, [])
    } finally { Date.now = nativeNow; f.login.cancelAll() }
  }
})

test('a successful poll resets transient retry limits and keeps the scanned state during cooldown', async() => {
  const f = fixture([qr(), response({ status: 'scanned' }), ...Array.from({ length: 3 }, () => response({ error_code: 7 })), response({ status: 'scanned' }), response({ error_code: 6 }), confirmed()])
  const nativeNow = Date.now
  let now = nativeNow()
  try {
    const started = await f.login.start(1)
    Date.now = () => now
    assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
      now += 5000
    }
    assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
    assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
    now += 5000
    assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    assert.equal(f.callbacks(), 1)
    assert.equal(f.requests[6].init.headers.get('cookie'), 'passport_csrf_token=flow-csrf')
  } finally { Date.now = nativeNow; f.login.cancelAll() }
})

test('an authentication cookie scoped away from the API root cannot authorize login', async() => {
  const f = fixture([qr(), response({ status: 'confirmed' }, ['sessionid=passport-only; Domain=.qishui.com; Path=/passport/; Secure'])])
  try {
    const started = await f.login.start(1)
    await assert.rejects(f.login.check(1, started.flowId), /未完成登录授权/)
    assert.equal(f.callbacks(), 0)
    assert.deepEqual(f.mutations, [])
  } finally { f.login.cancelAll() }
})

test('profile verification rollback restores pre-existing path-scoped cookies touched by the flow', async() => {
  const original = [
    { name: 'sessionid', value: 'original-account', domain: '.qishui.com', path: '/', secure: true },
    { name: 'passport_csrf_token', value: 'original-path-csrf', domain: '.qishui.com', path: '/passport/', secure: true },
  ]
  const f = fixture([qr({}, ['passport_csrf_token=flow-path-csrf; Domain=.qishui.com; Path=/passport/; Secure']), confirmed()], async() => { throw new Error('profile denied') }, { original })
  try {
    const started = await f.login.start(1)
    await assert.rejects(f.login.check(1, started.flowId), /profile denied/)
    assert.equal((await f.context.cookies()).sessionid, 'original-account')
    assert.equal(f.jar.get(key(original[1]))?.value, 'original-path-csrf')
  } finally { f.login.cancelAll() }
})
