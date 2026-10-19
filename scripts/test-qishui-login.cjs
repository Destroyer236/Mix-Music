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
const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) LinkLine/1.2.0 Chrome/134.0.6998.205 Electron/35.2.1 Safari/537.36'
const sdkParams = { aid: '386088', passport_jssdk_version: '2.4.13', passport_jssdk_type: 'normal', is_from_ttaccountsdk: '1', account_sdk_source: 'web', language: 'zh', p_js_v: '2.4.13', p_js_t: 'pro', p_zt: '3.3.5', p_ver: '1.0.29', request_host: 'app%3A%2F%2Fresources', p_bd: '1.0.0.41', is_new_login: '1', is_from_iesaccountsaas: '1', device_platform: 'PC', version_code: '3.7.0', account_sdk_source_info: '00' }
const identityKeys = ['device_id', 'install_id', 'did', 'iid', 'msToken']
const requestIdentity = request => Object.fromEntries(identityKeys.map(name => [name, request.url.searchParams.get(name)]))
const scanAddress = token => `https://bff-pc.qishui.com/ucenter_web/app/sdk-next?aid=386088&token=${encodeURIComponent(token)}&uc_sdk=scan-auth`

const filename = path.resolve(__dirname, '../src/main/modules/platformAccounts/qishuiLogin.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const subject = new Module(filename, module)
subject.filename = filename
subject.paths = module.paths
const nativeRequire = subject.require.bind(subject)
subject.require = name => {
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
  return response({ qrcode_index_url: scanAddress(data.token), ...data }, cookies)
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
  assert.ok(capture, 'The login controller must encode the issued scan-auth address locally')
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
  const factory = async(userAgent, signal, owner) => {
    const plan = plans.shift()
    assert.ok(plan, 'unexpected Passport client initialization')
    const requests = []
    const client = {
      requests,
      verifications: [],
      harvests: [],
      destroyed: 0,
      async fetch(url, init) {
        requests.push({ url: new URL(url), init })
        const action = plan.actions.shift()
        assert.ok(action, 'unexpected Passport client request')
        return typeof action === 'function' ? action(url, init) : action
      },
      async destroy() { this.destroyed++ },
    }
    if (plan.verifications) {
      client.verify = async(decision, generalParams) => {
        client.verifications.push({ decision, generalParams })
        assert.ok(plan.verifications.length, 'unexpected verification window')
        const action = plan.verifications.shift()
        return typeof action === 'function' ? action(decision, generalParams) : action
      }
    }
    if (plan.cookieJar || plan.harvest) {
      client.cookies = async redirect => {
        client.harvests.push(redirect)
        return plan.harvest ? plan.harvest(redirect) : plan.cookieJar
      }
    }
    calls.push({ userAgent, signal, owner })
    clients.push(client)
    await plan.initializing
    if (plan.failure) throw plan.failure
    return client
  }
  return { factory, calls, clients }
}

const authCookie = (patch = {}) => ({ name: 'sessionid_ss', value: 'verified-browser-account', domain: '.qishui.com', path: '/', secure: true, httpOnly: true, hostOnly: false, ...patch })
const secondVerify = (patch = {}, headers = {}) => response({ error_code: 2046, verify_from: 'verify_center', verify_portrait_id: 'server-verification.login', url: 'https://lf-c-flwb.bytetos.com/obj/verify/second-verify.js', biz_params: { verify_ticket: 'private-verification-ticket' }, ...patch }, [], headers)

test('2046 opens one asynchronous verification, extends expiry, and resends only after official verification succeeds', async() => {
  const gate = deferred()
  const redirect = 'https://api.qishui.com/passport/sso/login/?ticket=private-redirect-ticket'
  const decisionBiz = { token: 'wrong-token', next: 'https://outside.example/', aid: 'wrong-aid', device_id: 'wrong-device', msToken: 'wrong-ms-token', isResend: 'false', is_frontier: 'false', need_logo: 'true', is_new_login: '0', verify_ticket: 'private-verification-ticket', nested: { mode: 'sms' }, count: 2, ignored: null }
  const transport = passportFactoryFixture([{ actions: [qr(), secondVerify({ biz_params: decisionBiz }, { 'x-tt-verify-passport-decision': 'known-second-verification' }), response({ status: 'confirmed', redirect_url: redirect })], verifications: [() => gate.promise], harvest: target => target ? [authCookie()] : [] }])
  const f = fixture([], async context => assert.equal((await context.cookies()).sessionid_ss, 'verified-browser-account'), { passportFactory: transport.factory })
  try {
    const started = await f.login.start(11)
    const [first, simultaneous] = await Promise.all([f.login.check(11, started.flowId), f.login.check(11, started.flowId)])
    assert.equal(first.status, 'verifying')
    assert.deepEqual(simultaneous, first)
    assert.ok(first.expiresAt > started.expiresAt + 4 * 60 * 1000)
    const client = transport.clients[0]
    assert.equal(client.verifications.length, 1)
    assert.equal(client.verifications[0].decision.error_code, 2046)
    assert.deepEqual(Object.fromEntries(identityKeys.map(name => [name, client.verifications[0].generalParams[name]])), requestIdentity(client.requests[0]))
    for (const [name, value] of Object.entries(sdkParams)) assert.equal(client.verifications[0].generalParams[name], value)
    assert.equal((await f.login.check(11, started.flowId)).status, 'verifying')
    assert.equal(client.requests.length, 2)
    assert.equal(client.harvests.length, 0)
    assert.equal(f.callbacks(), 0)
    assert.deepEqual(f.mutations, [])
    assert.doesNotMatch(JSON.stringify(first), /private-|verify_center|server-verification|msToken/)
    gate.resolve(true)
    await tick()
    assert.equal(client.requests.length, 2, 'UI completion must wait for a new check before resubmitting')
    assert.equal((await f.login.check(11, started.flowId)).status, 'confirmed')
    const resend = client.requests[2]
    assert.equal(resend.url.searchParams.get('isResend'), 'true')
    assert.deepEqual(Object.fromEntries(new URLSearchParams(resend.init.body)), { token: 'private-upstream-token', next: 'https://api.qishui.com', is_frontier: 'true', need_logo: 'false', need_short_url: 'false', is_new_login: '1', verify_ticket: 'private-verification-ticket', nested: '{"mode":"sms"}', count: '2' })
    assert.equal(resend.init.headers.get('x-ss-stub'), createHash('md5').update(resend.init.body).digest('hex').toUpperCase())
    assert.deepEqual(client.harvests, [undefined, redirect])
    assert.equal(f.callbacks(), 1)
    assert.equal(transport.calls[0].owner, 11)
    await tick()
    assert.equal(client.destroyed, 1)
  } finally { gate.resolve(false); f.login.cancelAll() }
})

test('verification business parameters accept JSON strings, query strings, and objects without replacing QR credentials', async() => {
  for (const biz of [{ token: 'wrong', next: 'https://outside.example', ticket: 'a b', nested: { a: 1 }, count: 3, ignored: null }, '{"token":"wrong","ticket":"a b","count":3}', 'token=wrong&ticket=a%20b&count=3']) {
    const transport = passportFactoryFixture([{ actions: [qr(), secondVerify({ biz_params: biz }), confirmed()], verifications: [true] }])
    const f = fixture([], async() => {}, { passportFactory: transport.factory })
    try {
      const started = await f.login.start(1)
      assert.equal((await f.login.check(1, started.flowId)).status, 'verifying')
      await tick()
      assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
      const request = transport.clients[0].requests[2]
      const form = new URLSearchParams(request.init.body)
      assert.equal(form.get('token'), 'private-upstream-token')
      assert.equal(form.get('next'), 'https://api.qishui.com')
      assert.equal(form.get('ticket'), 'a b')
      assert.equal(form.get('count'), '3')
      assert.equal(form.has('ignored'), false)
      assert.equal(request.url.searchParams.get('isResend'), 'true')
      assert.equal(f.callbacks(), 1)
    } finally { f.login.cancelAll() }
  }
})

test('a lost verification resend consumes its completion and resumes ordinary polling without replaying the decision', async() => {
  const lost = deferred()
  const transport = passportFactoryFixture([{ actions: [qr(), secondVerify(), () => lost.promise, response({ status: 'scanned' }), confirmed()], verifications: [true] }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  try {
    const started = await f.login.start(1)
    assert.equal((await f.login.check(1, started.flowId)).status, 'verifying')
    await tick()
    const client = transport.clients[0]
    const checking = f.login.check(1, started.flowId)
    const concurrent = f.login.check(1, started.flowId)
    const failures = Promise.allSettled([checking, concurrent])
    await tick()
    assert.equal(client.requests.length, 3, 'Concurrent checks must share the one verification resend')
    const resend = client.requests[2]
    assert.equal(resend.url.searchParams.get('isResend'), 'true')
    assert.equal(new URLSearchParams(resend.init.body).get('verify_ticket'), 'private-verification-ticket')
    lost.reject(new Error('fixture transport connection lost after submission'))
    const results = await failures
    for (const result of results) {
      assert.equal(result.status, 'rejected')
      assert.match(result.reason.message, /汽水音乐登录连接失败/)
    }
    assert.equal(f.login.isActive(), true, 'A transport loss must preserve this QR flow for polling')
    assert.equal(f.callbacks(), 0)
    assert.deepEqual(f.mutations, [])
    assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
    const polling = client.requests[3]
    assert.equal(polling.url.searchParams.has('isResend'), false, 'The completed verification must not be submitted twice')
    assert.equal(new URLSearchParams(polling.init.body).has('verify_ticket'), false, 'Ordinary polling must not replay the consumed decision ticket')
    assert.equal(new URLSearchParams(polling.init.body).get('token'), 'private-upstream-token')
    assert.equal(client.verifications.length, 1)
    assert.equal(client.destroyed, 0)
    assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    assert.equal(client.requests[4].url.searchParams.has('isResend'), false)
    assert.equal(new URLSearchParams(client.requests[4].init.body).has('verify_ticket'), false)
    assert.equal(f.callbacks(), 1, 'Only a later successful server confirmation may authorize the account')
  } finally { lost.resolve(response({ status: 'scanned' })); f.login.cancelAll() }
})

test('a second 2046 after submission opens a new decision and cannot authorize before the second verification', async() => {
  const gate = deferred()
  const transport = passportFactoryFixture([{ actions: [qr(), secondVerify({ biz_params: { step: 'one' } }), secondVerify({ biz_params: 'step=two' }), confirmed()], verifications: [true, () => gate.promise] }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  try {
    const started = await f.login.start(1)
    assert.equal((await f.login.check(1, started.flowId)).status, 'verifying')
    await tick()
    assert.equal((await f.login.check(1, started.flowId)).status, 'verifying')
    assert.equal(transport.clients[0].verifications.length, 2)
    assert.equal((await f.login.check(1, started.flowId)).status, 'verifying')
    assert.equal(transport.clients[0].requests.length, 3)
    assert.equal(f.callbacks(), 0)
    gate.resolve(true)
    await tick()
    assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    assert.equal(new URLSearchParams(transport.clients[0].requests[2].init.body).get('step'), 'one')
    assert.equal(new URLSearchParams(transport.clients[0].requests[3].init.body).get('step'), 'two')
    assert.ok(transport.clients[0].requests.slice(2).every(request => request.url.searchParams.get('isResend') === 'true'))
    assert.equal(f.callbacks(), 1)
  } finally { gate.resolve(false); f.login.cancelAll() }
})

test('verification cancellation or component failure reports a sanitized error and closes the private session', async() => {
  for (const outcome of ['cancel', 'failure']) {
    const transport = passportFactoryFixture([{ actions: [qr(), secondVerify()], verifications: [outcome === 'cancel' ? false : () => { throw new Error('private-component-secret') }] }])
    const f = fixture([], async() => {}, { passportFactory: transport.factory })
    try {
      const started = await f.login.start(1)
      assert.equal((await f.login.check(1, started.flowId)).status, 'verifying')
      await tick()
      await assert.rejects(f.login.check(1, started.flowId), error => {
        assert.match(error.message, /汽水音乐安全验证未完成/)
        assert.doesNotMatch(error.message, /private-|server-verification/)
        return true
      })
      await tick()
      assert.equal(transport.clients[0].destroyed, 1)
      assert.equal(transport.clients[0].requests.length, 2)
      assert.equal(transport.clients[0].harvests.length, 0)
      assert.equal(f.login.isActive(), false)
      assert.deepEqual(f.mutations, [])
      assert.equal(f.callbacks(), 0)
    } finally { f.login.cancelAll() }
  }
})

test('verification failure preserves only known stage codes without exposing component errors', async() => {
  for (const code of ['QV01', 'QV03', 'QV04_EMPTY', 'QV04_FORMAT', 'QV04_HOST', 'QV07', 'QV08', 'QV04_SECRET']) {
    const transport = passportFactoryFixture([{ actions: [qr(), secondVerify()], verifications: [() => { throw new Error(`private-component-secret ${code} https://outside.example/?ticket=private-ticket`) }] }])
    const f = fixture([], async() => {}, { passportFactory: transport.factory })
    try {
      const started = await f.login.start(1)
      assert.equal((await f.login.check(1, started.flowId)).status, 'verifying')
      await tick()
      await assert.rejects(f.login.check(1, started.flowId), error => {
        assert.doesNotMatch(error.message, /private-|outside\.example/)
        if (code === 'QV08' || code === 'QV04_SECRET') assert.doesNotMatch(error.message, /QV/)
        else assert(error.message.includes(code), 'Known initialization/decision/component stages must remain distinguishable')
        return true
      })
      assert.equal(f.callbacks(), 0)
      assert.deepEqual(f.mutations, [])
    } finally { f.login.cancelAll() }
  }
})

test('cancel, refresh, and expiry discard late verification results without resubmitting or adopting cookies', async() => {
  for (const phase of ['cancel', 'refresh', 'expire']) {
    const gate = deferred()
    const transport = passportFactoryFixture([{ actions: [qr(), secondVerify()], verifications: [() => gate.promise], cookieJar: [authCookie()] }, ...(phase === 'refresh' ? [{ actions: [qr({ token: 'new-token' }), response({ status: 'new' })] }] : [])])
    const f = fixture([], async() => {}, { passportFactory: transport.factory })
    const nativeNow = Date.now
    try {
      const started = await f.login.start(1)
      const verifying = await f.login.check(1, started.flowId)
      assert.equal(verifying.status, 'verifying')
      let current
      if (phase === 'cancel') f.login.cancelAll()
      else if (phase === 'refresh') current = await f.login.start(1)
      else {
        Date.now = () => verifying.expiresAt + 1
        assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
      }
      gate.resolve(true)
      await tick()
      if (current) assert.equal((await f.login.check(1, current.flowId)).status, 'waiting')
      else if (phase === 'expire') assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
      else await assert.rejects(f.login.check(1, started.flowId), /已取消/)
      assert.equal(transport.clients[0].requests.length, 2)
      assert.equal(transport.clients[0].harvests.length, 0)
      assert.equal(transport.clients[0].destroyed, 1)
      assert.equal(f.callbacks(), 0)
      assert.deepEqual(f.mutations, [])
    } finally { Date.now = nativeNow; gate.resolve(false); f.login.cancelAll() }
  }
})

test('only a successful server confirmation can harvest the isolated browser jar', async() => {
  for (const data of [{ status: 'new' }, { status: 'scanned' }, { status: 'confirmed', error_code: 2156 }]) {
    const transport = passportFactoryFixture([{ actions: [qr(), response(data)], cookieJar: [authCookie()] }])
    const f = fixture([], async() => {}, { passportFactory: transport.factory })
    try {
      const started = await f.login.start(1)
      const checking = f.login.check(1, started.flowId)
      if (data.error_code) await assert.rejects(checking, /2156/)
      else assert.equal((await checking).status, data.status === 'new' ? 'waiting' : 'scanned')
      assert.equal(transport.clients[0].harvests.length, 0)
      assert.equal(f.callbacks(), 0)
      assert.deepEqual(f.mutations, [])
    } finally { f.login.cancelAll() }
  }
})

test('isolated jar cookies are domain and path scoped and still require successful profile verification', async() => {
  for (const rejectProfile of [false, true]) {
    const cookieJar = [authCookie(), authCookie({ name: 'outside-cookie', domain: '.evil.example' }), authCookie({ name: 'wrong-domain', domain: '.qishui.com.evil.example' }), authCookie({ name: 'invalid-path', path: 'passport' }), authCookie({ name: 'expired-cookie', expirationDate: 1 }), authCookie({ name: 'host-only-root', hostOnly: true }), authCookie({ name: 'passport_csrf_token', value: 'path-only-csrf', path: '/passport/' })]
    const original = authCookie({ value: 'previous-account' })
    const transport = passportFactoryFixture([{ actions: [qr(), response({ status: 'confirmed' })], cookieJar }])
    const f = fixture([], async() => { if (rejectProfile) throw new Error('profile denied') }, { passportFactory: transport.factory, original: [original] })
    try {
      const started = await f.login.start(1)
      const checking = f.login.check(1, started.flowId)
      if (rejectProfile) await assert.rejects(checking, /profile denied/)
      else assert.equal((await checking).status, 'confirmed')
      assert.equal((await f.context.cookies()).sessionid_ss, rejectProfile ? 'previous-account' : 'verified-browser-account')
      assert.equal(f.callbacks(), 1)
      assert.ok(f.mutations.every(item => ['sessionid_ss', 'passport_csrf_token'].includes(item.name)))
    } finally { f.login.cancelAll() }
  }
})

test('untrusted confirmation redirects are rejected before the browser client follows them', async() => {
  for (const redirect of ['https://evil.example/private', 'http://api.qishui.com/private', 'https://user:secret@api.qishui.com/private', 'https://api.qishui.com:444/private', 'https://api.qishui.com.evil.example/private']) {
    const transport = passportFactoryFixture([{ actions: [qr(), response({ status: 'confirmed', redirect_url: redirect })], cookieJar: [] }])
    const f = fixture([], async() => {}, { passportFactory: transport.factory })
    try {
      const started = await f.login.start(1)
      await assert.rejects(f.login.check(1, started.flowId), /登录授权地址无效/)
      assert.deepEqual(transport.clients[0].harvests, [undefined])
      assert.equal(f.callbacks(), 0)
      assert.deepEqual(f.mutations, [])
    } finally { f.login.cancelAll() }
  }
})

test('fresh private authentication cookies complete confirmation without following an unnecessary redirect', async() => {
  const transport = passportFactoryFixture([{ actions: [qr(), response({ status: 'confirmed', redirect_url: 'https://outside.example/unnecessary' })], cookieJar: [authCookie()] }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  try {
    const started = await f.login.start(1)
    assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    assert.deepEqual(transport.clients[0].harvests, [undefined])
    assert.equal(f.callbacks(), 1)
  } finally { f.login.cancelAll() }
})

test('cancellation during browser cookie harvesting rejects a late jar before persistent transfer', async() => {
  const gate = deferred()
  const entered = deferred()
  const transport = passportFactoryFixture([{ actions: [qr(), response({ status: 'confirmed' })], harvest: () => { entered.resolve(); return gate.promise } }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  const started = await f.login.start(1)
  const checking = f.login.check(1, started.flowId)
  const rejected = assert.rejects(checking, /已取消/)
  await entered.promise
  f.login.cancelAll()
  gate.resolve([authCookie()])
  await rejected
  await tick()
  assert.equal(transport.clients[0].destroyed, 1)
  assert.equal(f.callbacks(), 0)
  assert.deepEqual(f.mutations, [])
})

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
    assert.equal(transport.calls[0].owner, 1)
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

test('browser Passport client still rejects 2156 and cannot reuse an older account when its private jar is empty', async() => {
  for (const invalid of ['business-error', 'missing-cookie']) {
    const cookies = invalid === 'business-error' ? ['sessionid=rejected-account; Domain=.qishui.com; Path=/; Secure'] : []
    const transport = passportFactoryFixture([{ actions: [qr(), response({ status: 'confirmed', error_code: invalid === 'business-error' ? 2156 : 0 }, cookies)], cookieJar: invalid === 'business-error' ? [{ name: 'sessionid', value: 'unverified-browser-account', domain: '.qishui.com', path: '/' }] : [] }])
    const original = { name: 'sessionid', value: 'previous-account', domain: '.qishui.com', path: '/', secure: true }
    const f = fixture([], async() => {}, { passportFactory: transport.factory, original: [original] })
    try {
      const started = await f.login.start(1)
      await assert.rejects(f.login.check(1, started.flowId), invalid === 'business-error' ? /错误码 2156/ : /未完成登录授权/)
      await tick()
      assert.equal(transport.clients[0].destroyed, 1)
      assert.equal(f.callbacks(), 0)
      assert.equal((await f.context.cookies()).sessionid, 'previous-account')
      assert.deepEqual(f.mutations, [])
      assert.equal(f.requests.length, 0)
      assert.equal(transport.clients[0].harvests.length, invalid === 'business-error' ? 0 : 1)
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
  assert.equal(scan.pathname, '/ucenter_web/app/sdk-next')
  assert.equal(scan.searchParams.get('token'), 'private-upstream-token')
  assert.equal(scan.searchParams.get('uc_sdk'), 'scan-auth')
  assert.equal(qrPayloads.at(-1).payload, scanAddress('private-upstream-token'))
  assert.equal(f.jar.size, 0)
  assert.equal(f.requests[0].url.origin, 'https://api.qishui.com')
  assert.equal(f.requests[0].url.pathname, '/passport/web/get_qrcode/')
  const createQuery = new URLSearchParams(f.requests[0].url.searchParams)
  createQuery.delete('biz_trace_id')
  const identity = requestIdentity(f.requests[0])
  assert.match(identity.device_id, /^[1-8]\d{15}$/)
  assert.match(identity.install_id, /^[1-8]\d{14}$/)
  assert.equal(identity.did, identity.device_id)
  assert.equal(identity.iid, identity.install_id)
  assert.match(identity.msToken, /^[a-zA-Z\d_-]{118}==$/)
  assert.deepEqual(Object.fromEntries(createQuery), { ...sdkParams, ...identity, next: 'https://api.qishui.com', need_logo: 'false', need_short_url: 'false' })
  assert.equal(f.requests[0].init.headers.get('user-agent'), browserUserAgent)
  assert.equal(f.requests[0].init.headers.get('x-ss-stub'), null)
  assert.equal(f.requests[0].init.credentials, 'omit')
  assert.equal(f.requests[0].init.redirect, 'error')
  assert.equal((await f.login.check(17, started.flowId)).status, 'scanned')
  assert.equal(f.requests[1].url.pathname, '/passport/web/check_qrconnect/')
  const checkQuery = new URLSearchParams(f.requests[1].url.searchParams)
  checkQuery.delete('biz_trace_id')
  assert.deepEqual(Object.fromEntries(checkQuery), { ...sdkParams, ...identity })
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

test('browser identity and verification portrait remain per-flow while request traces change on every call', async() => {
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
    assert.equal(new Set(traces).size, traces.length)
    assert.deepEqual(requestIdentity(f.requests[0]), requestIdentity(f.requests[1]))
    assert.deepEqual(requestIdentity(f.requests[2]), requestIdentity(f.requests[3]))
    for (const name of identityKeys) assert.notEqual(requestIdentity(f.requests[0])[name], requestIdentity(f.requests[2])[name])
    assert.deepEqual(f.requests.map(request => request.url.searchParams.get('biz_trace_id')), traces)
    assert.deepEqual(f.requests.map(request => request.init.headers.get('user-agent')), [browserUserAgent, browserUserAgent, nextUserAgent, nextUserAgent])
    assert.ok(f.requests.every(request => !request.init.headers.get('user-agent').startsWith('LunaPC/')))
    assert.ok(!JSON.stringify([first, second]).includes('.login'))
    assert.ok(f.requests.every(request => !/(?:^|;\s*)passport_trace_id=/.test(request.init.headers.get('cookie') ?? '')))
    assert.deepEqual(f.mutations, [])
  } finally { f.login.cancelAll() }
})

test('scan-auth polls frontier mode regardless of the upstream QR flag', async() => {
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

test('generated scan-auth QR preserves the exact issued URL and reserved token bytes while ignoring the upstream image', async() => {
  const token = 'synthetic+a/b==& space汉字%?'
  const f = fixture([qr({ token, qrcode: 'https://untrusted.example/web-image.svg' }), response({ status: 'new' })])
  try {
    const started = await f.login.start(1)
    const scan = encodedQr(started.image)
    assert.equal(scan.searchParams.get('token'), token)
    assert.equal(qrPayloads.at(-1).payload, scanAddress(token))
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

test('Passport transient code 6 backs off for five seconds and fails after three retries', async() => {
  for (const code of [6]) {
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

test('Passport rate limit 7 preserves a scanned flow beyond three retries and later opens the required official verification', async() => {
  const rateLimited = () => response({ error_code: 7, description: 'private-rate-limit-details' }, ['sessionid=rejected-account; Domain=.qishui.com; Path=/'])
  const transport = passportFactoryFixture([{ actions: [qr(), response({ status: 'scanned' }), ...Array.from({ length: 5 }, rateLimited), secondVerify(), confirmed()], verifications: [true] }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  const nativeNow = Date.now
  let now = nativeNow()
  try {
    const started = await f.login.start(1)
    Date.now = () => now
    assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
    const client = transport.clients[0]
    for (const delay of [5000, 10000, 20000, 30000, 30000]) {
      const limited = await f.login.check(1, started.flowId)
      assert.equal(limited.status, 'scanned')
      assert.equal(limited.retryAt, Date.now() + delay, 'Rate-limit polling must use a bounded increasing delay')
      assert.equal(limited.expiresAt, started.expiresAt, 'Rate limiting must not extend the QR lifetime')
      assert.equal(f.login.isActive(), true)
      assert.doesNotMatch(JSON.stringify(limited), /private-|rejected-account|error_code|description/)
      const requests = client.requests.length
      assert.equal((await f.login.check(1, started.flowId)).retryAt, limited.retryAt)
      now = limited.retryAt - 1
      assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
      assert.equal(client.requests.length, requests, 'Repeated checks must never poll before the returned deadline')
      now = limited.retryAt
    }
    assert.equal(f.callbacks(), 0)
    assert.deepEqual(f.mutations, [], 'Rate-limit response cookies must not authorize the account')
    const verifying = await f.login.check(1, started.flowId)
    assert.equal(verifying.status, 'verifying', 'A challenge returned after the cooldown must open the official verification flow')
    assert.equal(verifying.retryAt, undefined)
    await tick()
    assert.equal(client.verifications.length, 1)
    assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    assert.equal(f.callbacks(), 1)
    assert.equal(client.requests.at(-1).url.searchParams.get('isResend'), 'true')
    assert.equal(client.requests.length, 9)
  } finally { Date.now = nativeNow; f.login.cancelAll() }
})

test('Passport rate-limit polling ends at QR expiry without another request or authorization', async() => {
  const transport = passportFactoryFixture([{ actions: [qr(), response({ status: 'scanned' }), response({ error_code: 7 })] }])
  const f = fixture([], async() => {}, { passportFactory: transport.factory })
  const nativeNow = Date.now
  let now = nativeNow()
  try {
    const started = await f.login.start(1)
    Date.now = () => now
    assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
    now = started.expiresAt - 1000
    const limited = await f.login.check(1, started.flowId)
    assert.equal(limited.status, 'scanned')
    assert.equal(limited.retryAt, started.expiresAt, 'The next retry must be capped at the QR deadline')
    now = started.expiresAt
    assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
    assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
    assert.equal(transport.clients[0].requests.length, 3)
    assert.equal(f.login.isActive(), false)
    assert.equal(f.callbacks(), 0)
    assert.deepEqual(f.mutations, [])
    await f.login.settled()
    assert.equal(transport.clients[0].destroyed, 1)
  } finally { Date.now = nativeNow; f.login.cancelAll() }
})

test('a successful poll resets Passport rate-limit backoff before another limit and later confirmation', async() => {
  const f = fixture([qr(), response({ status: 'scanned' }), response({ error_code: 7 }), response({ error_code: 7 }), response({ status: 'scanned' }), response({ error_code: 7 }), confirmed()])
  const nativeNow = Date.now
  let now = nativeNow()
  try {
    const started = await f.login.start(1)
    Date.now = () => now
    assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
    for (const delay of [5000, 10000]) {
      const limited = await f.login.check(1, started.flowId)
      assert.equal(limited.status, 'scanned')
      assert.equal(limited.retryAt, now + delay)
      now = limited.retryAt
    }
    const resumed = await f.login.check(1, started.flowId)
    assert.equal(resumed.status, 'scanned')
    assert.equal(resumed.retryAt, undefined)
    const limitedAgain = await f.login.check(1, started.flowId)
    assert.equal(limitedAgain.status, 'scanned')
    assert.equal(limitedAgain.retryAt, now + 5000, 'A successful response must reset the next rate-limit delay')
    now = limitedAgain.retryAt
    assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
    assert.equal(f.callbacks(), 1)
    assert.equal(f.requests.at(-1).init.headers.get('cookie'), 'passport_csrf_token=flow-csrf')
    assert.equal(f.requests.length, 7)
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
