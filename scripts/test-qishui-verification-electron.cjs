// Run with Electron. All HTTPS traffic and verification decisions are fixtures;
// real Chromium, React UMD bundles and the production Passport bridge run intact.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { app, BrowserWindow } = require('electron')
const ts = require('typescript')

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-verification-electron-')))
app.commandLine.appendSwitch('disable-gpu')
app.on('window-all-closed', () => {})
const base = path.resolve(__dirname, '../src/main/modules/platformAccounts')
const modules = new Map()
function readModule(name) {
  if (name === 'qishuiPassport' && process.env.LINKLINE_QISHUI_PASSPORT_TEST_BUNDLE) return require(process.env.LINKLINE_QISHUI_PASSPORT_TEST_BUNDLE)
  if (modules.has(name)) return modules.get(name).exports
  const filename = path.join(base, name + '.ts')
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = module.paths
  const nativeRequire = loaded.require.bind(loaded)
  loaded.require = name => {
    if (name.endsWith('?qishui-verification-source')) {
      const cleanName = name.slice(0, -'?qishui-verification-source'.length)
      return { default: fs.readFileSync(require.resolve(cleanName), 'utf8') }
    }
    if (name === './navigation' || name === './qishuiVerification') return readModule(name.slice(2))
    return nativeRequire(name)
  }
  modules.set(name, loaded)
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename)
  return loaded.exports
}

const requests = []
const privateSessions = new Set()
const landingStatuses = []
const officialComponentPath = '/ucenter_web/app/second_verification_web/dist/index.umd.production.js'
const verificationFixture = `
  (() => {
  const 汽水验证组件 = 'UTF-8';
  window.__fixtureComponentEncoding = 汽水验证组件;
  window.ucWebSecondVerify = options => {
    window.__fixtureOptions = {
      aid: options.aid, fun: options.fun, generalParams: options.generalParams,
      isNewVerifyUI: options.isNewVerifyUI, reactVersion: window.ucSecondVerifyReact.version,
      host: options.newSecondVerifyWebOptions.host,
    };
    const root = document.createElement('div');
    root.id = 'fixture-official-component';
    document.body.append(root);
    const onClick = () => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://auth.zijieapi.com/fixture/second_verify/');
      xhr.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
      xhr.setRequestHeader('x-tt-passport-verify-portrait', 'fixture-portrait');
      xhr.responseType = 'json';
      xhr.onload = () => options.verifyFinishCallback({ status: xhr.status === 200 && xhr.response.passed === true });
      xhr.onerror = () => options.verifyFinishCallback({ status: false });
      xhr.send('fixture=anonymous');
    };
    window.ucSecondVerifyReactDom.render(window.ucSecondVerifyReact.createElement('button', { id: 'fixture-complete-verification', onClick }, 'Fixture official verification'), root);
  };
  })();
`
const verificationFixtureBytes = new TextEncoder().encode(verificationFixture)

app.on('web-contents-created', (_event, contents) => {
  const isolated = contents.session
  if (privateSessions.has(isolated)) return
  privateSessions.add(isolated)
  isolated.protocol.handle('https', async request => {
    const url = new URL(request.url)
    requests.push({ host: url.hostname, path: url.pathname, method: request.method })
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/javascript' }
    if (url.origin === 'https://api.qishui.com' && url.pathname === '/') {
      const status = landingStatuses.length === 0 ? 200 : 404
      landingStatuses.push(status)
      // Custom protocol fixtures bypass webRequest.onHeadersReceived. Keep one
      // legacy document to exercise script.charset; model the production API
      // landing header rewrite explicitly for the later lazy-chunk case.
      const type = status === 200 ? 'text/html; charset=windows-1252' : 'text/html; charset=UTF-8'
      return new Response('<!doctype html><html><head></head><body></body></html>', { status, headers: { 'content-type': type } })
    }
    if (url.hostname === 'bff-pc.qishui.com' && url.pathname === '/fixture/scan_login/redirect') {
      assert.equal(request.method, 'GET')
      await isolated.cookies.set({ url: 'https://bff-pc.qishui.com/', domain: '.qishui.com', path: '/', name: 'sessionid', value: 'synthetic-fixture-only', secure: true, httpOnly: true })
      return new Response(null, { status: 302, headers: { location: 'https://api.qishui.com/' } })
    }
    if (url.hostname === 'lf-headquarters-speed.yhgfb-cn-static.com') return new Response('window._SdkGlueInit = () => { window.bdms = {}; };', { headers })
    if (url.hostname === 'lf-c-flwb.bytetos.com' && url.pathname === '/fixture/official-verify.js') return new Response(verificationFixtureBytes, { headers })
    if (url.hostname === 'auth.zijieapi.com' && url.pathname === officialComponentPath) {
      assert.equal(request.method, 'GET')
      assert.equal(url.searchParams.get('aid'), '386088')
      assert.equal(url.searchParams.get('verify_scene'), 'expanded-anonymous')
      return new Response(verificationFixtureBytes, { headers })
    }
    if (url.origin === 'https://api.qishui.com' && url.pathname === '/passport/safe/pack_verify_ways_data/') {
      assert.equal(request.method, 'POST')
      assert.equal(request.headers.get('x-tt-passport-verify-portrait'), 'fixture-portrait')
      const body = new URLSearchParams(await request.text())
      assert.equal(body.get('aid'), '386088')
      assert.equal(body.get('device_platform'), 'PC')
      assert.equal(body.get('verify_from'), 'verify_center')
      assert.equal(body.has('is_login'), false)
      if (body.get('fixture_mode') === 'reject') return Response.json({ message: 'error', data: { error_code: 2156, description: 'fixture-private-ticket-must-not-be-displayed' } })
      // 2046 is the usable challenge decision returned by Passport here.
      return Response.json({ message: 'error', data: { error_code: 2046, url: { host: 'auth.zijieapi.com', path: ` ${officialComponentPath.slice(1)} ` }, event_params: '{"verify_scene":"expanded-anonymous"}' } })
    }
    if (url.hostname === 'auth.zijieapi.com' && url.pathname === '/fixture/second_verify/') {
      assert.equal(request.method, 'POST')
      assert.equal(request.headers.get('content-type'), 'application/x-www-form-urlencoded')
      assert.equal(request.headers.get('x-tt-passport-verify-portrait'), 'fixture-portrait')
      assert.equal(await request.text(), 'fixture=anonymous')
      return Response.json({ passed: true })
    }
    throw new Error(`Unexpected fixture request: ${url.origin}${url.pathname}`)
  })
})

const pause = () => new Promise(resolve => setTimeout(resolve, 20))
async function waitFor(check) {
  const deadline = Date.now() + 5000
  while (!await check()) {
    assert(Date.now() < deadline, 'Timed out waiting for fixture verification UI')
    await pause()
  }
}

let passport
let phase = 'initialize'
const watchdog = setTimeout(() => { console.error(`Verification Electron test timed out during ${phase}`); app.exit(1) }, 20000)
app.whenReady().then(async() => {
  const owner = new AbortController()
  passport = await readModule('qishuiPassport').createQishuiPassport('LinkLine fixture Chromium', owner.signal)
  const [window] = BrowserWindow.getAllWindows()
  assert(window, 'Production Passport must create a real BrowserWindow')
  assert.equal(window.isVisible(), false, 'QR transport starts hidden')
  assert.equal(await window.webContents.executeJavaScript('typeof require'), 'undefined')
  assert.equal(await window.webContents.executeJavaScript('document.characterSet.toLowerCase()'), 'windows-1252', 'The explicit legacy document must exercise script.charset independently of the API header rewrite')
  const privateSession = window.webContents.session
  await privateSession.cookies.set({ url: 'https://api.qishui.com/', name: 'fixture_flow', value: 'anonymous', secure: true })
  const decision = { url: { host: 'lf-c-flwb.bytetos.com', path: '/fixture/official-verify.js' }, verify_from: 'verify', verify_portrait_id: 'fixture-portrait', event_params: '{"verify_reason":"fixture","verify_scene":"anonymous"}' }
  const generalParams = { device_platform: 'PC', fixture: 'anonymous' }

  phase = 'callback bridge'
  const passed = passport.verify({ ...decision, url: undefined, verify_from: 'verify_center', is_login: true }, generalParams)
  let verificationError
  passed.catch(error => { verificationError = error })
  await waitFor(() => {
    if (verificationError) throw verificationError
    return window.webContents.executeJavaScript('Boolean(document.querySelector("#fixture-complete-verification"))')
  })
  await waitFor(() => window.isVisible())
  assert.equal(window.isVisible(), true, 'Security verification must show the private window')
  assert.equal(await window.webContents.executeJavaScript('window.__fixtureComponentEncoding'), 'UTF-8', 'An official script without a charset header must execute its Chinese identifiers in the legacy-encoded API document')
  assert.deepEqual(requests.filter(request => request.host === 'auth.zijieapi.com' && request.path === officialComponentPath), [
    { host: 'auth.zijieapi.com', path: officialComponentPath, method: 'GET' },
  ], 'The same component route returned by the official Passport API must load and render in the visible window')
  assert.deepEqual(await window.webContents.executeJavaScript('window.__fixtureOptions'), {
    aid: 386088, fun: 'verify_center', generalParams, isNewVerifyUI: true, reactVersion: '17.0.2', host: 'https://api.qishui.com',
  })
  await window.webContents.executeJavaScript('document.querySelector("#fixture-complete-verification").click()')
  assert.equal(await passed, true, 'The real XHR/CDP/session bridge must return the official component success callback')
  assert.equal(window.isVisible(), false, 'Completed verification hides the window')
  assert.equal(requests.filter(request => request.path === '/fixture/second_verify/').length, 1)
  assert.equal(requests.filter(request => request.path === '/passport/safe/pack_verify_ways_data/').length, 1, 'The usable 2046 center decision must render the official verification component')

  phase = 'protocol-relative verification component'
  const beforeProtocolRelative = requests.filter(request => request.path === '/fixture/official-verify.js').length
  await window.webContents.executeJavaScript('delete window.ucWebSecondVerify; void 0')
  const protocolRelative = passport.verify({ ...decision, url: '//lf-c-flwb.bytetos.com/fixture/official-verify.js' }, generalParams)
  protocolRelative.catch(error => { verificationError = error })
  await waitFor(() => {
    if (verificationError) throw verificationError
    return requests.filter(request => request.path === '/fixture/official-verify.js').length > beforeProtocolRelative && window.webContents.executeJavaScript('Boolean(document.querySelector("#fixture-complete-verification"))')
  })
  assert.equal(window.isVisible(), true, 'A protocol-relative official component URL must render in the visible window')
  assert.equal(requests.filter(request => request.path === '/fixture/official-verify.js').length, beforeProtocolRelative + 1, 'Protocol-relative URLs must load the actual component after clearing the previous export')
  await window.webContents.executeJavaScript('document.querySelector("#fixture-complete-verification").click()')
  assert.equal(await protocolRelative, true)
  assert.equal(window.isVisible(), false)
  assert.equal(requests.filter(request => request.path === '/fixture/second_verify/').length, 2)

  phase = 'safe verification failure stages'
  async function assertVisibleFailure(pending, code, privateData, nativeClose = false) {
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    const rejected = assert.rejects(pending, error => {
      assert(error.message.includes(code), 'A real Electron page rejection must preserve its fixed failure marker')
      assert.doesNotMatch(error.message, privateData, 'Private decision fields must never leave the isolated page')
      return true
    })
    await waitFor(() => window.webContents.executeJavaScript(`document.querySelector('#linkline-qishui-verification-status')?.textContent.includes(${JSON.stringify(code)}) === true`))
    assert.equal(window.isVisible(), true, 'A failed challenge must remain visible with its explanation')
    assert.equal(settled, false, 'Failure must remain pending until the user closes its explanation')
    assert.equal((await privateSession.cookies.get({ name: 'sessionid' })).length, 0, 'A failed challenge must not create an authorized session')
    if (nativeClose) window.close()
    else await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '关闭验证').click()`)
    await rejected
    assert.equal(window.isVisible(), false, 'Closing the failure explanation must hide the verification window')
    assert.equal(window.isDestroyed(), false, 'Closing a failed challenge preserves the QR transport until flow cancellation')
  }
  await assertVisibleFailure(passport.verify({ ...decision, verify_from: 'verify_center', fixture_mode: 'reject' }, generalParams), 'QV03', /2156|fixture-private-ticket|description|error_code/)
  const beforeInvalidSource = requests.length
  await assertVisibleFailure(passport.verify({ ...decision, url: 'https://outside.example/verify.js?ticket=fixture-private-ticket-must-not-be-displayed' }, generalParams), 'QV04_HOST', /outside\.example|fixture-private-ticket|https:|ticket=/, true)
  assert.equal(requests.length, beforeInvalidSource, 'An invalid verification source must be rejected without a network request')

  phase = 'authorization cookie harvest'
  const beforeHarvest = requests.length
  const harvested = await passport.cookies('https://bff-pc.qishui.com/fixture/scan_login/redirect?token=anonymous')
  assert(harvested.some(cookie => cookie.name === 'sessionid' && cookie.value === 'synthetic-fixture-only' && cookie.domain === '.qishui.com'), 'The trusted authorization redirect must return isolated authentication cookies')
  assert.deepEqual(requests.slice(beforeHarvest), [
    { host: 'bff-pc.qishui.com', path: '/fixture/scan_login/redirect', method: 'GET' },
    { host: 'api.qishui.com', path: '/', method: 'GET' },
  ], 'Cookie harvesting follows the official redirect without polling QR endpoints')
  assert.deepEqual(landingStatuses, [200, 404], 'A final API landing-page 404 must not discard authorization cookies')
  const beforeUntrusted = requests.length
  await assert.rejects(passport.cookies('https://untrusted.example/scan_login/redirect'), /授权跳转地址无效/)
  await assert.rejects(passport.cookies('https://api.qishui.com.untrusted.example/scan_login/redirect'), /授权跳转地址无效/)
  assert.equal(requests.length, beforeUntrusted, 'Untrusted redirects must fail before any network request')

  phase = 'window close'
  const closed = passport.verify(decision, generalParams)
  await waitFor(() => window.isVisible())
  window.close()
  assert.equal(await closed, false, 'Closing verification must cancel the pending callback')
  assert.equal(window.isDestroyed(), false, 'Closing verification preserves the isolated QR transport until flow cancellation')
  assert.equal(window.isVisible(), false)

  phase = 'cancel button'
  const cancelled = passport.verify(decision, generalParams)
  await waitFor(() => window.webContents.executeJavaScript('Boolean(window.__linklineCancelQishuiVerification)'))
  await window.webContents.executeJavaScript('document.querySelector("button").click()')
  assert.equal(await cancelled, false, 'The page cancel button must resolve verification without authorization')
  assert.equal(window.isVisible(), false)

  phase = 'owner cancellation'
  const aborted = passport.verify(decision, generalParams)
  await waitFor(() => window.isVisible())
  owner.abort()
  assert.equal(await aborted, false, 'Cancelling the login flow must resolve in-flight verification')
  await passport.destroy()
  assert.equal(BrowserWindow.getAllWindows().length, 0)
  assert.equal((await privateSession.cookies.get({})).length, 0, 'Cancellation must clear every anonymous flow cookie')

  phase = 'owner cancellation during retained failure'
  const failureOwner = new AbortController()
  passport = await readModule('qishuiPassport').createQishuiPassport('LinkLine retained-failure fixture Chromium', failureOwner.signal)
  const [failureWindow] = BrowserWindow.getAllWindows()
  assert(failureWindow, 'The retained-failure regression must use a fresh isolated BrowserWindow')
  assert.equal(await failureWindow.webContents.executeJavaScript('document.characterSet.toLowerCase()'), 'utf-8', 'The API 404 fixture must model the production UTF-8 document header rewrite')
  const defaultEncoding = passport.verify(decision, generalParams)
  defaultEncoding.catch(() => {})
  await waitFor(() => failureWindow.webContents.executeJavaScript('Boolean(document.querySelector("#fixture-complete-verification"))'))
  const chunkEncoding = await failureWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    window.__fixtureComponentEncoding = null;
    const script = document.createElement('script');
    script.src = 'https://lf-c-flwb.bytetos.com/fixture/official-verify.js?fixture=lazy-no-charset';
    script.onload = () => resolve(window.__fixtureComponentEncoding);
    script.onerror = () => reject(new Error('Fixture lazy chunk failed'));
    document.head.appendChild(script);
  })`)
  assert.equal(chunkEncoding, 'UTF-8', 'A lazy chunk without its own charset must decode Chinese identifiers using the corrected document encoding')
  await failureWindow.webContents.executeJavaScript('window.__linklineCancelQishuiVerification()')
  assert.equal(await defaultEncoding, false)
  const failureSession = failureWindow.webContents.session
  await failureSession.cookies.set({ url: 'https://api.qishui.com/', name: 'fixture_failed_flow', value: 'anonymous', secure: true })
  const retainedFailure = passport.verify({ ...decision, url: 'https://outside.example/verify.js?ticket=fixture-private-ticket-must-not-be-displayed' }, generalParams)
  let failureSettled = false
  void retainedFailure.then(() => { failureSettled = true }, () => { failureSettled = true })
  const failureRejected = assert.rejects(retainedFailure, error => {
    assert.match(error.message, /\bQV04_HOST\b/, 'Owner cancellation must release the retained failure with its safe stage')
    assert.doesNotMatch(error.message, /outside\.example|fixture-private-ticket|https:|ticket=/)
    return true
  })
  await waitFor(() => failureWindow.webContents.executeJavaScript(`document.querySelector('#linkline-qishui-verification-status')?.textContent.includes('QV04_HOST') === true`))
  assert.equal(failureWindow.isVisible(), true)
  assert.equal(failureSettled, false, 'A visible failure must still be waiting when its owning login flow is cancelled')
  assert.equal((await failureSession.cookies.get({ name: 'sessionid' })).length, 0)
  failureOwner.abort()
  await failureRejected
  await passport.destroy()
  assert.equal(failureWindow.isDestroyed(), true, 'Owner cancellation during a retained failure must destroy its private browser')
  assert.equal(BrowserWindow.getAllWindows().length, 0)
  assert.equal((await failureSession.cookies.get({})).length, 0, 'Owner cancellation during a retained failure must clear all flow cookies')
  console.log(JSON.stringify({ passed: true, realReact: '17.0.2', expandedChallenge2046: true, officialAuthComponentRoute: true, utf8ScriptInLegacyDocument: true, utf8LazyChunkInCorrectedDocument: true, slashlessComponentPath: true, protocolRelativeComponent: true, safeFailureStages: ['QV03', 'QV04_HOST'], visiblePendingFailure: true, failedChallengeUnauthorized: true, failedWindowClose: true, retainedFailureOwnerCancellation: true, bridgeRequests: 2, visibleVerification: true, trustedRedirectCookieHarvest: true, finalLanding404: true, untrustedRedirectRejected: true, windowClose: true, cancelButton: true, ownerCancellation: true, privateBrowserClosed: true, privateCookiesCleared: true, network: 'fixtures only' }))
}).then(() => finish(0), error => { console.error(`Verification Electron test failed during ${phase}:`, error); return finish(1) })

async function finish(code) {
  clearTimeout(watchdog)
  await passport?.destroy()
  for (const isolated of privateSessions) isolated.protocol.unhandle('https')
  app.exit(code)
}
