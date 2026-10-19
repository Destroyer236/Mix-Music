const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../src/main/modules/platformAccounts/qishuiVerification.ts')
const subject = new Module(filename, module)
subject.filename = filename
subject.paths = module.paths
subject._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename)
const { isQishuiVerificationResource, resolveQishuiVerificationUrl, getQishuiVerificationScript, getQishuiVerificationXhrBridgeScript } = subject.exports
const component = 'https://lf-cdn-tos.bytescm.com/obj/static/user-growth/verify.js'
const officialComponentPath = '/ucenter_web/app/second_verification_web/dist/index.umd.production.js'
const officialComponent = `https://auth.zijieapi.com${officialComponentPath}`
const tick = () => new Promise(resolve => setImmediate(resolve))

function fixture(options = {}) {
  const scripts = []
  const calls = []
  const requests = []
  class Element extends EventTarget {
    style = {}
    children = []
    append(...elements) { this.children.push(...elements) }
    replaceChildren(...elements) { this.children = elements }
    remove() {}
  }
  class FakeXHR extends EventTarget {
    responseType = ''
    timeout = 0
    readyState = 0
    open(method, url) { this.nativeUrl = url; this.readyState = 1 }
    setRequestHeader() {}
    send(body) { requests.push({ native: 'xhr', url: this.nativeUrl, body }) }
    abort() { this.readyState = 0 }
  }
  const document = {
    cookie: 'passport_csrf_token=fixture-csrf',
    body: new Element(),
    head: { append(script) { scripts.push(script); queueMicrotask(() => { if (options.scriptError) script.onerror(); else script.onload() }) } },
    createElement: () => new Element(),
  }
  const context = vm.createContext({
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    Event,
    EventTarget,
    DOMException,
    TextEncoder,
    Blob,
    setTimeout,
    clearTimeout,
    location: { origin: 'https://api.qishui.com', href: 'https://api.qishui.com/' },
    document,
    XMLHttpRequest: FakeXHR,
    ucSecondVerifyReact: {},
    ucSecondVerifyReactDom: {},
    ucWebSecondVerify: data => { calls.push(data); if ('result' in options) data.verifyFinishCallback(options.result) },
    fetch: async(url, init) => {
      requests.push({ native: 'fetch', url: String(url), init })
      return options.fetch ? options.fetch(url, init) : new Response('{}')
    },
    __linklineVerificationRequest: async spec => {
      requests.push({ native: 'bridge', ...spec })
      return options.bridge ? options.bridge(spec) : { status: 200, body: '{"ok":true}', headers: 'content-type: application/json\r\nx-fixture: yes', responseURL: spec.url }
    },
  })
  context.window = context
  const run = (decision = { url: component }, params = {}) => vm.runInContext(getQishuiVerificationScript(decision, params), context)
  return { context, document, scripts, calls, requests, run }
}

test('component address normalization accepts official object paths and protocol-relative URLs in an isolated page', () => {
  const isolated = vm.runInNewContext(`(${resolveQishuiVerificationUrl.toString()})`, { URL })
  for (const [source, expected] of [
    [{ host: 'lf-c-flwb.bytetos.com', path: '/fixture/verify.js' }, 'https://lf-c-flwb.bytetos.com/fixture/verify.js'],
    [{ host: 'lf-c-flwb.bytetos.com', path: 'fixture/verify.js' }, 'https://lf-c-flwb.bytetos.com/fixture/verify.js'],
    [{ host: ' lf-c-flwb.bytetos.com ', path: ' fixture/verify.js ' }, 'https://lf-c-flwb.bytetos.com/fixture/verify.js'],
    [{ host: 'lf-c-flwb.bytetos.com', path: '' }, 'https://lf-c-flwb.bytetos.com/'],
    [' //lf-c-flwb.bytetos.com/fixture/verify.js ', 'https://lf-c-flwb.bytetos.com/fixture/verify.js'],
    ['https://lf-c-flwb.bytetos.com/fixture/verify.js', 'https://lf-c-flwb.bytetos.com/fixture/verify.js'],
  ]) {
    assert.equal(resolveQishuiVerificationUrl(source), expected)
    assert.equal(isolated(source), expected, 'The embedded resolver must work without module scope')
  }
})

test('missing or unsupported component address shapes have a fixed empty-address diagnostic', () => {
  for (const source of [undefined, null, '', '  ', false, 42, [], {}, { host: '' }, { host: 42 }, { url: component }]) {
    assert.throws(() => resolveQishuiVerificationUrl(source), /\bQV04_EMPTY\b/)
  }
})

test('component address parsing rejects backslash and host injection before URL normalization', () => {
  for (const source of [
    { host: 'lf-c-flwb.bytetos.com\\outside.example', path: '/fixture/verify.js' },
    { host: 'lf-c-flwb.bytetos.com/outside.example', path: '/fixture/verify.js' },
    { host: 'https://lf-c-flwb.bytetos.com', path: '/fixture/verify.js' },
    { host: 'lf-c-flwb.bytetos.com:444', path: '/fixture/verify.js' },
    { host: 'user@lf-c-flwb.bytetos.com', path: '/fixture/verify.js' },
    { host: 'lf-c-flwb.bytetos.com?outside.example', path: '/fixture/verify.js' },
    { host: 'lf-c-flwb.bytetos.com', path: '//outside.example/verify.js' },
    { host: 'lf-c-flwb.bytetos.com', path: 'fixture\\verify.js' },
    { host: 'lf-c-flwb.bytetos.com', path: '/fixture/ve\nrify.js' },
    'https://lf-c-flwb.bytetos.com\\outside.example/verify.js',
    'https://lf-c-flwb.bytetos.com/fixture/ve\trify.js',
  ]) assert.throws(() => resolveQishuiVerificationUrl(source), /\bQV04_FORMAT\b/)
})

test('generated component script normalizes slashless paths and protocol-relative official resources', async() => {
  for (const source of [
    { host: 'lf-c-flwb.bytetos.com', path: 'fixture/verify.js' },
    { host: ' lf-c-flwb.bytetos.com ', path: ' /fixture/verify.js ' },
    '//lf-c-flwb.bytetos.com/fixture/verify.js',
  ]) {
    const f = fixture()
    delete f.context.ucWebSecondVerify
    f.document.head.append = script => {
      f.scripts.push(script)
      f.context.ucWebSecondVerify = data => { f.calls.push(data); data.verifyFinishCallback({ status: true }) }
      queueMicrotask(() => script.onload())
    }
    assert.equal(await f.run({ url: source }), true)
    const loaded = new URL(f.scripts[0].src)
    assert.equal(loaded.origin, 'https://lf-c-flwb.bytetos.com')
    assert.equal(loaded.pathname, '/fixture/verify.js')
    assert.equal(loaded.searchParams.get('aid'), '386088')
    assert.equal(f.calls.length, 1)
  }
})

test('generated script distinguishes absent, malformed and untrusted addresses without exposing server data', async() => {
  for (const [source, code] of [
    [undefined, 'QV04_EMPTY'],
    [{ host: 'lf-c-flwb.bytetos.com\\outside.example', path: '/fixture/verify.js' }, 'QV04_FORMAT'],
    ['https://lf-c-flwb.bytetos.com\\outside.example/verify.js?ticket=fixture-private-ticket', 'QV04_FORMAT'],
    ['https://outside.example/verify.js?ticket=fixture-private-ticket', 'QV04_HOST'],
  ]) {
    const f = fixture({ result: { status: true } })
    await assert.rejects(f.run({ url: source }), error => {
      assert.match(error.message, new RegExp(`\\b${code}\\b`))
      assert.doesNotMatch(error.message, /outside\.example|fixture-private-ticket|https:|ticket=/)
      return true
    })
    assert.equal(f.calls.length, 0)
    assert.equal(f.scripts.length, 0)
  }
})

test('missing React dependencies are reported as interface initialization rather than address parsing', async() => {
  for (const name of ['ucSecondVerifyReact', 'ucSecondVerifyReactDom']) {
    const f = fixture({ result: { status: true } })
    delete f.context[name]
    await assert.rejects(f.run(), /\bQV02\b/)
    assert.equal(f.calls.length, 0)
    assert.equal(f.scripts.length, 0)
  }
})

test('verification resources allow only HTTPS official assets and authentication routes', () => {
  for (const url of [component, 'https://lf-c-flwb.bytetos.com/obj/verify.js', 'https://lf-headquarters-speed.yhgfb-cn-static.com/obj/verify.js']) assert.equal(isQishuiVerificationResource(url, 'script'), true)
  for (const url of ['https://auth.zijieapi.com/passport/safe/send_code/', 'https://api.qishui.com/passport/safe/pack_verify_ways_data/?aid=386088', 'https://bff-pc.qishui.com/light/invoke/scan_login']) assert.equal(isQishuiVerificationResource(url, 'xhr'), true)
  for (const url of ['http://lf-cdn-tos.bytescm.com/verify.js', 'https://bytescm.com.evil.example/verify.js', 'https://evilbytescm.com/verify.js', 'https://user:secret@lf-cdn-tos.bytescm.com/verify.js', 'https://lf-cdn-tos.bytescm.com:444/verify.js', 'https://qishui.com/passport/safe/', 'https://api.qishui.com/luna/pc/me', 'https://bff-pc.qishui.com/light/invoke/unrelated', 'https://outside.example/passport/safe/']) assert.equal(isQishuiVerificationResource(url, 'xhr'), false, url)
  assert.equal(isQishuiVerificationResource(component, 'mainFrame'), false)
  assert.equal(isQishuiVerificationResource('https://auth.zijieapi.com/passport/safe/verify/', 'subFrame'), true)
  assert.equal(isQishuiVerificationResource('https://api.qishui.com/passport/safe/verify/', 'subFrame'), true)
  assert.equal(isQishuiVerificationResource('https://api.qishui.com/luna/pc/me', 'subFrame'), false)
  assert.equal(isQishuiVerificationResource('https://api.qishui.com/passport/safe/', 'script'), false)
})

test('the official Passport decision component is permitted only at its exact HTTPS script route', () => {
  for (const url of [officialComponent, `${officialComponent}?aid=386088&verify_scene=login`]) assert.equal(isQishuiVerificationResource(url, 'script'), true, url)
  for (const url of [
    'https://auth.zijieapi.com/ucenter_web/app/second_verification_web/dist/index.umd.production.js.map',
    'https://auth.zijieapi.com/ucenter_web/app/second_verification_web/dist/index.umd.development.js',
    'https://auth.zijieapi.com/ucenter_web/app/second_verification_web/dist/index.umd.production.js/nested',
    'https://auth.zijieapi.com/ucenter_web/app/second_verification_web/other.js',
    'https://auth.zijieapi.com/unrelated.js',
    `https://auth.zijieapi.com.evil.example${officialComponentPath}`,
    `https://evilauth.zijieapi.com${officialComponentPath}`,
    `http://auth.zijieapi.com${officialComponentPath}`,
    `https://user:secret@auth.zijieapi.com${officialComponentPath}`,
    `https://auth.zijieapi.com:444${officialComponentPath}`,
    `${officialComponent}#fragment`,
  ]) assert.equal(isQishuiVerificationResource(url, 'script'), false, url)
  for (const resourceType of ['mainFrame', 'stylesheet', 'image', 'font', 'media', 'other']) assert.equal(isQishuiVerificationResource(officialComponent, resourceType), false, resourceType)
})

test('official captcha frame and fixed captcha API paths are available without widening other routes', () => {
  assert.equal(isQishuiVerificationResource('https://rmc.bytedance.com/verifycenter/captcha/v2?aid=386088', 'subFrame'), true)
  assert.equal(isQishuiVerificationResource('https://lf3-cdn-tos.bytegoofy.com/obj/goofy/secsdk/secsdk-lastest.umd.js', 'script'), true)
  assert.equal(isQishuiVerificationResource('https://p9-captcha.byteimg.com/tos-cn-i-188rlo5p4y/challenge.image', 'image'), true)
  for (const path of ['/captcha/get', '/captcha/verify', '/captcha/i18n/', '/feedback/tags', '/feedback/detail', '/passport/safe/pack_verify_ways_data/']) assert.equal(isQishuiVerificationResource(`https://verify.zijieapi.com${path}?aid=386088`, 'xhr'), true)
  for (const [url, type] of [
    ['https://verify.zijieapi.com/unrelated', 'xhr'],
    ['https://verify.zijieapi.com/captcha/get_extra', 'xhr'],
    ['https://verify.zijieapi.com/captcha/get/nested', 'xhr'],
    ['https://verify.zijieapi.com/captcha/get', 'script'],
    ['https://verify.zijieapi.com.evil.example/captcha/get', 'xhr'],
    ['https://rmc.bytedance.com/unrelated', 'subFrame'],
    ['https://rmc.bytedance.com/verifycenter/captcha/v2', 'mainFrame'],
    ['https://rmc.bytedance.com/verifycenter/captcha/v2', 'xhr'],
    ['https://rmc.bytedance.com.evil.example/verifycenter/captcha/v2', 'subFrame'],
  ]) assert.equal(isQishuiVerificationResource(url, type), false, url)
})

test('only strict official callback status true completes verification', async() => {
  for (const value of [true, false, 'true', 1, undefined]) {
    const f = fixture({ result: { status: value, ticket: 'not-returned' } })
    assert.equal(await f.run({ url: { host: 'lf-cdn-tos.bytescm.com', path: '/obj/static/verify.js' }, event_params: '{"verify_reason":"login","verify_scene":"qr"}' }, { language: 'zh' }), value === true)
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].aid, 386088)
    assert.equal(f.calls[0].generalParams.language, 'zh')
    assert.equal(f.calls[0].event_params.verify_reason, 'login')
    assert.equal(f.calls[0].newSecondVerifyWebOptions.host, 'https://api.qishui.com')
    assert.equal(f.context.__linklineCancelQishuiVerification, undefined)
  }
})

test('verify_center expands through the signed same-origin API before invoking the component', async() => {
  const f = fixture({ fetch: async() => new Response(JSON.stringify({ message: 'error', data: { error_code: 2046, url: { host: 'auth.zijieapi.com', path: ` ${officialComponentPath.slice(1)} ` }, event_params: { verify_scene: 'expanded' } } })) })
  delete f.context.ucWebSecondVerify
  f.document.head.append = script => {
    f.scripts.push(script)
    f.context.ucWebSecondVerify = data => { f.calls.push(data); data.verifyFinishCallback({ status: true }) }
    queueMicrotask(() => script.onload())
  }
  assert.equal(await f.run({ verify_from: 'verify_center', verify_portrait_id: 'portrait', biz_params: { ticket: 'private-ticket' }, is_login: true }, { language: 'zh' }), true)
  const request = f.requests[0]
  assert.equal(request.native, 'fetch')
  assert.equal(request.url, 'https://api.qishui.com/passport/safe/pack_verify_ways_data/?aid=386088')
  assert.equal(request.init.credentials, 'include')
  assert.equal(request.init.headers.get('x-tt-passport-csrf-token'), 'fixture-csrf')
  assert.equal(request.init.headers.get('x-tt-passport-verify-portrait'), 'portrait')
  const form = new URLSearchParams(request.init.body)
  assert.equal(form.get('aid'), '386088')
  assert.equal(form.get('language'), 'zh')
  assert.equal(form.has('is_login'), false)
  assert.equal(JSON.parse(form.get('biz_params')).ticket, 'private-ticket')
  assert.equal(f.calls[0].fun, 'verify_center')
  assert.equal(f.calls[0].event_params.verify_scene, 'expanded')
  assert.equal(f.scripts.length, 1, 'The expanded decision must load its component before verification can complete')
  const loaded = new URL(f.scripts[0].src)
  assert.equal(loaded.origin, 'https://auth.zijieapi.com')
  assert.equal(loaded.pathname, officialComponentPath)
  assert.equal(loaded.searchParams.get('aid'), '386088')
  assert.equal(loaded.searchParams.get('verify_scene'), 'expanded')
})

test('a normal expanded 2046 decision renders official verification and still requires its success callback', async() => {
  for (const envelope of [
    { message: 'error', data: { error_code: 2046, url: component, event_params: { verify_scene: 'expanded' } } },
    { error_code: 2046, url: component },
    { error_code: 2046, data: { url: component } },
  ]) {
    const f = fixture({ fetch: async() => Response.json(envelope) })
    const result = f.run({ error_code: 2046, verify_from: 'verify_center', verify_portrait_id: 'private-portrait' })
    let completed = false
    void result.then(() => { completed = true })
    await tick()
    assert.equal(f.calls.length, 1, '2046 is a render decision, so the official component must be invoked')
    assert.equal(f.calls[0].error_code, 2046)
    assert.equal(completed, false, 'Receiving 2046 must never count as successful verification')
    f.calls[0].verifyFinishCallback({ status: true })
    assert.equal(await result, true)
  }
})

test('unexpected decision origins or broken center responses cannot execute a component', async() => {
  for (const url of ['https://outside.example/private?ticket=secret', 'javascript:alert(1)', { host: 'lf-cdn-tos.bytescm.com/evil.example', path: '/verify.js' }, { host: 'lf-cdn-tos.bytescm.com', path: '//evil.example/verify.js' }]) {
    const f = fixture({ result: { status: true } })
    await assert.rejects(f.run({ url }), /汽水音乐安全验证加载失败（QV04(?:_[A-Z]+)?）/)
    assert.equal(f.calls.length, 0)
    assert.equal(f.scripts.length, 0)
  }
  for (const response of [new Response('bad json'), new Response('{}', { status: 403 }), new Response('{"data":{"error_code":2156}}')]) {
    const f = fixture({ result: { status: true }, fetch: async() => response })
    await assert.rejects(f.run({ verify_from: 'verify_center', url: component }), /汽水音乐安全验证加载失败（QV03）/)
    assert.equal(f.calls.length, 0)
  }
})

test('official component loading uses the validated URL and reports failures without server data', async() => {
  const f = fixture({ result: { status: true } })
  delete f.context.ucWebSecondVerify
  f.document.head.append = script => {
    f.scripts.push(script)
    f.context.ucWebSecondVerify = data => { f.calls.push(data); data.verifyFinishCallback({ status: true }) }
    queueMicrotask(() => script.onload())
  }
  assert.equal(await f.run({ url: component, event_params: { verify_reason: 'login', verify_scene: 'desktop' } }), true)
  const url = new URL(f.scripts[0].src)
  assert.equal(url.searchParams.get('aid'), '386088')
  assert.equal(url.searchParams.get('verify_scene'), 'desktop')
  const broken = fixture({ scriptError: true })
  delete broken.context.ucWebSecondVerify
  await assert.rejects(broken.run({ url: component }), /汽水音乐安全验证加载失败/)
})

test('cancellation settles immediately and late official success cannot change it', async() => {
  const f = fixture()
  const pending = f.run()
  await tick()
  assert.equal(f.calls.length, 1)
  f.context.__linklineCancelQishuiVerification()
  assert.equal(await pending, false)
  f.calls[0].verifyFinishCallback({ status: true })
  assert.equal(f.document.body.children[1].textContent, '验证已取消，请返回重新扫码')
})

test('cancellation while loading a center decision prevents late component invocation', async() => {
  let complete
  const f = fixture({ fetch: () => new Promise(resolve => { complete = resolve }) })
  const pending = f.run({ verify_from: 'verify_center', url: component })
  await tick()
  f.context.__linklineCancelQishuiVerification()
  assert.equal(await pending, false)
  complete(new Response(JSON.stringify({ data: { url: component } })))
  await tick()
  assert.equal(f.calls.length, 0)
})

test('same-origin fetch and XHR remain native while cross-origin authentication uses the flow bridge', async() => {
  const f = fixture()
  vm.runInContext(getQishuiVerificationXhrBridgeScript(), f.context)
  await f.context.fetch('https://api.qishui.com/passport/safe/native/')
  const native = new f.context.XMLHttpRequest()
  native.open('POST', 'https://api.qishui.com/passport/safe/native/')
  native.send('a=b')
  const reply = await f.context.fetch('https://auth.zijieapi.com/passport/safe/verify/', { method: 'POST', body: 'verify=1' })
  assert.equal((await reply.json()).ok, true)
  assert.equal(reply.headers.get('x-fixture'), 'yes')
  assert.equal(reply.url, 'https://auth.zijieapi.com/passport/safe/verify/')
  assert.deepEqual(f.requests.map(request => request.native), ['fetch', 'xhr', 'bridge'])
  assert.equal(f.requests[2].body, 'verify=1')
})

test('XHR bridge preserves JSON response type, headers and load event order', async() => {
  const f = fixture()
  vm.runInContext(getQishuiVerificationXhrBridgeScript(), f.context)
  const xhr = new f.context.XMLHttpRequest()
  const events = []
  xhr.responseType = 'json'
  for (const name of ['readystatechange', 'load', 'loadend']) xhr.addEventListener(name, () => events.push(`${name}:${xhr.readyState}`))
  xhr.open('POST', 'https://auth.zijieapi.com/passport/safe/verify/')
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
  xhr.send('verify=1')
  await tick()
  assert.equal(xhr.status, 200)
  assert.equal(xhr.response.ok, true)
  assert.throws(() => xhr.responseText, /Response is not text/)
  assert.equal(xhr.getResponseHeader('X-Fixture'), 'yes')
  assert.equal(f.requests[0].headers['content-type'], 'application/x-www-form-urlencoded')
  assert.deepEqual(events, ['readystatechange:2', 'readystatechange:3', 'readystatechange:4', 'load:4', 'loadend:4'])
})

test('XHR abort suppresses late completion and dispatches abort only once', async() => {
  let complete
  const f = fixture({ bridge: () => new Promise(resolve => { complete = resolve }) })
  vm.runInContext(getQishuiVerificationXhrBridgeScript(), f.context)
  const xhr = new f.context.XMLHttpRequest()
  const events = []
  for (const name of ['abort', 'load', 'loadend']) xhr.addEventListener(name, () => events.push(name))
  xhr.open('POST', 'https://auth.zijieapi.com/passport/safe/verify/')
  xhr.send('verify=1')
  await tick()
  xhr.abort()
  complete({ status: 200, body: '{}', headers: '' })
  await tick()
  assert.deepEqual(events, ['abort', 'loadend'])
  assert.equal(xhr.readyState, 0)
  assert.equal(xhr.status, 0)
})

test('reusing a bridged XHR resets previous response fields before the next request', async() => {
  const f = fixture()
  vm.runInContext(getQishuiVerificationXhrBridgeScript(), f.context)
  const xhr = new f.context.XMLHttpRequest()
  xhr.open('POST', 'https://auth.zijieapi.com/passport/safe/verify/')
  xhr.send('verify=1')
  await tick()
  assert.equal(xhr.status, 200)
  xhr.open('POST', 'https://auth.zijieapi.com/passport/safe/verify/')
  assert.equal(xhr.readyState, 1)
  assert.equal(xhr.status, undefined)
  xhr.send('verify=2')
  await tick()
  assert.equal(xhr.status, 200)
  assert.equal(f.requests.length, 2)
})
