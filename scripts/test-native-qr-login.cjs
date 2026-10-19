const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')
const encryption = require('NeteaseCloudMusicApi/util/crypto')

const filename = path.resolve(__dirname, '../src/main/modules/platformAccounts/nativeLogin.ts')
const subject = new Module(filename, module)
subject.filename = filename
subject.paths = module.paths
subject._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename)
const { createNativeLogin } = subject.exports
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const response = (body, cookies = [], status = 200, headers = {}) => new Response(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body), { status, headers: [...Object.entries(headers), ...cookies.map(value => ['Set-Cookie', value])] })
const qr = platform => platform === 'qq' ? response(png, ['qrsig=private-qr; Domain=ptlogin2.qq.com; Path=/; Secure']) : response({ code: 200, unikey: 'private-key' })
const state = (platform, code) => platform === 'qq' ? response("ptuiCB('" + code + "','0','','0','','');") : response({ code })
const approved = platform => platform === 'qq' ? [
  response("ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?uin=123456&service=login','0','','name');"),
  response('', ['p_skey=private-graph-key; Domain=qq.com; Path=/; Secure'], 302, { location: 'https://graph.qq.com/oauth2.0/login_jump' }),
  response('', [], 302, { location: 'https://y.qq.com/portal/wx_redirect.html?code=private-oauth-code&state=state' }),
  response({ code: 0, request: { code: 0, data: { str_musicid: '987654', musickey: 'new-session', refresh_key: 'private-refresh-key' } } }),
] : [response({ code: 803 }, ['__csrf=new-csrf; Domain=.music.163.com; Path=/; Secure, MUSIC_U=new-session; Domain=.music.163.com; Path=/; Secure; HttpOnly'])]
const key = cookie => String(cookie.domain).replace(/^\./, '') + '|' + (cookie.path ?? '/') + '|' + cookie.name

function fixture(platform, actions, options = {}) {
  const requests = []
  const jar = new Map((options.original ?? []).map(cookie => [key(cookie), { path: '/', secure: true, ...cookie }]))
  let prepares = 0, commits = 0
  const fetch = async(address, init) => {
    requests.push({ url: new URL(address), init })
    const action = actions.shift()
    assert.ok(action, 'unexpected request')
    return typeof action === 'function' ? action(address, init) : action
  }
  const context = {
    session: { fetch, cookies: {
      async get() { return [...jar.values()] },
      async set(cookie) { jar.set(key(cookie), { ...cookie, domain: cookie.domain ?? new URL(cookie.url).hostname, hostOnly: !cookie.domain }); await options.onSet?.(cookie) },
      async remove(url, name) { for (const [id, cookie] of jar) if (cookie.name === name && new URL(url).hostname === String(cookie.domain).replace(/^\./, '')) jar.delete(id) },
      async flushStore() {},
    } },
    async cookies() { return Object.fromEntries([...jar.values()].map(cookie => [cookie.name, cookie.value])) },
  }
  const login = createNativeLogin(context, platform, async() => { prepares++; await options.prepare?.(context); return () => { commits++ } }, fetch)
  return { login, context, requests, jar, prepares: () => prepares, commits: () => commits }
}

for (const platform of ['qq', 'netease']) {
  test(platform + ': private QR, waiting/scanned/confirmed states, exact music authorization and old identity removal', async() => {
    const f = fixture(platform, [qr(platform), state(platform, platform === 'qq' ? 66 : 801), state(platform, platform === 'qq' ? 67 : 802), ...approved(platform)], { original: platform === 'qq' ? [
      { name: 'qqmusic_uin', value: '111', domain: '.qq.com' }, { name: 'qqmusic_key', value: 'old-session', domain: '.qq.com' }, { name: 'qqmusic_key', value: 'old-shadow', domain: 'y.qq.com' }, { name: 'euin', value: 'old-euin', domain: '.y.qq.com' },
    ] : [] })
    const start = await f.login.start(7)
    assert.deepEqual(Object.keys(start).sort(), ['expiresAt', 'flowId', 'image', 'status'])
    assert.ok(start.image.startsWith('data:image/png;base64,'))
    assert.notEqual(start.flowId, 'private-key')
    assert.equal((await f.login.check(7, start.flowId)).status, 'waiting')
    assert.equal((await f.login.check(7, start.flowId)).status, 'scanned')
    assert.equal((await f.login.check(7, start.flowId)).status, 'confirmed')
    assert.equal((await f.login.check(7, start.flowId)).status, 'confirmed')
    assert.equal(f.prepares(), 1)
    assert.equal(f.commits(), 1)
    assert.equal(f.login.cancel(7, start.flowId), false)
    const cookies = await f.context.cookies()
    if (platform === 'qq') {
      assert.equal(cookies.qqmusic_uin, '987654')
      assert.equal(cookies.uin, '987654')
      assert.equal(cookies.qqmusic_key, 'new-session')
      assert.equal(cookies.qm_keyst, 'new-session')
      assert.equal(cookies.euin, undefined)
      const graph = f.requests.find(item => item.url.hostname === 'graph.qq.com')
      assert.match(graph.init.headers.get('cookie'), /p_skey=private-graph-key/)
      const payload = JSON.parse(f.requests.at(-1).init.body)
      assert.equal(payload.request.module, 'QQConnectLogin.LoginServer')
      assert.equal(payload.request.method, 'QQLogin')
      assert.equal(payload.request.param.code, 'private-oauth-code')
    } else {
      assert.equal(cookies.MUSIC_U, 'new-session')
      assert.equal(cookies.__csrf, 'new-csrf')
      assert.equal(f.requests[0].url.pathname, '/eapi/login/qrcode/unikey')
      assert.equal(f.requests[1].url.pathname, '/eapi/login/qrcode/client/login')
      assert.equal(f.requests[0].url.hostname, 'interfacepc.music.163.com')
      assert.equal(new URLSearchParams(f.requests[0].init.body).has('encSecKey'), false)
      assert.equal(encryption.eapiReqDecrypt(new URLSearchParams(f.requests[0].init.body).get('params')).data.type, 3)
    }
    for (const request of f.requests) { assert.equal(request.init.credentials, 'omit'); assert.equal(request.init.redirect, platform === 'qq' ? 'manual' : 'error') }
  })

  test(platform + ': owner, invalid owner, scoped stale cancel and expiry guards', async() => {
    const f = fixture(platform, [qr(platform), qr(platform), state(platform, platform === 'qq' ? 65 : 800)])
    await assert.rejects(f.login.start(0), /无效/)
    const first = await f.login.start(1)
    await assert.rejects(f.login.check(2, first.flowId), /不属于/)
    assert.throws(() => f.login.cancel(2, first.flowId), /不属于/)
    const second = await f.login.start(1)
    await assert.rejects(f.login.check(1, first.flowId), /已取消/)
    assert.equal(f.login.cancel(1, first.flowId), false)
    assert.equal((await f.login.check(1, second.flowId)).status, 'expired')
    assert.equal((await f.login.check(1, second.flowId)).status, 'expired')
    assert.equal(f.requests.length, 3)
    assert.equal(f.jar.size, 0)
    f.login.cancelAll()
  })

  test(platform + ': concurrent check coalesces; close while request pending blocks late cookie mutation', async() => {
    const pending = deferred()
    const f = fixture(platform, [qr(platform), () => pending.promise])
    const start = await f.login.start(8)
    const one = f.login.check(8, start.flowId), two = f.login.check(8, start.flowId)
    await tick()
    assert.equal(f.requests.length, 2)
    assert.equal(f.login.cancel(8), true)
    pending.resolve(approved(platform)[0])
    await assert.rejects(one, /已取消/)
    await assert.rejects(two, /已取消/)
    assert.equal(f.jar.size, 0)
    assert.equal(f.commits(), 0)
  })

  test(platform + ': close during start cancels initial QR and permits clean replacement', async() => {
    const pending = deferred()
    const f = fixture(platform, [() => pending.promise, qr(platform)])
    const first = f.login.start(9)
    await tick()
    f.login.cancel(9)
    const second = await f.login.start(9)
    pending.resolve(qr(platform))
    await assert.rejects(first, /已取消/)
    assert.equal(f.login.isActive(), true)
    assert.equal(f.login.cancel(9, 'old-id'), false)
    assert.equal(f.login.cancel(9, second.flowId), true)
  })

  test(platform + ': failed profile restores previous account cookies exactly', async() => {
    const name = platform === 'qq' ? 'qqmusic_key' : 'MUSIC_U'
    const f = fixture(platform, [qr(platform), ...approved(platform)], { original: [{ name, value: 'old-session', domain: platform === 'qq' ? '.qq.com' : '.music.163.com' }], prepare: async() => { throw new Error('profile verification failed') } })
    const start = await f.login.start(1)
    await assert.rejects(f.login.check(1, start.flowId), /profile verification/)
    assert.equal((await f.context.cookies())[name], 'old-session')
    assert.equal(f.jar.size, 1)
    assert.equal(f.commits(), 0)
    f.login.cancelAll()
  })

  test(platform + ': cancel during profile rolls back before replacement login; no partial commit', async() => {
    const preparing = deferred(), release = deferred()
    const name = platform === 'qq' ? 'qqmusic_key' : 'MUSIC_U'
    const f = fixture(platform, [qr(platform), ...approved(platform), qr(platform)], { original: [{ name, value: 'old-session', domain: platform === 'qq' ? '.qq.com' : '.music.163.com' }], prepare: async() => { preparing.resolve(); await release.promise } })
    const start = await f.login.start(1)
    const check = f.login.check(1, start.flowId)
    await preparing.promise
    f.login.cancel(1, start.flowId)
    const replacement = f.login.start(1)
    release.resolve()
    await assert.rejects(check, /已取消/)
    await replacement
    assert.equal((await f.context.cookies())[name], 'old-session')
    assert.equal(f.commits(), 0)
    f.login.cancelAll()
  })
}

test('QQ rejects unsafe check_sig and off-domain OAuth redirect before credential exchange', async() => {
  for (const url of ['https://evil.example/check_sig', 'http://ssl.ptlogin2.qq.com/check_sig', 'https://ssl.ptlogin2.qq.com/wrong']) {
    const f = fixture('qq', [qr('qq'), response("ptuiCB('0','0','" + url + "','0','','');")])
    const start = await f.login.start(1)
    await assert.rejects(f.login.check(1, start.flowId), /授权地址无效/)
    assert.equal(f.requests.length, 2)
    assert.equal(f.jar.size, 0)
    f.login.cancelAll()
  }
  const actions = approved('qq')
  actions[2] = response('', [], 302, { location: 'https://evil.example/?code=secret' })
  const f = fixture('qq', [qr('qq'), ...actions])
  const start = await f.login.start(1)
  await assert.rejects(f.login.check(1, start.flowId), /授权结果无效/)
  assert.equal(f.requests.length, 4)
  assert.equal(f.jar.size, 0)
  f.login.cancelAll()
})

test('NetEase approval without MUSIC_U cannot invoke profile or commit', async() => {
  const f = fixture('netease', [qr('netease'), response({ code: 803 })])
  const start = await f.login.start(1)
  await assert.rejects(f.login.check(1, start.flowId), /音乐登录授权/)
  assert.equal(f.prepares(), 0)
  assert.equal(f.commits(), 0)
  f.login.cancelAll()
})

test('NetEase keeps the upstream EAPI type 3 protocol, private device and NMTID stable across QR requests', async() => {
  const f = fixture('netease', [
    response({ code: 200, unikey: 'private-key' }, ['NMTID=key-device; Domain=.music.163.com; Path=/; Secure, __csrf=key-csrf; Domain=.music.163.com; Path=/; Secure']),
    response({ code: 801 }, ['NMTID=poll-device; Domain=.music.163.com; Path=/; Secure, __csrf=poll-csrf; Domain=.music.163.com; Path=/; Secure']),
    ...approved('netease'),
  ], { original: [{ name: 'MUSIC_U', value: 'previous-account', domain: '.music.163.com' }] })
  try {
    const start = await f.login.start(1)
    assert.equal((await f.login.check(1, start.flowId)).status, 'waiting')
    assert.equal((await f.login.check(1, start.flowId)).status, 'confirmed')
    const decrypted = f.requests.map(request => encryption.eapiReqDecrypt(new URLSearchParams(request.init.body).get('params')))
    const payloads = decrypted.map(item => item.data)
    assert.deepEqual(payloads.map(item => item.type), [3, 3, 3])
    assert.deepEqual(decrypted.map(item => item.url), ['/api/login/qrcode/unikey', '/api/login/qrcode/client/login', '/api/login/qrcode/client/login'])
    assert.deepEqual(payloads.map(item => item.e_r), [false, false, false])
    assert.deepEqual(payloads.map(item => item.header.NMTID), [undefined, 'key-device', 'poll-device'])
    assert.match(payloads[0].header.deviceId, /^[A-F0-9]{52}$/)
    assert.equal(new Set(payloads.map(item => item.header.deviceId)).size, 1)
    assert.equal(new Set(payloads.map(item => item.header.buildver)).size, 1)
    assert.equal(new Set(payloads.map(item => item.header.requestId)).size, 3)
    assert.deepEqual(payloads.map(item => item.header.__csrf), ['', '', ''])
    for (const request of f.requests) {
      assert.equal(request.url.origin, 'https://interfacepc.music.163.com')
      assert.equal(request.init.headers.get('User-Agent'), 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)')
      assert.match(request.init.headers.get('Cookie'), /deviceId=/)
      assert.doesNotMatch(request.init.headers.get('Cookie'), /previous-account|MUSIC_U=|key-csrf|poll-csrf/)
      assert.equal(request.init.credentials, 'omit')
    }
    assert.equal((await f.context.cookies()).MUSIC_U, 'new-session')
    assert.ok([...f.jar.values()].every(cookie => cookie.domain === '.music.163.com'))
    assert.equal(f.prepares(), 1)
    assert.equal(f.commits(), 1)
  } finally { f.login.cancelAll() }
})

test('NetEase intermediate responses keep polling without claiming success from a bare code 200', async() => {
  const f = fixture('netease', [
    qr('netease'),
    response({ code: 200 }),
    state('netease', 802),
    response({ code: 299, message: 'transient service reply' }),
    response({ message: 'missing code' }),
    ...approved('netease'),
  ])
  const start = await f.login.start(1)
  assert.equal((await f.login.check(1, start.flowId)).status, 'waiting')
  assert.equal(f.jar.size, 0)
  assert.equal((await f.login.check(1, start.flowId)).status, 'scanned')
  assert.equal((await f.login.check(1, start.flowId)).status, 'scanned')
  assert.equal((await f.login.check(1, start.flowId)).status, 'scanned')
  assert.equal(f.commits(), 0)
  assert.equal((await f.login.check(1, start.flowId)).status, 'confirmed')
  assert.equal(f.commits(), 1)
})

test('NetEase approval cannot reuse an earlier intermediate response cookie', async() => {
  const f = fixture('netease', [qr('netease'), response({ code: 299 }, ['MUSIC_U=unconfirmed; Domain=.music.163.com; Path=/; Secure']), response({ code: 803 })])
  const start = await f.login.start(1)
  assert.equal((await f.login.check(1, start.flowId)).status, 'waiting')
  await assert.rejects(f.login.check(1, start.flowId), /音乐登录授权/)
  assert.equal(f.prepares(), 0)
  assert.equal(f.commits(), 0)
  assert.equal(f.jar.size, 0)
  f.login.cancelAll()
})

test('NetEase intermediate cookies cannot turn expired QR into a confirmed login', async() => {
  const f = fixture('netease', [qr('netease'), response({ code: 299 }, ['MUSIC_U=unconfirmed; Domain=.music.163.com; Path=/; Secure']), state('netease', 800)])
  const start = await f.login.start(1)
  assert.equal((await f.login.check(1, start.flowId)).status, 'waiting')
  assert.equal((await f.login.check(1, start.flowId)).status, 'expired')
  assert.equal(f.prepares(), 0)
  assert.equal(f.commits(), 0)
  assert.equal(f.jar.size, 0)
  f.login.cancelAll()
})

test('NetEase code 200 with a newly issued MUSIC_U still requires real profile verification', async() => {
  let verified = false
  const f = fixture('netease', [qr('netease'), response({ code: 200 }, ['MUSIC_U=freshly-approved; Domain=.music.163.com; Path=/; Secure'])], { prepare: async context => { assert.equal((await context.cookies()).MUSIC_U, 'freshly-approved'); verified = true } })
  const start = await f.login.start(1)
  assert.equal((await f.login.check(1, start.flowId)).status, 'confirmed')
  assert.equal(verified, true)
  assert.equal(f.prepares(), 1)
  assert.equal(f.commits(), 1)
})

test('NetEase code 200 plus new MUSIC_U restores the old account when profile verification fails', async() => {
  const f = fixture('netease', [qr('netease'), response({ code: 200 }, ['MUSIC_U=unverified; Domain=.music.163.com; Path=/; Secure'])], { original: [{ name: 'MUSIC_U', value: 'old-account', domain: '.music.163.com' }], prepare: async() => { throw new Error('profile verification failed') } })
  const start = await f.login.start(1)
  await assert.rejects(f.login.check(1, start.flowId), /profile verification/)
  assert.equal((await f.context.cookies()).MUSIC_U, 'old-account')
  assert.equal(f.commits(), 0)
  f.login.cancelAll()
})

test('NetEase code 200 cannot reuse the old persistent account or an earlier response credential', async() => {
  const f = fixture('netease', [qr('netease'), response({ code: 299 }, ['MUSIC_U=unconfirmed; Domain=.music.163.com; Path=/; Secure']), response({ code: 200 })], { original: [{ name: 'MUSIC_U', value: 'old-account', domain: '.music.163.com' }] })
  const start = await f.login.start(1)
  assert.equal((await f.login.check(1, start.flowId)).status, 'waiting')
  assert.equal((await f.login.check(1, start.flowId)).status, 'waiting')
  assert.equal(f.prepares(), 0)
  assert.equal(f.commits(), 0)
  assert.equal((await f.context.cookies()).MUSIC_U, 'old-account')
  f.login.cancelAll()
})

test('NetEase bounds unexpected responses, reports only safe status and never logs response contents', async() => {
  const warn = console.warn
  const messages = []
  console.warn = (...args) => { messages.push(args) }
  const f = fixture('netease', [qr('netease'), response({ code: 299, message: 'private-key=do-not-log' }), response({ code: 299 }), response({ message: 'private-cookie=do-not-log' })])
  try {
    const start = await f.login.start(1)
    for (let index = 0; index < 2; index++) assert.equal((await f.login.check(1, start.flowId)).status, 'waiting')
    await assert.rejects(f.login.check(1, start.flowId), /状态异常（missing）/)
    assert.deepEqual(messages, [['LinkLine NetEase QR unexpected status:', '299']])
    assert.equal(f.commits(), 0)
  } finally { console.warn = warn; f.login.cancelAll() }
})

test('NetEase EAPI cookies are accepted from the transport host and normalized for existing music providers', async() => {
  const f = fixture('netease', [response({ code: 200, unikey: 'key' }, ['NMTID=device; Domain=interfacepc.music.163.com; Path=/; Secure']), response({ code: 803 }, ['MUSIC_U=approved; Domain=.interfacepc.music.163.com; Path=/; Secure, __csrf=csrf; Domain=.music.163.com; Path=/; Secure'])], { prepare: async context => { assert.equal((await context.cookies()).MUSIC_U, 'approved') } })
  const start = await f.login.start(1)
  assert.equal((await f.login.check(1, start.flowId)).status, 'confirmed')
  assert.ok([...f.jar.values()].every(cookie => cookie.domain === '.music.163.com' && cookie.path === '/' && cookie.url === 'https://music.163.com/'))
  assert.equal(f.commits(), 1)
})

test('NetEase explicit business failures cannot remain as waiting or commit cookies', async() => {
  const warning = console.warn
  console.warn = () => {}
  try {
    for (const code of [301, 302, 400, 401, 403, 405, 406, 415, 429, 500, 502, 503]) {
      const f = fixture('netease', [qr('netease'), response({ code, message: 'private-token=not-for-display' }, ['MUSIC_U=not-approved; Domain=.music.163.com; Path=/; Secure'])])
      const start = await f.login.start(1)
      await assert.rejects(f.login.check(1, start.flowId), error => error.message === '网易云音乐扫码状态异常（' + code + '），请刷新二维码后重试')
      assert.equal(f.jar.size, 0)
      assert.equal(f.commits(), 0)
      f.login.cancelAll()
    }
  } finally { console.warn = warning }
})

test('Refreshing a NetEase QR rotates its private device and cannot reuse a previous flow NMTID', async() => {
  const f = fixture('netease', [response({ code: 200, unikey: 'one' }, ['NMTID=first-device; Domain=.music.163.com; Path=/; Secure']), qr('netease')])
  const first = await f.login.start(1)
  const second = await f.login.start(1)
  const payloads = f.requests.map(request => encryption.eapiReqDecrypt(new URLSearchParams(request.init.body).get('params')).data)
  assert.notEqual(payloads[0].header.deviceId, payloads[1].header.deviceId)
  assert.equal(payloads[1].header.NMTID, undefined)
  assert.equal(f.login.cancel(1, first.flowId), false)
  assert.equal(f.login.cancel(1, second.flowId), true)
})
