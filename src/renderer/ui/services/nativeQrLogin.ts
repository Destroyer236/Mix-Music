import { ipcRenderer } from 'electron'
import { shallowRef } from 'vue'

export type QrLoginPlatform = 'qq' | 'netease' | 'kugouConcept'
type Status = 'loading' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error'
interface LoginView { platform: QrLoginPlatform, flowId: string, image: string, expiresAt: number, status: Status, error: string }
type StartResult = Pick<LoginView, 'flowId' | 'image' | 'expiresAt'> & { status: 'waiting' }
type CheckResult = Pick<LoginView, 'flowId'> & { status: 'waiting' | 'scanned' | 'confirmed' | 'expired' }
export const nativeQrLogin = shallowRef<LoginView | null>(null)
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
const describe = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '登录失败，请刷新二维码后重试'

// 酷狗概念版有独立的二维码协议，其余平台共用 native 通道。
const channels = (platform: QrLoginPlatform) => platform === 'kugouConcept'
  ? { start: 'platform_kugou_login_start', check: 'platform_kugou_login_check', cancel: 'platform_kugou_login_cancel' }
  : { start: 'platform_native_login_start', check: 'platform_native_login_check', cancel: 'platform_native_login_cancel' }

const cancel = (platform: QrLoginPlatform, flowId?: string) => {
  const channel = channels(platform).cancel
  void ipcRenderer.invoke(channel, platform === 'kugouConcept' ? (flowId ? { flowId } : {}) : { platform, ...(flowId ? { flowId } : {}) }).catch(() => {})
}

export function closeNativeQrLogin() {
  ++generation
  clearTimeout(timer)
  timer = undefined
  const previous = nativeQrLogin.value
  nativeQrLogin.value = null
  if (previous) cancel(previous.platform, previous.flowId)
}

export async function startNativeQrLogin(platform: QrLoginPlatform) {
  closeNativeQrLogin()
  const current = generation
  nativeQrLogin.value = { platform, flowId: '', image: '', expiresAt: 0, status: 'loading', error: '' }
  try {
    const response = await ipcRenderer.invoke(channels(platform).start, platform === 'kugouConcept' ? {} : { platform }) as StartResult
    if (current !== generation) { cancel(platform, response.flowId); return }
    nativeQrLogin.value = { ...response, platform, error: '' }
    const poll = async() => {
      const view = nativeQrLogin.value
      if (current !== generation || !view) return
      if (Date.now() >= view.expiresAt) { nativeQrLogin.value = { ...view, status: 'expired' }; return }
      try {
        const result = await ipcRenderer.invoke(channels(platform).check, platform === 'kugouConcept' ? { flowId: view.flowId } : { platform, flowId: view.flowId }) as CheckResult
        if (current !== generation || !nativeQrLogin.value) return
        nativeQrLogin.value = { ...view, status: result.status }
        if (result.status === 'confirmed') {
          timer = setTimeout(() => { if (current === generation) closeNativeQrLogin() }, 1200)
        } else if (result.status !== 'expired') timer = setTimeout(() => { void poll() }, 2500)
      } catch (error) {
        if (current === generation && nativeQrLogin.value) nativeQrLogin.value = { ...view, status: 'error', error: describe(error) }
      }
    }
    timer = setTimeout(() => { void poll() }, 2500)
  } catch (error) {
    if (current === generation && nativeQrLogin.value) nativeQrLogin.value = { ...nativeQrLogin.value, status: 'error', error: describe(error) }
  }
}
