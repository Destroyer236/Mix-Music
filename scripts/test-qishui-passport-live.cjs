// Run with Electron. Uses anonymous in-memory sessions and the official SDK.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')
const { app, BrowserWindow, session } = require('electron')
const ts = require('typescript')

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-passport-live-')))
app.commandLine.appendSwitch('disable-gpu')
app.on('window-all-closed', () => {})
const base = path.resolve(__dirname, '../src/main/modules/platformAccounts')
const modules = new Map()
function readModule(name) {
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

const { createQishuiLogin } = readModule('qishuiLogin')
const { createQishuiPassport } = readModule('qishuiPassport')
const requests = []
app.on('web-contents-created', (_event, contents) => {
  contents.session.webRequest.onBeforeSendHeaders({ urls: ['https://api.qishui.com/passport/*'] }, (details, callback) => {
    const headers = new Headers(details.requestHeaders)
    const url = new URL(details.url)
    const cookies = new Map((headers.get('cookie') ?? '').split(';').map(value => {
      const at = value.indexOf('=')
      return [value.slice(0, at).trim(), value.slice(at + 1)]
    }))
    const csrf = cookies.get('passport_csrf_token') || cookies.get('passport_csrf_token_default')
    requests.push({
      phase: url.pathname.includes('get_qrcode') ? 'get' : 'check',
      signed: Boolean(url.searchParams.get('a_bogus')),
      csrfMatches: Boolean(csrf && headers.get('x-tt-passport-csrf-token') === csrf),
    })
    callback({ requestHeaders: details.requestHeaders })
  })
})

let login
let destination
let phase = 'initialize'
const watchdog = setTimeout(() => { console.error('Anonymous Passport smoke timed out'); app.exit(1) }, 60_000)
app.whenReady().then(async() => {
  destination = session.fromPartition(`linkline-passport-destination-${randomUUID()}`)
  let rawRequests = 0
  const context = {
    session: {
      cookies: destination.cookies,
      getUserAgent: () => destination.getUserAgent(),
      fetch: async() => { rawRequests++; throw new Error('Passport must use the browser SDK') },
    },
    cookies: async() => ({}),
  }
  login = createQishuiLogin(context, async() => { throw new Error('An anonymous test cannot authorize an account') }, createQishuiPassport)
  phase = 'get'
  const qr = await login.start(1)
  assert(qr.image.startsWith('data:image/png;base64,'), 'The real browser flow must generate a QR image')
  phase = 'check'
  const result = await login.check(1, qr.flowId)
  assert(result.status === 'waiting', 'An unscanned real QR must remain waiting')
  assert(requests.length === 2, 'Both requests must reach the real network')
  assert(requests.every(request => request.signed), 'The official SDK must sign both requests')
  assert(requests[1].csrfMatches, 'The real poll must send matching CSRF Cookie and header')
  assert(rawRequests === 0, 'The account session must never send an unsigned Passport request')
  assert((await destination.cookies.get({})).length === 0, 'Anonymous browser cookies must not reach the account session')
  phase = 'cancel'
  login.cancelAll()
  await login.settled()
  assert(BrowserWindow.getAllWindows().length === 0, 'Cancellation must close the private browser')
  console.log(JSON.stringify({ passed: true, requests, rawRequests, accountCookies: 0, privateBrowserClosed: true }))
}).then(() => finish(0), () => { console.error(`Anonymous Passport smoke failed during ${phase}`); return finish(1) })

async function finish(code) {
  clearTimeout(watchdog)
  login?.cancelAll()
  await login?.settled()
  await destination?.clearStorageData()
  app.exit(code)
}
