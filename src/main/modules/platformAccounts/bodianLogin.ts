import { randomUUID } from 'node:crypto'
import { toDataURL } from 'qrcode'
import type { ProviderContext } from './providers/types'
import { itemId, object, request, text } from './providers/bodianApi'

const COOKIE_URL = 'https://bd-api.kuwo.cn/'
const COOKIE_NAMES = ['linkline_bodian_uid', 'linkline_bodian_token', 'linkline_bodian_nickname', 'linkline_bodian_avatar']
const MAX_AGE = 5 * 60_000
type Status = 'waiting' | 'scanned' | 'confirmed' | 'expired'
interface LoginResult { flowId: string, status: Status }
interface Identity { uid: string, token: string, nickname: string, avatar: string }
interface Flow {
  id: string
  owner: number
  qrCode: string
  expiresAt: number
  status: Status
  cancelled: boolean
  accepted: boolean
  controller: AbortController
  timer?: ReturnType<typeof setTimeout>
  pending?: Promise<LoginResult>
}
const cancelled = () => new Error('本次波点音乐登录已取消，请重新发起')
const cookieDetails = (cookie: Electron.Cookie): Electron.CookiesSetDetails => ({ url: COOKIE_URL, name: cookie.name, value: cookie.value, domain: cookie.hostOnly ? undefined : cookie.domain, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, expirationDate: cookie.expirationDate, sameSite: cookie.sameSite })

function identity(value: unknown): Identity {
  const data = object(value)
  const user = object(data.userInfo)
  const ids = [data.id, data.uid, user.id, user.uid].filter(value => value != null && value !== '').map(itemId)
  if (!ids.length || ids.some(value => !value || value !== ids[0])) throw new Error('波点音乐返回的登录身份不一致，请重新扫码')
  const token = typeof data.token === 'string' ? data.token : ''
  if (!token || token.length > 8192 || /[;,]/.test(token) || [...token].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) throw new Error('波点音乐未返回有效的登录授权，请重新扫码')
  const nickname = text(user.nickname ?? data.nickname).slice(0, 200)
  const rawAvatar = text(user.headImg ?? data.headImg)
  let avatar = ''
  try { const parsed = new URL(rawAvatar); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && rawAvatar.length < 4096) avatar = parsed.toString() } catch {}
  return { uid: ids[0], token, nickname, avatar }
}

export function createBodianLogin(context: ProviderContext, onConfirmed: () => Promise<void>) {
  let active: Flow | null = null
  let cookieQueue = Promise.resolve()
  const result = (flow: Flow): LoginResult => ({ flowId: flow.id, status: flow.status })
  const expire = (flow: Flow) => {
    if (flow.accepted || flow.cancelled) return
    flow.status = 'expired'
    flow.qrCode = ''
    clearTimeout(flow.timer)
    flow.controller.abort()
  }
  const ensureCurrent = (flow: Flow) => {
    if (active !== flow || flow.cancelled) throw cancelled()
    if (flow.status === 'expired' || Date.now() >= flow.expiresAt) { expire(flow); throw new Error('波点音乐登录二维码已过期，请刷新后重试') }
  }
  const abandon = (flow: Flow) => {
    flow.cancelled = true
    flow.qrCode = ''
    clearTimeout(flow.timer)
    flow.controller.abort()
    if (active === flow) active = null
  }
  const query = async(flow: Flow, path: string, options: { query?: Record<string, string>, body?: Record<string, string | number> } = {}) => {
    ensureCurrent(flow)
    try {
      const data = await request(context, path, { ...options, signed: true, anonymous: true, signal: flow.controller.signal })
      ensureCurrent(flow)
      return data
    } catch (error) { ensureCurrent(flow); throw error }
  }
  const accept = async(flow: Flow, account: Identity) => {
    const operation = cookieQueue.catch(() => {}).then(async() => {
      ensureCurrent(flow)
      const original = new Map((await context.session.cookies.get({ url: COOKIE_URL })).filter(cookie => COOKIE_NAMES.includes(cookie.name)).map(cookie => [cookie.name, cookie]))
      const values = [account.uid, account.token, encodeURIComponent(account.nickname), encodeURIComponent(account.avatar)]
      const touched: string[] = []
      try {
        for (let index = 0; index < COOKIE_NAMES.length; index++) {
          ensureCurrent(flow)
          const name = COOKIE_NAMES[index]
          touched.push(name)
          await context.session.cookies.set({ url: COOKIE_URL, name, value: values[index], path: '/', httpOnly: true, secure: true, sameSite: 'strict', expirationDate: Date.now() / 1000 + 365 * 24 * 60 * 60 })
          ensureCurrent(flow)
        }
        await context.session.cookies.flushStore()
        ensureCurrent(flow)
        await onConfirmed()
        ensureCurrent(flow)
        flow.accepted = true
        flow.status = 'confirmed'
        flow.qrCode = ''
        clearTimeout(flow.timer)
      } catch (error) {
        // New flows wait for this transaction, so a cancelled confirmation can
        // restore the previous login without overwriting a newer account.
        for (const name of touched.reverse()) {
          await context.session.cookies.remove(COOKIE_URL, name).catch(() => {})
          const previous = original.get(name)
          if (previous) await context.session.cookies.set(cookieDetails(previous)).catch(() => {})
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
      const flow: Flow = { id: randomUUID(), owner, qrCode: '', expiresAt: Date.now() + MAX_AGE, status: 'waiting', cancelled: false, accepted: false, controller: new AbortController() }
      active = flow
      flow.timer = setTimeout(() => { expire(flow) }, MAX_AGE)
      flow.timer.unref?.()
      try {
        await cookieQueue
        const data = await query(flow, '/api/ucenter/login/qrCode')
        if (typeof data.qrCode !== 'string' || !/^[a-f\d]{16}$/i.test(data.qrCode)) throw new Error('波点音乐未返回有效的登录二维码，请重试')
        flow.qrCode = data.qrCode
        const url = new URL('https://bodian-oia.kuwo.cn/bodian/download.html')
        url.search = new URLSearchParams({ pageName: 'login_pc', pt: '3', id: flow.qrCode }).toString()
        const image = await toDataURL(url.toString(), { width: 400, margin: 2, errorCorrectionLevel: 'M' })
        ensureCurrent(flow)
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
          const data = await query(flow, '/api/ucenter/login/qrCodeStatus', { query: { qrCode: flow.qrCode } })
          const status = Number(data.status)
          if (status === 1) flow.status = 'waiting'
          else if (status === 2) expire(flow)
          else if (status === 3) {
            flow.status = 'scanned'
            try {
              const data = await query(flow, '/api/ucenter/users/login', { body: { authType: 10, qrCode: flow.qrCode } })
              await accept(flow, identity(data))
            } catch (error) {
              ensureCurrent(flow)
              if (Number(object(error).code) !== 11027) throw error
            }
          } else throw new Error('波点音乐未返回可识别的扫码状态，请刷新二维码后重试')
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
