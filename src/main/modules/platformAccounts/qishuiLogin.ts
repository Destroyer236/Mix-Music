import { randomUUID } from 'node:crypto'
import type { ProviderContext } from './providers/types'

const API = 'https://api.qishui.com'
const SDK = { aid: '386088', passport_jssdk_version: '4.2.3', passport_jssdk_type: 'lite', is_from_ttaccountsdk: '1', account_sdk_source: 'web' }
const MAX_AGE = 5 * 60 * 1000
const REQUEST_TIMEOUT = 20_000
const AUTH_COOKIES = ['sessionid', 'sessionid_ss', 'sid_tt']
type Status = 'waiting' | 'scanned' | 'confirmed' | 'expired'
type Json = Record<string, unknown>
interface LoginResult { flowId: string, status: Status }
interface Flow {
  id: string
  owner: number
  token: string
  expiresAt: number
  status: Status
  cancelled: boolean
  accepted: boolean
  controller: AbortController
  cookies: Map<string, Electron.CookiesSetDetails>
  timer?: ReturnType<typeof setTimeout>
  pending?: Promise<LoginResult>
}
const object = (value: unknown): Json => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const cancelled = () => new Error('本次汽水音乐登录已取消，请重新发起')
const cookieKey = (cookie: { name?: string, domain?: string, path?: string }) => `${cookie.domain?.replace(/^\./, '') ?? 'api.qishui.com'}\n${cookie.path ?? '/'}\n${cookie.name ?? ''}`
const cookieUrl = (cookie: { domain?: string, path?: string }) => `https://${cookie.domain?.replace(/^\./, '') ?? 'api.qishui.com'}${cookie.path ?? '/'}`
const detailsOf = (cookie: Electron.Cookie): Electron.CookiesSetDetails => ({ url: cookieUrl(cookie), name: cookie.name, value: cookie.value, domain: cookie.hostOnly ? undefined : cookie.domain, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, expirationDate: cookie.expirationDate, sameSite: cookie.sameSite })

function qrImage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 400_000) throw new Error('汽水音乐未返回有效的登录二维码')
  const match = /^data:image\/(png|jpeg);base64,([a-z\d+/]+={0,2})$/i.exec(value)
  if (!match) throw new Error('汽水音乐未返回有效的登录二维码')
  const data = Buffer.from(match[2], 'base64')
  const valid = match[1].toLowerCase() === 'png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : data[0] === 255 && data[1] === 216 && data[2] === 255
  if (!valid) throw new Error('汽水音乐登录二维码格式无效，请重试')
  return value
}

// Passport cookies remain private to their flow until that flow is confirmed.
// credentials:omit prevents a late Set-Cookie from reviving a cancelled account.
function stageCookies(flow: Flow, headers: Headers) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=)/)
  for (const raw of values) {
    const parts = raw.split(';').map(value => value.trim())
    const at = parts[0].indexOf('=')
    if (at < 1) continue
    const name = parts[0].slice(0, at)
    const value = parts[0].slice(at + 1)
    if (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(name) || /[\r\n]/.test(value)) continue
    const cookie: Electron.CookiesSetDetails = { url: `${API}/`, name, value, path: '/', secure: true }
    let valid = true
    for (const part of parts.slice(1)) {
      const equal = part.indexOf('=')
      const key = (equal < 0 ? part : part.slice(0, equal)).toLowerCase()
      const attr = equal < 0 ? '' : part.slice(equal + 1)
      switch (key) {
        case 'domain': {
          const domain = attr.toLowerCase().replace(/^\./, '')
          if (domain !== 'qishui.com' && domain !== 'api.qishui.com') valid = false
          else cookie.domain = attr.toLowerCase()
          break
        }
        case 'path': if (attr.startsWith('/') && !/[\r\n]/.test(attr)) cookie.path = attr; break
        case 'httponly': cookie.httpOnly = true; break
        case 'expires': {
          const timestamp = Date.parse(attr)
          if (Number.isFinite(timestamp)) cookie.expirationDate = timestamp / 1000
          break
        }
        case 'max-age': {
          const seconds = Number(attr)
          if (Number.isFinite(seconds)) cookie.expirationDate = Date.now() / 1000 + seconds
          break
        }
        case 'samesite': if (/^(strict|lax|none)$/i.test(attr)) cookie.sameSite = attr.toLowerCase() === 'none' ? 'no_restriction' : attr.toLowerCase() as 'strict' | 'lax'; break
      }
    }
    if (!valid) continue
    cookie.url = cookieUrl(cookie)
    const key = cookieKey(cookie)
    if (!value || (cookie.expirationDate != null && cookie.expirationDate <= Date.now() / 1000)) flow.cookies.delete(key)
    else flow.cookies.set(key, cookie)
  }
}

export function createQishuiLogin(context: ProviderContext, onConfirmed: () => Promise<void>) {
  let active: Flow | null = null
  let cookieQueue = Promise.resolve()
  const result = (flow: Flow): LoginResult => ({ flowId: flow.id, status: flow.status })
  const expire = (flow: Flow) => {
    if (flow.accepted || flow.cancelled) return
    flow.status = 'expired'
    clearTimeout(flow.timer)
    flow.controller.abort()
    flow.token = ''
    flow.cookies.clear()
  }
  const ensureCurrent = (flow: Flow) => {
    if (active !== flow || flow.cancelled) throw cancelled()
    if (flow.status === 'expired' || Date.now() >= flow.expiresAt) { expire(flow); throw new Error('汽水音乐登录二维码已过期，请刷新后重试') }
  }
  const setExpiry = (flow: Flow) => {
    clearTimeout(flow.timer)
    flow.timer = setTimeout(() => { expire(flow) }, Math.max(0, flow.expiresAt - Date.now()))
    flow.timer.unref?.()
  }
  const abandon = (flow: Flow) => {
    flow.cancelled = true
    clearTimeout(flow.timer)
    flow.controller.abort()
    flow.token = ''
    flow.cookies.clear()
    if (active === flow) active = null
  }

  async function request(flow: Flow, route: string, body?: Record<string, string>): Promise<Json> {
    ensureCurrent(flow)
    const abort = new AbortController()
    const onAbort = () => { abort.abort() }
    flow.controller.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { abort.abort() }, REQUEST_TIMEOUT)
    const url = new URL(route, API)
    url.search = new URLSearchParams(body ? SDK : { ...SDK, next: API, need_logo: 'false', need_short_url: 'false', is_new_login: '1' }).toString()
    const headers = new Headers({ Accept: 'application/json', 'User-Agent': 'LunaPC/3.7.0(official)' })
    const cookie = [...flow.cookies.values()].map(item => `${item.name}=${item.value}`).join('; ')
    if (cookie) headers.set('Cookie', cookie)
    if (body) headers.set('Content-Type', 'application/x-www-form-urlencoded')
    try {
      const response = await context.session.fetch(url.toString(), { method: body ? 'POST' : 'GET', headers, body: body ? new URLSearchParams(body).toString() : undefined, credentials: 'omit', redirect: 'error', signal: abort.signal })
      ensureCurrent(flow)
      if (response.headers.has('bdturing-verify') || response.headers.has('x-tt-verify-passport-decision')) throw new Error('汽水音乐要求安全验证，请先在官方客户端完成验证后重新登录')
      if (!response.ok) throw new Error(`汽水音乐登录请求失败 (${response.status})`)
      const text = await response.text()
      ensureCurrent(flow)
      if (!text || text.length > 600_000) throw new Error('汽水音乐登录接口响应异常，请稍后重试')
      let json: Json
      try { json = object(JSON.parse(text)) } catch { throw new Error('汽水音乐登录接口响应异常，请稍后重试') }
      const data = object(json.data)
      if (data.captcha || Number(data.error_code ?? 0) !== 0 || (json.message != null && json.message !== 'success')) throw new Error('汽水音乐登录失败或需要安全验证，请在官方客户端确认账号状态后重试')
      stageCookies(flow, response.headers)
      return data
    } catch (error) {
      ensureCurrent(flow)
      if (abort.signal.aborted) throw new Error('汽水音乐登录请求超时，请检查网络后重试')
      if (error instanceof Error && error.message.startsWith('汽水音乐')) throw error
      throw new Error('汽水音乐登录连接失败，请检查网络后重试')
    } finally {
      clearTimeout(timer)
      flow.controller.signal.removeEventListener('abort', onAbort)
    }
  }

  async function accept(flow: Flow) {
    const operation = cookieQueue.catch(() => {}).then(async() => {
      ensureCurrent(flow)
      const original = new Map((await context.session.cookies.get({ url: `${API}/` })).map(cookie => [cookieKey(cookie), cookie]))
      const touched: Electron.CookiesSetDetails[] = []
      try {
        ensureCurrent(flow)
        if (![...flow.cookies.values()].some(cookie => AUTH_COOKIES.includes(cookie.name ?? '') && cookie.value)) throw new Error('汽水音乐未完成登录授权，请重新扫码并确认')
        for (const cookie of flow.cookies.values()) {
          ensureCurrent(flow)
          touched.push(cookie)
          await context.session.cookies.set(cookie)
          ensureCurrent(flow)
        }
        const stored = await context.session.cookies.get({ url: `${API}/` })
        ensureCurrent(flow)
        if (!stored.some(cookie => AUTH_COOKIES.includes(cookie.name) && cookie.value)) throw new Error('汽水音乐未完成登录授权，请重新扫码并确认')
        await context.session.cookies.flushStore()
        ensureCurrent(flow)
        await onConfirmed()
        ensureCurrent(flow)
        flow.accepted = true
        flow.status = 'confirmed'
        clearTimeout(flow.timer)
        flow.token = ''
        flow.cookies.clear()
      } catch (error) {
        // Only the current transaction may touch persistent cookies. A new start
        // waits for this rollback, so it can never lose its own session here.
        for (const cookie of touched.reverse()) {
          if (cookie.name) await context.session.cookies.remove(cookieUrl(cookie), cookie.name).catch(() => {})
          const previous = original.get(cookieKey(cookie))
          if (previous) await context.session.cookies.set(detailsOf(previous)).catch(() => {})
        }
        await context.session.cookies.flushStore().catch(() => {})
        throw error
      }
    })
    cookieQueue = operation.catch(() => {})
    await operation
  }

  return {
    async start(owner: number): Promise<{ flowId: string, image: string, expiresAt: number, status: 'waiting' }> {
      if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('无效的登录窗口')
      if (active) abandon(active)
      const flow: Flow = { id: randomUUID(), owner, token: '', expiresAt: Date.now() + MAX_AGE, status: 'waiting', cancelled: false, accepted: false, controller: new AbortController(), cookies: new Map() }
      active = flow
      setExpiry(flow)
      try {
        await cookieQueue
        ensureCurrent(flow)
        const data = await request(flow, '/passport/web/get_qrcode/')
        ensureCurrent(flow)
        const image = qrImage(data.qrcode)
        if (typeof data.token !== 'string' || !data.token || data.token.length > 8192) throw new Error('汽水音乐未返回有效的登录二维码')
        flow.token = data.token
        const expires = Number(data.expire_time) * 1000
        flow.expiresAt = Math.min(Date.now() + MAX_AGE, Number.isFinite(expires) && expires > 0 ? expires : Date.now() + 60_000)
        ensureCurrent(flow)
        setExpiry(flow)
        return { flowId: flow.id, image, expiresAt: flow.expiresAt, status: 'waiting' }
      } catch (error) {
        if (active === flow) abandon(flow)
        throw error
      }
    },
    async check(owner: number, flowId: string): Promise<LoginResult> {
      const flow = active
      if (!flow || flow.id !== flowId || flow.cancelled) throw cancelled()
      if (flow.owner !== owner) throw new Error('此二维码不属于当前登录窗口')
      if (flow.accepted || flow.status === 'expired') return result(flow)
      if (Date.now() >= flow.expiresAt) { expire(flow); return result(flow) }
      if (flow.pending) return flow.pending
      const operation = (async() => {
        try {
          const data = await request(flow, '/passport/web/check_qrconnect/', { need_logo: 'false', need_short_url: 'false', is_frontier: 'true', token: flow.token, is_new_login: '1', next: API })
          ensureCurrent(flow)
          const status = String(data.status ?? '')
          if (['new', 'waiting', '1'].includes(status)) flow.status = 'waiting'
          else if (['scanned', 'scan', '2'].includes(status)) flow.status = 'scanned'
          else if (['confirmed', 'confirm', '3'].includes(status)) await accept(flow)
          else if (['expired', '4'].includes(status)) expire(flow)
          else throw new Error('汽水音乐未返回可识别的扫码状态，请刷新二维码后重试')
          return result(flow)
        } catch (error) {
          if (active === flow && !flow.cancelled && flow.status === 'expired') return result(flow)
          throw error
        } finally { flow.pending = undefined }
      })()
      flow.pending = operation
      return operation
    },
    cancel(owner: number, flowId?: string): boolean {
      const flow = active
      if (!flow || (flowId != null && flow.id !== flowId)) return false
      if (flow.owner !== owner) throw new Error('此二维码不属于当前登录窗口')
      if (flow.accepted) { active = null; return false }
      abandon(flow)
      return true
    },
    cancelAll() { if (active) abandon(active) },
    async settled() { await cookieQueue },
    isActive(): boolean { return Boolean(active && !active.cancelled && !active.accepted && active.status !== 'expired' && Date.now() < active.expiresAt) },
  }
}
