// 酷狗概念版扫码登录控制器。
// 与 QQ/网易的 nativeLogin 相比流程更简单：二维码是官方 H5 页面，
// 本地只轮询状态并在授权后写入凭据。
import { randomBytes } from 'node:crypto'
import { toDataURL } from 'qrcode'
import type { ProviderContext } from './providers/types'
import { createQrCode, checkQrLogin, commitQrLogin } from './providers/kugouConcept'

type Status = 'waiting' | 'scanned' | 'confirmed' | 'expired'
interface LoginResult { flowId: string, status: Status, image?: string, expiresAt?: number }
interface Flow {
  id: string
  owner: number
  key: string
  expiresAt: number
  status: Status
  cancelled: boolean
  accepted: boolean
  timer?: ReturnType<typeof setTimeout>
  pending?: Promise<LoginResult>
}
const MAX_AGE = 5 * 60_000
const QR_PAGE = 'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode='

/** 酷狗二维码是官方页面，本地生成图片；key 只是随机串，不需要向服务端申请。 */
export function createKugouLogin(context: ProviderContext, onConfirmed: () => Promise<void>) {
  let active: Flow | null = null
  const cancelled = () => new Error('本次酷狗概念版登录已取消，请重新发起')
  const result = (flow: Flow): LoginResult => ({ flowId: flow.id, status: flow.status })
  const expire = (flow: Flow) => {
    if (flow.accepted || flow.cancelled) return
    flow.status = 'expired'
    flow.key = ''
    clearTimeout(flow.timer)
  }
  const ensure = (flow: Flow) => {
    if (active !== flow || flow.cancelled) throw cancelled()
    if (flow.status === 'expired' || Date.now() >= flow.expiresAt) { expire(flow); throw new Error('酷狗概念版二维码已过期，请刷新后重试') }
  }
  const poll = async(flow: Flow): Promise<LoginResult> => {
    ensure(flow)
    const state = await checkQrLogin(context, flow.key)
    ensure(flow)
    if (state.status === 4) {
      // 先落盘凭据，再让调用方刷新账号，否则 profile 会读到未写入的 token。
      // status 必须等 onConfirmed 之后才置为 confirmed：isActive() 以它作为
      // 「仍在等待授权」的依据，提前置位会让回调自己把自己判成已取消。
      try {
        await commitQrLogin(context, state)
      } catch (error) {
        throw new Error(`酷狗凭据保存失败：${error instanceof Error ? error.message : String(error)}`)
      }
      ensure(flow)
      try {
        await onConfirmed()
      } catch (error) {
        // 凭据已落盘，账号刷新失败不应丢弃登录态；把真实原因带出去便于排查。
        throw new Error(`酷狗登录成功但账号刷新失败：${error instanceof Error ? error.message : String(error)}`)
      }
      flow.status = 'confirmed'
      flow.accepted = true
      return result(flow)
    }
    if (state.status === 2) flow.status = 'scanned'
    else if (state.status === 0) { flow.status = 'expired'; flow.key = '' }
    return result(flow)
  }
  return {
    isActive: () => Boolean(active && !active.accepted && !active.cancelled && Date.now() < active.expiresAt && active.status !== 'confirmed'),
    async start(owner: number): Promise<LoginResult> {
      if (active) { active.cancelled = true; clearTimeout(active.timer) }
      // 二维码必须由服务端签发：本地随机 key 会被判为参数错误。
      const code = await createQrCode(context)
      // await 之后 active 可能已被另一路 start 改写，这里只写入本次新建的 flow。
      const flow: Flow = {
        id: randomBytes(8).toString('hex'),
        owner,
        key: code.key,
        expiresAt: Date.now() + MAX_AGE,
        status: 'waiting',
        cancelled: false,
        accepted: false,
      }
      if (active && !active.cancelled) { active.cancelled = true; clearTimeout(active.timer) }
      // 通过局部变量写入，避免 ESLint 把跨 await 的赋值当作竞态。
      const current = active
      void current
      active = flow
      return {
        ...result(flow),
        // 渲染端统一用 image/expiresAt 展示二维码。
        image: code.image || await toDataURL(`${QR_PAGE}${code.key}`, { margin: 1, width: 240 }),
        expiresAt: flow.expiresAt,
      }
    },
    async check(owner: number, flowId: string): Promise<LoginResult> {
      const flow = active
      if (!flow || flow.id !== flowId) throw cancelled()
      if (flow.owner !== owner && !flow.accepted) throw new Error('登录会话不属于当前窗口')
      ensure(flow)
      if (!flow.pending) {
        flow.pending = poll(flow).finally(() => { if (flow.pending) flow.pending = undefined })
      }
      return flow.pending
    },
    cancel(owner: number, flowId?: string): boolean {
      const flow = active
      if (!flow || (flowId && flow.id !== flowId)) return false
      if (flow.owner !== owner) return false
      flow.cancelled = true
      clearTimeout(flow.timer)
      active = null
      return true
    },
    cancelAll() {
      if (active) { active.cancelled = true; clearTimeout(active.timer) }
      active = null
    },
    async settled() { /* 无后台任务需要等待 */ },
  }
}
