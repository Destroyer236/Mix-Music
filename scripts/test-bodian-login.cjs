const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../src/main/modules/platformAccounts/bodianLogin.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const subject = new Module(filename, module)
subject.filename = filename
subject.paths = module.paths
const nativeRequire = subject.require.bind(subject)
const rendered = []
const image = 'data:image/png;base64,fixture'
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
subject.require = id => id === 'qrcode' ? { async toDataURL(value) { rendered.push(value); return image } } : id === './providers/bodianApi' ? {
  object,
  text: value => String(value ?? '').replace(/<[^>]*>/g, '').trim(),
  itemId: value => (typeof value !== 'number' || Number.isSafeInteger(value)) && /^[1-9]\d{0,24}$/.test(String(value ?? '')) ? String(value) : '',
  request: (context, route, options) => context.request(route, options),
} : nativeRequire(id)
subject._compile(compiled, filename)
const { createBodianLogin } = subject.exports
const qr = () => ({ qrCode: '1234567890abcdef' })
const status = value => ({ status: value })
const identity = (patch = {}) => ({ id: '120001', token: 'private-auth-token', userInfo: { uid: '120001', nickname: '波点用户', headImg: 'https://img.kuwo.cn/avatar.jpg' }, ...patch })
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
const key = cookie => `${String(cookie.domain ?? 'bd-api.kuwo.cn').replace(/^\./, '')}|${cookie.path ?? '/'}|${cookie.name}`

function fixture(actions = [], callback = async() => {}, options = {}) {
  const requests = []
  const jar = new Map((options.original ?? []).map(cookie => [key(cookie), cookie]))
  let callbacks = 0
  const context = {
    async request(route, options) {
      requests.push({ route, options })
      const action = actions.shift()
      assert.ok(action, 'unexpected upstream request')
      return typeof action === 'function' ? action(route, options) : action
    },
    session: {
      cookies: {
        async get() { return [...jar.values()] },
        async set(cookie) {
          jar.set(key(cookie), { ...cookie, hostOnly: !cookie.domain, domain: cookie.domain ?? 'bd-api.kuwo.cn', path: cookie.path ?? '/' })
          await options.onSet?.(cookie)
        },
        async remove(_url, name) { for (const [id, cookie] of jar) if (cookie.name === name) jar.delete(id) },
        async flushStore() {},
      },
    },
    async cookies() { return Object.fromEntries([...jar.values()].map(cookie => [cookie.name, cookie.value])) },
  }
  const login = createBodianLogin(context, async() => { callbacks++; await callback(context) })
  return { context, login, jar, requests, callbacks: () => callbacks }
}

test('official QR stays private and confirmed identity is persisted once', async() => {
  const f = fixture([qr(), status(1), status(3), identity()], async context => {
    const cookies = await context.cookies()
    assert.equal(cookies.linkline_bodian_uid, '120001')
    assert.equal(cookies.linkline_bodian_token, 'private-auth-token')
    assert.equal(decodeURIComponent(cookies.linkline_bodian_nickname), '波点用户')
    assert.equal(decodeURIComponent(cookies.linkline_bodian_avatar), 'https://img.kuwo.cn/avatar.jpg')
  })
  const started = await f.login.start(17)
  assert.deepEqual(Object.keys(started).sort(), ['expiresAt', 'flowId', 'image', 'status'])
  assert.equal(started.image, image)
  assert.match(started.flowId, /^[a-f0-9-]{36}$/)
  assert.ok(!JSON.stringify(started).includes('1234567890abcdef'))
  assert.equal(f.jar.size, 0)
  assert.equal(rendered.at(-1), 'https://bodian-oia.kuwo.cn/bodian/download.html?pageName=login_pc&pt=3&id=1234567890abcdef')
  assert.equal(f.requests[0].route, '/api/ucenter/login/qrCode')
  assert.equal(f.requests[0].options.signed, true)
  assert.equal(f.requests[0].options.anonymous, true)
  assert.equal((await f.login.check(17, started.flowId)).status, 'waiting')
  assert.equal((await f.login.check(17, started.flowId)).status, 'confirmed')
  assert.equal((await f.login.check(17, started.flowId)).status, 'confirmed')
  assert.equal(f.requests[1].route, '/api/ucenter/login/qrCodeStatus')
  assert.deepEqual(f.requests[1].options.query, { qrCode: '1234567890abcdef' })
  assert.equal(f.requests[3].route, '/api/ucenter/users/login')
  assert.deepEqual(f.requests[3].options.body, { authType: 10, qrCode: '1234567890abcdef' })
  assert.equal(f.callbacks(), 1)
  assert.equal(f.login.cancel(17, started.flowId), false)
  assert.ok([...f.jar.values()].every(cookie => cookie.httpOnly && cookie.secure))
})

test('scanned but unconfirmed response polls again without persisting any identity', async() => {
  const f = fixture([qr(), status(3), () => { throw Object.assign(new Error('pending confirmation'), { code: 11027 }) }, status(3), identity()])
  const started = await f.login.start(1)
  assert.equal((await f.login.check(1, started.flowId)).status, 'scanned')
  assert.equal(f.jar.size, 0)
  assert.equal(f.callbacks(), 0)
  assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
  f.login.cancelAll()
})

test('owner validation and stale flow requests never reach the network', async() => {
  const f = fixture([qr()])
  const started = await f.login.start(1)
  await assert.rejects(f.login.check(2, started.flowId), /不属于/)
  assert.throws(() => f.login.cancel(2, started.flowId), /不属于/)
  await assert.rejects(f.login.check(1, 'stale'), /已取消/)
  assert.equal(f.login.cancel(1, 'stale'), false)
  await assert.rejects(f.login.start(0), /无效/)
  assert.equal(f.requests.length, 1)
  f.login.cancelAll()
})

test('concurrent checks share exactly one login and one sync', async() => {
  const wait = deferred()
  const f = fixture([qr(), () => wait.promise, identity()])
  const started = await f.login.start(1)
  const a = f.login.check(1, started.flowId)
  const b = f.login.check(1, started.flowId)
  wait.resolve(status(3))
  assert.deepEqual(await a, await b)
  assert.equal(f.requests.length, 3)
  assert.equal(f.callbacks(), 1)
  f.login.cancelAll()
})

test('cancel aborts QR creation and discards its late response', async() => {
  const wait = deferred()
  const f = fixture([() => wait.promise])
  const pending = f.login.start(1)
  const rejected = assert.rejects(pending, /已取消/)
  await tick()
  assert.equal(f.login.cancel(1), true)
  assert.equal(f.requests[0].options.signal.aborted, true)
  wait.resolve(qr())
  await rejected
  assert.equal(f.jar.size, 0)
})

test('cancel while authenticating does not revive an account after logout', async() => {
  const wait = deferred()
  const f = fixture([qr(), status(3), () => wait.promise])
  const started = await f.login.start(1)
  const pending = f.login.check(1, started.flowId)
  const rejected = assert.rejects(pending, /已取消/)
  while (f.requests.length < 3) await tick()
  f.login.cancelAll()
  wait.resolve(identity())
  await rejected
  await f.login.settled()
  assert.equal(f.jar.size, 0)
  assert.equal(f.callbacks(), 0)
})

test('cancel during cookie transfer restores old identity before another flow begins', async() => {
  const gate = deferred()
  let entered = false
  const original = { name: 'linkline_bodian_token', value: 'old-token', domain: 'bd-api.kuwo.cn', path: '/', secure: true, httpOnly: true, hostOnly: true }
  const f = fixture([qr(), status(3), identity(), qr()], async() => {}, { original: [original], async onSet(cookie) { if (cookie.value === 'private-auth-token') { entered = true; await gate.promise } } })
  const started = await f.login.start(1)
  const pending = f.login.check(1, started.flowId)
  const rejected = assert.rejects(pending, /已取消/)
  while (!entered) await tick()
  f.login.cancelAll()
  const next = f.login.start(1)
  await tick()
  assert.equal(f.requests.length, 3, 'next QR waits for rollback')
  gate.resolve()
  await rejected
  await next
  assert.deepEqual(await f.context.cookies(), { linkline_bodian_token: 'old-token' })
  assert.equal(f.callbacks(), 0)
  f.login.cancelAll()
})

test('failed sync rolls back and allows retry with the same confirmed QR', async() => {
  let failure = true
  const f = fixture([qr(), status(3), identity(), status(3), identity()], async() => { if (failure) { failure = false; throw new Error('profile failed') } })
  const started = await f.login.start(1)
  await assert.rejects(f.login.check(1, started.flowId), /profile failed/)
  assert.equal(f.jar.size, 0)
  assert.equal((await f.login.check(1, started.flowId)).status, 'confirmed')
  assert.equal(f.callbacks(), 2)
  f.login.cancelAll()
})

test('settled waits for a cancelled profile callback and its rollback', async() => {
  const gate = deferred()
  const f = fixture([qr(), status(3), identity()], () => gate.promise)
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
  assert.equal(f.jar.size, 0)
})

test('upstream expiry and local expiry never store authentication', async() => {
  const f = fixture([qr(), status(2), qr()])
  let started = await f.login.start(1)
  assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
  started = await f.login.start(1)
  const now = Date.now
  Date.now = () => started.expiresAt + 1
  try {
    assert.equal((await f.login.check(1, started.flowId)).status, 'expired')
    assert.equal(f.requests.length, 3)
    assert.equal(f.jar.size, 0)
    assert.equal(f.login.isActive(), false)
  } finally { Date.now = now; f.login.cancelAll() }
})

test('invalid QR codes, mismatched identities and absent tokens fail closed', async() => {
  for (const value of ['https://outside.example/qr', '', 'a'.repeat(100), '<script>']) {
    const f = fixture([{ qrCode: value }])
    await assert.rejects(f.login.start(1), /有效的登录二维码/)
    assert.equal(f.jar.size, 0)
  }
  for (const patch of [{ uid: '9999' }, { id: 9007199254740992 }, { userInfo: { uid: '7777' } }, { token: '' }, { token: 'a; session=x' }, { token: 'x\ny' }]) {
    const f = fixture([qr(), status(3), identity(patch)])
    const started = await f.login.start(1)
    await assert.rejects(f.login.check(1, started.flowId), /波点音乐/)
    assert.equal(f.jar.size, 0)
    assert.equal(f.callbacks(), 0)
    f.login.cancelAll()
  }
})
