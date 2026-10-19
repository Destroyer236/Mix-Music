import { randomBytes, randomUUID } from 'node:crypto'
import { toDataURL } from 'qrcode'
import encryption from 'NeteaseCloudMusicApi/util/crypto'
import type { ProviderContext } from './providers/types'

export type NativeLoginPlatform = 'qq' | 'netease'
type Status = 'waiting' | 'scanned' | 'confirmed' | 'expired'
type Json = Record<string, unknown>
interface LoginResult { flowId: string, status: Status }
interface Flow {
  id: string
  owner: number
  key: string
  expiresAt: number
  status: Status
  cancelled: boolean
  accepted: boolean
  qrUnexpectedCount: number
  neteaseDevice: { deviceId: string, buildver: string, requestCount: number }
  controller: AbortController
  cookies: Map<string, Electron.CookiesSetDetails>
  timer?: ReturnType<typeof setTimeout>
  pending?: Promise<LoginResult>
}
const MAX_AGE = 5 * 60_000
// Keep the complete desktop QR protocol used by SPlayer Next together:
// type 3, EAPI encryption, interfacepc domain and one private device session.
const NETEASE_QR_TYPE = 3
const NETEASE_API = 'https://interfacepc.music.163.com'
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const object = (value: unknown): Json => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const cookieDomain = (cookie: { domain?: string }) => cookie.domain?.replace(/^\./, '') ?? ''
const cookieUrl = (cookie: { domain?: string, path?: string }) => `https://${cookieDomain(cookie)}${cookie.path ?? '/'}`
const cookieKey = (cookie: { name?: string, domain?: string, path?: string }) => `${cookieDomain(cookie)}\n${cookie.path ?? '/'}\n${cookie.name ?? ''}`
const detailsOf = (cookie: Electron.Cookie): Electron.CookiesSetDetails => ({ url: cookieUrl(cookie), name: cookie.name, value: cookie.value, domain: cookie.hostOnly ? undefined : cookie.domain, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, expirationDate: cookie.expirationDate, sameSite: cookie.sameSite })
const hash33 = (value: string, seed: number) => { let hash = seed; for (const char of value) hash = (hash << 5) + hash + char.charCodeAt(0); return hash & 0x7fffffff }
const safeValue = (value: unknown): string => {
  const text = typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)) ? String(value) : ''
  return text.length <= 8192 && !/[;,]/.test(text) && ![...text].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) ? text : ''
}

/** Private QR cookies never enter the account session before music authorization. */
export function createNativeLogin(context: ProviderContext, platform: NativeLoginPlatform, onConfirmed: () => Promise<() => void>, qqFetch: typeof fetch = globalThis.fetch) {
  const label = platform === 'qq' ? 'QQ 音乐' : '网易云音乐'
  const accountDomain = platform === 'qq' ? 'y.qq.com' : 'music.163.com'
  const cancelled = () => new Error(`本次${label}登录已取消，请重新发起`)
  let active: Flow | null = null
  let cookieQueue = Promise.resolve()
  const result = (flow: Flow): LoginResult => ({ flowId: flow.id, status: flow.status })
  const expire = (flow: Flow) => {
    if (flow.accepted || flow.cancelled) return
    flow.status = 'expired'
    flow.key = ''
    flow.cookies.clear()
    clearTimeout(flow.timer)
    flow.controller.abort()
  }
  const ensureCurrent = (flow: Flow) => {
    if (active !== flow || flow.cancelled) throw cancelled()
    if (flow.status === 'expired' || Date.now() >= flow.expiresAt) { expire(flow); throw new Error(`${label}登录二维码已过期，请刷新后重试`) }
  }
  const abandon = (flow: Flow) => {
    flow.cancelled = true
    flow.key = ''
    flow.cookies.clear()
    clearTimeout(flow.timer)
    flow.controller.abort()
    if (active === flow) active = null
  }
  const allowedDomain = (domain: string) => platform === 'qq' ? domain === 'qq.com' || domain.endsWith('.qq.com') : domain === 'music.163.com' || domain === '163.com' || domain === 'interfacepc.music.163.com'
  const stageCookies = (flow: Flow, response: Response, url: URL) => {
    const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=)/)
    for (const raw of values.flatMap(value => value.split(/,(?=\s*[^;,=\s]+=)/))) {
      const parts = raw.split(';').map(value => value.trim())
      const equal = parts[0].indexOf('=')
      if (equal < 1) continue
      const name = parts[0].slice(0, equal)
      const value = parts[0].slice(equal + 1)
      if (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(name) || /[\r\n]/.test(value)) continue
      const cookie: Electron.CookiesSetDetails = { url: `${url.origin}/`, name, value, domain: url.hostname, path: '/', secure: true }
      let valid = true
      for (const part of parts.slice(1)) {
        const at = part.indexOf('=')
        const attr = at < 0 ? '' : part.slice(at + 1)
        switch ((at < 0 ? part : part.slice(0, at)).toLowerCase()) {
          case 'domain': {
            const domain = attr.toLowerCase().replace(/^\./, '')
            if (!allowedDomain(domain) || (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))) valid = false
            else cookie.domain = `.${domain}`
            break
          }
          case 'path': if (attr.startsWith('/') && !/[\r\n]/.test(attr)) cookie.path = attr; break
          case 'httponly': cookie.httpOnly = true; break
          case 'expires': { const time = Date.parse(attr); if (Number.isFinite(time)) cookie.expirationDate = time / 1000; break }
          case 'max-age': { const seconds = Number(attr); if (Number.isFinite(seconds)) cookie.expirationDate = Date.now() / 1000 + seconds; break }
          case 'samesite': if (/^(strict|lax|none)$/i.test(attr)) cookie.sameSite = attr.toLowerCase() === 'none' ? 'no_restriction' : attr.toLowerCase() as 'strict' | 'lax'; break
        }
      }
      if (!valid) continue
      cookie.url = cookieUrl(cookie)
      if (!value || (cookie.expirationDate != null && cookie.expirationDate <= Date.now() / 1000)) flow.cookies.delete(cookieKey(cookie))
      else flow.cookies.set(cookieKey(cookie), cookie)
    }
  }
  const flowCookie = (flow: Flow, name: string) => [...flow.cookies.values()].find(cookie => cookie.name === name)?.value ?? ''
  const request = async(flow: Flow, address: string, init: RequestInit = {}): Promise<Response> => {
    ensureCurrent(flow)
    const url = new URL(address)
    if (url.protocol !== 'https:' || !allowedDomain(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new Error(`${label}登录授权地址无效`)
    const headers = new Headers({ 'User-Agent': WEB_UA, Referer: platform === 'qq' ? 'https://xui.ptlogin2.qq.com/' : 'https://music.163.com/' })
    // Headers normalizes names to lowercase; object-spreading normalized keys
    // beside User-Agent/Referer would append values instead of replacing them.
    new Headers(init.headers).forEach((value, name) => { headers.set(name, value) })
    const cookies = [...flow.cookies.values()].filter(cookie => url.hostname === cookieDomain(cookie) || (String(cookie.domain).startsWith('.') && url.hostname.endsWith(`.${cookieDomain(cookie)}`)))
    // QQ uses the private response jar. NetEase supplies its EAPI device header
    // as Cookie explicitly; neither transport reads the saved account session.
    if (platform === 'qq' && cookies.length) headers.set('Cookie', cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '))
    else if (platform === 'qq') headers.delete('Cookie')
    const abort = new AbortController()
    const onAbort = () => { abort.abort() }
    flow.controller.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { abort.abort() }, 15_000)
    try {
      // Electron session.fetch cancels manual redirects instead of exposing Location.
      // QQ OAuth therefore uses Node fetch with this private cookie jar.
      const response = await (platform === 'qq' ? qqFetch(address, { ...init, headers, credentials: 'omit', redirect: 'manual', signal: abort.signal }) : context.session.fetch(address, { ...init, headers, credentials: 'omit', redirect: 'error', signal: abort.signal }))
      ensureCurrent(flow)
      if (!response.ok && !(platform === 'qq' && response.status >= 300 && response.status < 400)) throw new Error(`${label}登录请求失败 (${response.status})`)
      const body = await response.arrayBuffer()
      ensureCurrent(flow)
      if (body.byteLength > 500_000) throw new Error(`${label}登录响应异常，请稍后重试`)
      stageCookies(flow, response, url)
      // Keep both cancellation and the timeout attached while reading the body.
      return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch (error) {
      ensureCurrent(flow)
      if (abort.signal.aborted) throw new Error(`${label}登录请求超时，请检查网络后重试`)
      if (error instanceof Error && error.message.startsWith(label)) throw error
      throw new Error(`${label}登录连接失败，请检查网络后重试`)
    } finally { clearTimeout(timer); flow.controller.signal.removeEventListener('abort', onAbort) }
  }
  const json = async(flow: Flow, response: Response) => {
    const text = await response.text()
    ensureCurrent(flow)
    if (!text || text.length > 500_000) throw new Error(`${label}登录响应异常，请稍后重试`)
    try { return object(JSON.parse(text)) } catch { throw new Error(`${label}登录响应异常，请稍后重试`) }
  }
  const netease = async(flow: Flow, route: string, data: Json) => {
    const device = flow.neteaseDevice
    const header: Record<string, string> = { osver: 'Microsoft-Windows-10-Professional-build-19045-64bit', deviceId: device.deviceId, os: 'pc', appver: '3.1.29.205117', versioncode: '140', mobilename: '', buildver: device.buildver, resolution: '1920x1080', __csrf: '', channel: 'netease', requestId: `${Date.now()}_${String(++device.requestCount).padStart(4, '0')}` }
    const nmtid = safeValue(flowCookie(flow, 'NMTID'))
    if (nmtid) header.NMTID = nmtid
    // Keep this QR's device cookies, but a credential must come from the current
    // successful poll rather than an earlier intermediate response.
    for (const [key, cookie] of flow.cookies) if (cookie.name === 'MUSIC_U' || cookie.name === '__csrf') flow.cookies.delete(key)
    return json(flow, await request(flow, `${NETEASE_API}/eapi/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)', Cookie: Object.entries(header).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ') }, body: new URLSearchParams(encryption.eapi(`/api/${route}`, { ...data, e_r: false, header })).toString() }))
  }
  const musicCookies = (flow: Flow, data: Json, fallback: string) => {
    const id = safeValue(data.str_musicid || data.musicid || fallback).replace(/^o0*/, '')
    const key = safeValue(data.musickey)
    if (!/^[1-9]\d{0,24}$/.test(id) || !key) throw new Error('QQ 音乐未返回有效的音乐授权，请重新扫码')
    const fields: Record<string, unknown> = { uin: id, qqmusic_uin: id, qm_str_musicid: id, qm_keyst: key, qqmusic_key: key, tmeLoginType: '2', euin: data.encryptUin, psrf_qqopenid: data.openid, psrf_qqunionid: data.unionid, psrf_qqrefresh_token: data.refresh_token, psrf_qqaccess_token: data.access_token, qm_refresh_key: data.refresh_key, psrf_access_token_expiresAt: data.expired_at, psrf_musickey_createtime: data.musickeyCreateTime, qm_key_expires_in: data.keyExpiresIn }
    flow.cookies.clear()
    for (const [name, raw] of Object.entries(fields)) {
      const value = safeValue(raw)
      if (!value) continue
      const cookie: Electron.CookiesSetDetails = { url: 'https://y.qq.com/', domain: '.y.qq.com', path: '/', name, value, secure: true, httpOnly: true, sameSite: 'lax', expirationDate: Date.now() / 1000 + 365 * 24 * 60 * 60 }
      flow.cookies.set(cookieKey(cookie), cookie)
    }
  }
  const qqAuthorize = async(flow: Flow, jump: string) => {
    const jumpUrl = new URL(jump)
    if (jumpUrl.protocol !== 'https:' || !['ptlogin2.qq.com', 'ssl.ptlogin2.qq.com', 'ssl.ptlogin2.graph.qq.com', 'ptlogin2.graph.qq.com'].includes(jumpUrl.hostname) || !jumpUrl.pathname.endsWith('/check_sig')) throw new Error('QQ 音乐登录授权地址无效')
    await request(flow, jumpUrl.toString())
    const skey = flowCookie(flow, 'p_skey') || flowCookie(flow, 'p_sKey') || flowCookie(flow, 'skey') || flowCookie(flow, 'pskey')
    if (!skey) throw new Error('QQ 音乐未完成扫码授权，请重新扫码并确认')
    const response = await request(flow, 'https://graph.qq.com/oauth2.0/authorize', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ response_type: 'code', client_id: '100497308', redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/', scope: 'get_user_info,get_app_friends', state: 'state', switch: '', from_ptlogin: '1', src: '1', update_auth: '1', openapi: '1010_1030', g_tk: String(hash33(skey, 5381)), auth_time: String(Date.now()), ui: randomUUID() }).toString() })
    let redirect: URL
    try { redirect = new URL(response.headers.get('location') ?? '') } catch { throw new Error('QQ 音乐未返回有效的授权结果，请重新扫码') }
    if (redirect.protocol !== 'https:' || redirect.hostname !== 'y.qq.com' || redirect.pathname !== '/portal/wx_redirect.html' || redirect.username || redirect.password || redirect.port) throw new Error('QQ 音乐登录授权结果无效')
    const code = safeValue(redirect.searchParams.get('code'))
    if (!code) throw new Error('QQ 音乐未返回有效的授权码，请重新扫码')
    const body = await json(flow, await request(flow, 'https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/', 'User-Agent': 'QQMusic 14090008(android 15)' }, body: JSON.stringify({ comm: { ct: 11, cv: 14090008, v: 14090008, chid: '10003505', os_ver: '15', phonetype: '24122RKC7C', tmeAppID: 'qqmusic', nettype: 'NETWORK_WIFI', udid: '0', OpenUDID: '0', QIMEI36: '0', uin: '0', tmeLoginType: 2 }, request: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } } }) }))
    const inner = object(body.request)
    if (Number(body.code ?? -1) !== 0 || Number(inner.code ?? -1) !== 0) throw new Error('QQ 音乐授权失败，请重新扫码并在手机上确认')
    musicCookies(flow, object(inner.data), jumpUrl.searchParams.get('uin') ?? '')
  }
  const accept = async(flow: Flow) => {
    const operation = cookieQueue.catch(() => {}).then(async() => {
      ensureCurrent(flow)
      const cookies = [...flow.cookies.values()].filter(cookie => platform === 'netease' || cookieDomain(cookie) === accountDomain || accountDomain.endsWith(`.${cookieDomain(cookie)}`)).map(cookie => platform === 'netease' ? { ...cookie, url: 'https://music.163.com/', domain: '.music.163.com', path: '/' } : cookie)
      if (!cookies.some(cookie => cookie.name === (platform === 'qq' ? 'qqmusic_key' : 'MUSIC_U') && cookie.value)) throw new Error(`${label}未完成音乐登录授权，请重新扫码`)
      const names = new Set([...cookies.map(cookie => cookie.name), ...(platform === 'qq' ? ['qqmusic_uin', 'uin', 'qm_str_musicid', 'p_uin', 'wxuin', 'qqmusic_key', 'qm_keyst', 'tmeLoginType', 'euin', 'psrf_qqopenid', 'psrf_qqunionid', 'psrf_qqrefresh_token', 'psrf_qqaccess_token', 'qm_refresh_key', 'psrf_access_token_expiresAt', 'psrf_musickey_createtime', 'qm_key_expires_in'] : ['MUSIC_U', '__csrf'])])
      // Remove same-name cookies across parent domains before committing. Otherwise
      // Object.fromEntries in the provider can select a previous account's cookie.
      const original = (await context.session.cookies.get({})).filter(cookie => names.has(cookie.name) && (accountDomain === cookieDomain(cookie) || accountDomain.endsWith(`.${cookieDomain(cookie)}`)))
      const removed: Electron.Cookie[] = []
      const touched: Electron.CookiesSetDetails[] = []
      try {
        for (const cookie of original) { ensureCurrent(flow); removed.push(cookie); await context.session.cookies.remove(cookieUrl(cookie), cookie.name) }
        for (const cookie of cookies) { ensureCurrent(flow); touched.push(cookie); await context.session.cookies.set(cookie) }
        ensureCurrent(flow)
        await context.session.cookies.flushStore()
        ensureCurrent(flow)
        const commit = await onConfirmed()
        ensureCurrent(flow)
        // Commit the validated profile and confirmed status in one synchronous turn.
        commit()
        flow.accepted = true
        flow.status = 'confirmed'
        clearTimeout(flow.timer)
        flow.key = ''
        flow.cookies.clear()
      } catch (error) {
        for (const cookie of touched.reverse()) if (cookie.name) await context.session.cookies.remove(cookieUrl(cookie), cookie.name).catch(() => {})
        for (const cookie of removed) await context.session.cookies.set(detailsOf(cookie)).catch(() => {})
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
      const flow: Flow = { id: randomUUID(), owner, key: '', expiresAt: Date.now() + MAX_AGE, status: 'waiting', cancelled: false, accepted: false, qrUnexpectedCount: 0, neteaseDevice: { deviceId: randomBytes(26).toString('hex').toUpperCase(), buildver: String(Math.floor(Date.now() / 1000)), requestCount: 0 }, controller: new AbortController(), cookies: new Map() }
      active = flow
      flow.timer = setTimeout(() => { expire(flow) }, MAX_AGE)
      flow.timer.unref?.()
      try {
        await cookieQueue
        ensureCurrent(flow)
        let image: string
        if (platform === 'netease') {
          const body = await netease(flow, 'login/qrcode/unikey', { type: NETEASE_QR_TYPE })
          const key = safeValue(body.unikey ?? object(body.data).unikey)
          if (Number(body.code) !== 200 || !key) throw new Error('网易云音乐未返回有效的登录二维码，请重试')
          flow.key = key
          image = await toDataURL(`https://music.163.com/login?codekey=${encodeURIComponent(key)}`, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
        } else {
          const response = await request(flow, `https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}&daid=383&pt_3rd_aid=100497308`)
          const data = Buffer.from(await response.arrayBuffer())
          ensureCurrent(flow)
          const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255
          if (data.length > 400_000 || (!png && !jpeg) || !safeValue(flowCookie(flow, 'qrsig'))) throw new Error('QQ 音乐未返回有效的登录二维码，请重试')
          flow.key = safeValue(flowCookie(flow, 'qrsig'))
          image = `data:image/${png ? 'png' : 'jpeg'};base64,${data.toString('base64')}`
        }
        ensureCurrent(flow)
        return { flowId: flow.id, image, expiresAt: flow.expiresAt, status: 'waiting' }
      } catch (error) { if (active === flow) abandon(flow); throw error }
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
          if (platform === 'netease') {
            const body = await netease(flow, 'login/qrcode/client/login', { key: flow.key, type: NETEASE_QR_TYPE })
            if (Number(body.code) === 801) { flow.status = 'waiting'; flow.qrUnexpectedCount = 0 } else if (Number(body.code) === 802) { flow.status = 'scanned'; flow.qrUnexpectedCount = 0 } else if (Number(body.code) === 803) await accept(flow)
            else if (Number(body.code) === 200 && safeValue(flowCookie(flow, 'MUSIC_U'))) await accept(flow)
            else if (Number(body.code) === 800) expire(flow)
            else {
              ++flow.qrUnexpectedCount
              const code = Number(body.code)
              const status = body.code != null && Number.isSafeInteger(code) && Math.abs(code) <= 999999 ? String(code) : 'missing'
              if (flow.qrUnexpectedCount === 1) console.warn('LinkLine NetEase QR unexpected status:', status)
              if ([301, 302, 400, 401, 403, 405, 406, 415, 429, 500, 502, 503].includes(code) || flow.qrUnexpectedCount >= 3) throw new Error(`网易云音乐扫码状态异常（${status}），请刷新二维码后重试`)
            }
            // Never leave persistent business failures looking like a waiting QR.
            // A compatible 200+fresh MUSIC_U still requires profile verification.
          } else {
            const query = new URLSearchParams({ u1: 'https://graph.qq.com/oauth2.0/login_jump', ptqrtoken: String(hash33(flow.key, 0)), ptredirect: '0', h: '1', t: '1', g: '1', from_ui: '1', ptlang: '2052', action: `0-0-${Date.now()}`, js_ver: '20102616', js_type: '1', pt_uistyle: '40', aid: '716027609', daid: '383', pt_3rd_aid: '100497308', has_onekey: '1' })
            const response = await request(flow, `https://ssl.ptlogin2.qq.com/ptqrlogin?${query.toString()}`)
            const text = await response.text()
            ensureCurrent(flow)
            const match = text.length <= 100_000 && /ptuiCB\((.*?)\)/.exec(text)
            const args = match ? [...match[1].matchAll(/'((?:\\.|[^'])*)'/g)].map(value => value[1].replace(/\\x([a-f\d]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\(['\\])/g, '$1')) : []
            if (args[0] === '66') flow.status = 'waiting'
            else if (args[0] === '67') flow.status = 'scanned'
            else if (args[0] === '65') expire(flow)
            else if (args[0] === '0') { await qqAuthorize(flow, args[2] ?? ''); await accept(flow) } else throw new Error('QQ 音乐扫码失败，请刷新二维码后重试')
          }
          return result(flow)
        } catch (error) { if (active === flow && !flow.cancelled && flow.status === 'expired') return result(flow); throw error } finally { flow.pending = undefined }
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
