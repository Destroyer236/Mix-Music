import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { registerAccountSession } from './navigation'

export interface QishuiPassportClient {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  destroy: () => Promise<void>
}
export type QishuiPassportFactory = (userAgent: string, signal: AbortSignal) => Promise<QishuiPassportClient>

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
export const createQishuiPassport: QishuiPassportFactory = async(userAgent, ownerSignal) => {
  if (ownerSignal.aborted) throw aborted()
  if (!userAgent || userAgent.length > 8192 || /[\r\n]/.test(userAgent)) throw unavailable()
  const privateSession = session.fromPartition(`linkline-qishui-passport-${randomUUID()}`, { cache: false })
  privateSession.setUserAgent(userAgent)
  privateSession.setPermissionRequestHandler((_contents, _permission, allow) => { allow(false) })
  privateSession.setPermissionCheckHandler(() => false)
  registerAccountSession(privateSession, ['api.qishui.com'])
  const lifetime = new AbortController()
  let window: BrowserWindow | undefined
  let closed = false
  let cleanup: Promise<void> | undefined
  let pending: Pending | undefined
  let queue = Promise.resolve()
  const denyDownload = (event: Electron.Event) => { event.preventDefault() }
  privateSession.on('will-download', denyDownload)

  const destroy = async() => {
    if (cleanup) return cleanup
    closed = true
    lifetime.abort()
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
      }
    } catch {}
    callback({ cancel: closed || !allowed })
  })
  privateSession.webRequest.onHeadersReceived({ urls: [`${API}/passport/*`] }, (details, callback) => {
    if (pending?.requestId === details.id) pending.response = { status: details.statusCode, headers: details.responseHeaders ?? {} }
    callback({ responseHeaders: details.responseHeaders })
  })

  try {
    window = new BrowserWindow({ show: false, webPreferences: { session: privateSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const preventNavigation = (event: Electron.Event) => { event.preventDefault() }
    window.webContents.on('will-navigate', preventNavigation)
    window.webContents.on('will-redirect', preventNavigation)
    window.webContents.once('render-process-gone', () => { void destroy() })
    window.once('closed', () => { void destroy() })
    const initialize = (async() => {
      // A natural HTTP 404 still supplies the API's same-origin document. An
      // opaque Chromium error page is rejected instead of weakening security.
      try { await window.loadURL(`${API}/`) } catch {}
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

  return {
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
