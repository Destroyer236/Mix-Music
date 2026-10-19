import { BrowserWindow, session, webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { registerAccountSession } from './navigation'
import reactSource from 'react/umd/react.production.min.js?qishui-verification-source'
import reactDomSource from 'react-dom/umd/react-dom.production.min.js?qishui-verification-source'
import { getQishuiVerificationScript, getQishuiVerificationXhrBridgeScript, isQishuiVerificationResource } from './qishuiVerification'

export interface QishuiPassportClient {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  verify?: (decision: Record<string, unknown>, generalParams: Record<string, string>) => Promise<boolean>
  cookies?: (redirect?: string) => Promise<Electron.Cookie[]>
  destroy: () => Promise<void>
}
export type QishuiPassportFactory = (userAgent: string, signal: AbortSignal, owner?: number) => Promise<QishuiPassportClient>

const API = 'https://api.qishui.com'
const SDK_PATH = '/obj/rc-client-security/web/glue/1.0.0.36/sdk-glue.js'
const SDK_URL = `https://lf-headquarters-speed.yhgfb-cn-static.com${SDK_PATH}`
const TIMEOUT = 20_000
const MAX_RESPONSE = 600_000
const routes = new Map([['/passport/web/get_qrcode/', 'GET'], ['/passport/web/check_qrconnect/', 'POST']])
const scriptHosts = new Set(['lf-headquarters-speed.yhgfb-cn-static.com', 'lf-c-flwb.bytetos.com'])
const requestHeaders = new Set(['accept', 'content-type', 'x-tt-passport-csrf-token', 'x-tt-passport-trace-id', 'x-tt-passport-verify-portrait', 'x-ss-stub'])
const unavailable = () => new Error('汽水音乐登录安全组件不可用，请刷新二维码后重试')
const aborted = () => new Error('汽水音乐登录请求已取消')
const verificationFailed = (phase: string) => new Error(`汽水音乐官方安全验证加载失败（${phase}），请重新扫码`)
interface Pending {
  key: string
  path: string
  method: string
  requestId?: number
  unsigned?: boolean
  response?: { status: number, headers: Record<string, string[]> }
}

// The official BDMS hook signs requests in Chromium's main world. A separate
// in-memory session contains every late response and never inherits an account.
export const createQishuiPassport: QishuiPassportFactory = async(userAgent, ownerSignal, owner) => {
  if (ownerSignal.aborted) throw aborted()
  if (!userAgent || userAgent.length > 8192 || /[\r\n]/.test(userAgent)) throw unavailable()
  const privateSession = session.fromPartition(`linkline-qishui-passport-${randomUUID()}`, { cache: false })
  privateSession.setUserAgent(userAgent)
  privateSession.setPermissionRequestHandler((_contents, _permission, allow) => { allow(false) })
  privateSession.setPermissionCheckHandler(() => false)
  registerAccountSession(privateSession, ['api.qishui.com', 'auth.zijieapi.com', 'bff-pc.qishui.com', 'verify.zijieapi.com', 'rmc.bytedance.com', 'bytescm.com', 'bytetos.com', 'byteimg.com', 'bytegoofy.com', 'pstatp.com', 'douyinpic.com', 'douyincdn.com', 'douyinstatic.com', 'yhgfb-cn-static.com', 'ibytedtos.com', 'ttwstatic.com', 'bytecdntp.com', 'bytednsdoc.com'])
  const lifetime = new AbortController()
  let window: BrowserWindow | undefined
  let closed = false
  let cleanup: Promise<void> | undefined
  let pending: Pending | undefined
  let verifying = false
  let verification: Promise<boolean> | undefined
  let cancelVerification: (() => void) | undefined
  let harvesting: URL | undefined
  const bridge = { ready: false }
  let queue = Promise.resolve()
  const denyDownload = (event: Electron.Event) => { event.preventDefault() }
  privateSession.on('will-download', denyDownload)

  const destroy = async() => {
    if (cleanup) return cleanup
    closed = true
    lifetime.abort()
    cancelVerification?.()
    ownerSignal.removeEventListener('abort', ownerAborted)
    // Assign before destroying the window: its synchronous closed event may
    // re-enter destroy(), which must share this same cleanup operation.
    cleanup = Promise.resolve().then(async() => {
      if (window && !window.isDestroyed()) window.destroy()
      pending = undefined
      privateSession.webRequest.onBeforeRequest(null)
      privateSession.webRequest.onHeadersReceived(null)
      privateSession.removeListener('will-download', denyDownload)
      await privateSession.closeAllConnections().catch(() => {})
      await Promise.allSettled([privateSession.clearStorageData(), privateSession.clearCache()])
    })
    return cleanup
  }
  const ownerAborted = () => { void destroy() }
  ownerSignal.addEventListener('abort', ownerAborted, { once: true })
  const ensureOpen = () => {
    if (closed || ownerSignal.aborted || !window || window.isDestroyed()) throw unavailable()
  }
  const execute = async<T>(code: string): Promise<T> => {
    ensureOpen()
    return window!.webContents.executeJavaScript(code) as Promise<T>
  }
  const abortPageRequest = (key: string) => {
    if (!window || window.isDestroyed()) return
    void window.webContents.executeJavaScript(`window.__linklinePassportRequests?.get(${JSON.stringify(key)})?.abort()`).catch(() => {})
  }
  const limited = async<T>(operation: Promise<T>, signal?: AbortSignal | null, onStop?: () => void): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stop: (() => void) | undefined
    const signals = [lifetime.signal, ...(signal ? [signal] : [])]
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        stop = () => { onStop?.(); reject(aborted()) }
        for (const candidate of signals) {
          if (candidate.aborted) { stop(); return }
          candidate.addEventListener('abort', stop, { once: true })
        }
        timer = setTimeout(() => { onStop?.(); reject(new Error('汽水音乐登录请求超时，请检查网络后重试')) }, TIMEOUT)
      })
      return await Promise.race([operation, cancelled])
    } finally {
      clearTimeout(timer)
      if (stop) for (const candidate of signals) candidate.removeEventListener('abort', stop)
    }
  }

  privateSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    let allowed = false
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port) {
        if (url.origin === API) {
          allowed = details.resourceType === 'mainFrame' && url.pathname === '/' && details.method === 'GET'
          if (pending && details.webContentsId === window?.webContents.id && details.resourceType === 'xhr' && routes.get(url.pathname) === details.method && pending.path === url.pathname && pending.method === details.method && (pending.requestId == null || pending.requestId === details.id)) {
            if (!url.searchParams.get('a_bogus')) pending.unsigned = true
            else { pending.requestId = details.id; allowed = true }
          }
        } else if (scriptHosts.has(url.hostname)) {
          allowed = details.resourceType === 'script' && details.method === 'GET' && ((url.hostname === 'lf-headquarters-speed.yhgfb-cn-static.com' && url.pathname === SDK_PATH) || url.pathname === '/obj/rc-client-security/web/stable/1.0.0.41/bdms.js')
        } else if (url.hostname === 'mon.zijieapi.com') {
          allowed = details.method === 'POST' && url.pathname === '/monitor_browser/collect/batch/'
        }
        // The official verification component has its own authentication APIs,
        // static assets and frames. QR requests still require the signed path.
        if (!routes.has(url.pathname) && (verifying || harvesting) && ['GET', 'POST', 'OPTIONS'].includes(details.method) && isQishuiVerificationResource(url.toString(), details.resourceType === 'other' ? 'xhr' : details.resourceType)) allowed = true
        if (harvesting && ['api.qishui.com', 'bff-pc.qishui.com'].includes(url.hostname) && details.method === 'GET' && ['xhr', 'other'].includes(details.resourceType)) allowed = true
      }
    } catch {}
    callback({ cancel: closed || !allowed })
  })
  privateSession.webRequest.onHeadersReceived({ urls: [`${API}/`, `${API}/passport/*`] }, (details, callback) => {
    if (pending?.requestId === details.id) pending.response = { status: details.statusCode, headers: details.responseHeaders ?? {} }
    let headers = { ...details.responseHeaders }
    if (details.resourceType === 'mainFrame' && details.method === 'GET' && details.url === `${API}/`) {
      // This private API landing has no charset. Official scripts and their
      // lazy chunks inherit it, including unquoted Chinese identifiers.
      headers = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'content-type'))
      headers['Content-Type'] = ['text/html; charset=utf-8']
    }
    callback({ responseHeaders: headers })
  })

  try {
    const ownerContents = owner == null ? undefined : webContents.fromId(owner)
    const parent = ownerContents ? BrowserWindow.fromWebContents(ownerContents) ?? undefined : undefined
    window = new BrowserWindow({ show: false, parent, title: '汽水音乐 · 官方安全验证', width: 520, height: 680, minWidth: 420, minHeight: 520, autoHideMenuBar: true, webPreferences: { session: privateSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const preventNavigation = (event: Electron.Event) => { event.preventDefault() }
    window.webContents.on('will-navigate', preventNavigation)
    window.webContents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
      if (!isMainFrame && verifying && isQishuiVerificationResource(url, 'subFrame')) return
      event.preventDefault()
    })
    window.on('close', (event) => {
      if (!verifying || closed) return
      event.preventDefault()
      cancelVerification?.()
      void execute('window.__linklineCancelQishuiVerification?.()').catch(() => {})
      window?.hide()
    })
    window.webContents.once('render-process-gone', () => { void destroy() })
    window.once('closed', () => { void destroy() })
    const initialize = (async() => {
      // A natural HTTP 404 still supplies the API's same-origin document. An
      // opaque Chromium error page is rejected instead of weakening security.
      try { await window.loadURL(`${API}/`) } catch {}
      // The API origin may return a 404 document; keep its HTTP title from
      // replacing the verification window title used by the app.
      window.setTitle('汽水音乐 · 官方安全验证')
      const sameOrigin = await execute<boolean>(`location.origin === ${JSON.stringify(API)} && Boolean(document.documentElement) && typeof require === 'undefined'`)
      if (!sameOrigin) throw unavailable()
      const ready = await execute<boolean>(`(async() => {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = ${JSON.stringify(SDK_URL)};
          script.onload = resolve;
          script.onerror = () => reject(new Error('SDK unavailable'));
          document.head.append(script);
        });
        if (typeof window._SdkGlueInit !== 'function') return false;
        window._SdkGlueInit({ self: { aid: 386088, pageId: 24554 }, bdms: { aid: 386088, paths: ['/passport'] } });
        return new Promise(resolve => {
          const timer = setTimeout(() => { clearInterval(poll); resolve(false); }, 19000);
          const poll = setInterval(() => {
            if (window.bdms && !window._SdkGlueLoadingMap?.bdms) { clearInterval(poll); clearTimeout(timer); resolve(true); }
          }, 25);
        });
      })()`)
      if (!ready) throw unavailable()
    })()
    await limited(initialize)
  } catch {
    await destroy()
    throw ownerSignal.aborted ? aborted() : new Error('汽水音乐登录安全组件初始化失败，请检查网络后刷新二维码')
  }

  const prepareVerification = async() => {
    if (bridge.ready) return
    ensureOpen()
    // A narrow browser binding relays cross-origin authentication requests with
    // this flow's cookie jar. No Node API or account data reaches the page.
    const debuggerApi = window.webContents.debugger
    debuggerApi.attach('1.3')
    await debuggerApi.sendCommand('Runtime.enable')
    await debuggerApi.sendCommand('Runtime.addBinding', { name: '__linklineVerificationBridge' })
    debuggerApi.on('message', (_event, method, params) => {
      if (method !== 'Runtime.bindingCalled' || params.name !== '__linklineVerificationBridge' || !verifying || closed) return
      void (async() => {
        let id: string | undefined
        let result: unknown
        try {
          if (typeof params.payload !== 'string' || params.payload.length > MAX_RESPONSE) return
          const payload = JSON.parse(params.payload)
          id = typeof payload.id === 'string' && /^[a-f\d-]{1,80}$/i.test(payload.id) ? payload.id : undefined
          if (!id) return
          const spec = payload.request
          const url = new URL(String(spec?.url ?? ''))
          const verb = String(spec?.method ?? 'GET').toUpperCase()
          if (!['auth.zijieapi.com', 'bff-pc.qishui.com'].includes(url.hostname) || !isQishuiVerificationResource(url.toString(), 'xhr') || !['GET', 'POST'].includes(verb)) throw unavailable()
          const headers = new Headers()
          for (const [name, value] of new Headers(spec.headers)) {
            if (requestHeaders.has(name.toLowerCase()) || /^x-(?:tt-passport-|ss-|bdturing-)/i.test(name)) headers.set(name, value)
          }
          if (spec.body != null && (typeof spec.body !== 'string' || spec.body.length > MAX_RESPONSE)) throw unavailable()
          const response = await privateSession.fetch(url.toString(), { method: verb, headers, body: verb === 'GET' ? undefined : spec.body, credentials: 'include', redirect: 'error', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(TIMEOUT)]) })
          const body = await response.text()
          if (body.length > MAX_RESPONSE) throw unavailable()
          result = { status: response.status, body, responseURL: response.url, headers: [...response.headers].filter(([name]) => name.toLowerCase() !== 'set-cookie').map(([name, value]) => `${name}: ${value}`).join('\r\n') }
        } catch { result = { status: 0, body: '', headers: '', responseURL: '' } }
        if (!id || closed || !verifying) return
        await execute(`window.__linklineVerificationReplies?.get(${JSON.stringify(id)})?.(${JSON.stringify(result)})`).catch(() => {})
      })()
    })
    await execute(`${reactSource}\n${reactDomSource}\nwindow.ucSecondVerifyReact = window.React; window.ucSecondVerifyReactDom = window.ReactDOM;
      if (!window.ucSecondVerifyReact || !window.ucSecondVerifyReactDom) throw new Error('React unavailable');
      window.__linklineVerificationReplies = new Map();
      window.__linklineVerificationRequest = request => new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => { window.__linklineVerificationReplies.delete(id); reject(new Error('验证连接超时，请重试')); }, 20000);
        window.__linklineVerificationReplies.set(id, result => { clearTimeout(timer); window.__linklineVerificationReplies.delete(id); resolve(result); });
        window.__linklineVerificationBridge(JSON.stringify({ id, request }));
      });
      ${getQishuiVerificationXhrBridgeScript()}`).catch(() => { throw verificationFailed('QV02') })
    bridge.ready = true
  }

  return {
    async verify(decision, generalParams) {
      ensureOpen()
      if (verification) return verification
      verifying = true
      const operation = (async() => {
        let stop: (() => void) | undefined
        let cancelled: Promise<boolean> | undefined
        let phase = 'QV01'
        try {
          await prepareVerification()
          phase = 'QV06'
          ensureOpen()
          cancelled = new Promise<boolean>(resolve => {
            stop = () => { resolve(false) }
            cancelVerification = stop
            lifetime.signal.addEventListener('abort', stop, { once: true })
            if (lifetime.signal.aborted) stop()
          })
          window.show()
          window.focus()
          return await Promise.race([execute<boolean>(getQishuiVerificationScript(decision, generalParams)), cancelled])
        } catch (error) {
          // Copy only a fixed stage marker; Chromium errors may contain a
          // decision URL or account data that must never leave this flow.
          const marker = error instanceof Error ? /\bQV(?:0[1-7]|04_(?:EMPTY|FORMAT|HOST))\b/.exec(error.message)?.[0] : undefined
          const failure = verificationFailed(marker ?? phase)
          if (cancelled && !closed && !ownerSignal.aborted && window && !window.isDestroyed()) {
            // Leave loading failures readable until the user closes the window.
            // Flow cancellation still wins immediately and clears the session.
            await Promise.race([execute(`new Promise(resolve => {
              const status = document.getElementById('linkline-qishui-verification-status') || document.body.appendChild(document.createElement('p'));
              status.textContent = ${JSON.stringify(failure.message)};
              const button = document.querySelector('button') || document.body.appendChild(document.createElement('button'));
              button.textContent = '关闭验证';
              button.disabled = false;
              const close = () => {
                button.onclick = null;
                if (window.__linklineCancelQishuiVerification === close) delete window.__linklineCancelQishuiVerification;
                resolve();
              };
              window.__linklineCancelQishuiVerification = close;
              button.onclick = close;
            })`), cancelled]).catch(() => {})
          }
          throw failure
        } finally {
          if (stop) lifetime.signal.removeEventListener('abort', stop)
          cancelVerification = undefined
          verifying = false
          if (window && !window.isDestroyed()) {
            void execute('window.__linklineCancelQishuiVerification?.()').catch(() => {})
            window.hide()
          }
          verification = undefined
        }
      })()
      verification = operation
      return operation
    },
    async cookies(redirect) {
      ensureOpen()
      if (redirect) {
        let url: URL
        try { url = new URL(redirect) } catch { throw new Error('汽水音乐登录授权跳转地址无效') }
        if (url.protocol !== 'https:' || !['api.qishui.com', 'bff-pc.qishui.com'].includes(url.hostname) || url.username || url.password || url.port || url.hash) throw new Error('汽水音乐登录授权跳转地址无效')
        harvesting = url
        try {
          const response = await limited(privateSession.fetch(url.toString(), { method: 'GET', credentials: 'include', redirect: 'follow', signal: lifetime.signal }))
          // The landing document may be a 404 after setting the authorization
          // cookies. The controller validates those cookies and the profile.
          await response.body?.cancel()
        } catch { throw new Error('汽水音乐登录授权跳转失败，请重新扫码') } finally { harvesting = undefined }
      }
      ensureOpen()
      const cookies = await privateSession.cookies.get({})
      ensureOpen()
      return cookies.filter(cookie => ['qishui.com', 'api.qishui.com', 'bff-pc.qishui.com'].includes((cookie.domain ?? '').replace(/^\./, '')) && (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000))
    },
    async fetch(input, init) {
      ensureOpen()
      const url = new URL(input)
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.origin !== API || url.username || url.password || url.port || url.hash || routes.get(url.pathname) !== method || (init.body != null && typeof init.body !== 'string')) throw unavailable()
      const headers: Array<[string, string]> = []
      for (const [name, value] of new Headers(init.headers)) if (requestHeaders.has(name.toLowerCase())) headers.push([name, value])
      const active: Pending = { key: randomUUID(), path: url.pathname, method }
      let stopped = false
      const isStopped = () => stopped || Boolean(init.signal?.aborted)
      const operation = queue.catch(() => {}).then(async() => {
        if (isStopped()) throw aborted()
        ensureOpen()
        pending = active
        try {
          const args = { key: active.key, url: url.toString(), method, headers, body: init.body ?? null }
          const reply = await execute<{ status: number, text: string, headers: Array<[string, string]> }>(`(async() => {
            const args = ${JSON.stringify(args)};
            const requests = window.__linklinePassportRequests ??= new Map();
            const abort = new AbortController(); requests.set(args.key, abort);
            try {
              const header = new Headers(args.headers);
              const cookie = name => { const prefix = name + '='; const part = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix)); return part ? part.slice(prefix.length) : ''; };
              header.set('x-tt-passport-csrf-token', cookie('passport_csrf_token') || cookie('passport_csrf_token_default'));
              const response = await fetch(args.url, { method: args.method, headers: header, body: args.body, credentials: 'include', redirect: 'error', signal: abort.signal });
              const text = await response.text();
              if (text.length > ${MAX_RESPONSE}) throw new Error('Response too large');
              return { status: response.status, text, headers: [...response.headers].filter(([name]) => name.toLowerCase() !== 'set-cookie') };
            } finally { requests.delete(args.key); }
          })()`)
          ensureOpen()
          if (isStopped()) throw aborted()
          if (!active.response || active.response.status !== reply.status || typeof reply.text !== 'string' || reply.text.length > MAX_RESPONSE) throw unavailable()
          const received = new Headers()
          for (const [name, values] of Object.entries(active.response.headers)) for (const value of values) received.append(name, value)
          return new Response([204, 205, 304].includes(reply.status) ? null : reply.text, { status: reply.status, headers: received })
        } catch (error) {
          if (isStopped()) throw aborted()
          if (closed || active.unsigned === true || (error instanceof Error && error.message === unavailable().message)) throw unavailable()
          throw new Error('汽水音乐登录连接失败，请检查网络后重试')
        } finally { if (pending === active) pending = undefined }
      })
      queue = operation.then(() => {}, () => {})
      return limited(operation, init.signal, () => { stopped = true; abortPageRequest(active.key) })
    },
    destroy,
  }
}
