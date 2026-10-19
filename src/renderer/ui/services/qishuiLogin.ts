import { ipcRenderer } from 'electron'
import { shallowRef } from 'vue'

type Status = 'loading' | 'waiting' | 'scanned' | 'verifying' | 'confirmed' | 'expired' | 'error'
interface LoginView { flowId: string, image: string, expiresAt: number, status: Status, error: string, retryAt?: number }
export const qishuiLogin = shallowRef<LoginView | null>(null)
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
const describe = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '汽水登录失败，请重试'

export function closeQishuiLogin() {
  ++generation
  clearTimeout(timer)
  const previous = qishuiLogin.value
  qishuiLogin.value = null
  if (previous?.flowId) void ipcRenderer.invoke('platform_qishui_login_cancel', { flowId: previous.flowId }).catch(() => {})
}

export async function startQishuiLogin() {
  closeQishuiLogin()
  const current = generation
  qishuiLogin.value = { flowId: '', image: '', expiresAt: 0, status: 'loading', error: '' }
  try {
    const response = await ipcRenderer.invoke('platform_qishui_login_start') as Omit<LoginView, 'error'>
    if (current !== generation) {
      void ipcRenderer.invoke('platform_qishui_login_cancel', { flowId: response.flowId }).catch(() => {})
      return
    }
    qishuiLogin.value = { ...response, error: '' }
    const verification = { expiresAt: undefined as number | undefined }
    const schedulePoll = (view: LoginView) => {
      const expiresAt = view.status === 'verifying' ? verification.expiresAt : view.expiresAt
      const delay = Math.max(2500, (view.retryAt ?? 0) - Date.now())
      timer = setTimeout(() => { void poll() }, expiresAt === undefined ? delay : Math.min(delay, Math.max(0, expiresAt - Date.now())))
    }
    const poll = async() => {
      const view = qishuiLogin.value
      if (current !== generation || !view) return
      // Do not reuse the QR deadline while the official verification window is active.
      const expiresAt = view.status === 'verifying' ? verification.expiresAt : view.expiresAt
      if (expiresAt !== undefined && Date.now() >= expiresAt) { qishuiLogin.value = { ...view, status: 'expired', error: '', retryAt: undefined }; return }
      if (view.retryAt !== undefined && Date.now() < view.retryAt) { schedulePoll(view); return }
      try {
        const result = await ipcRenderer.invoke('platform_qishui_login_check', { flowId: view.flowId }) as { status: 'waiting' | 'scanned' | 'verifying' | 'confirmed' | 'expired', expiresAt?: number, retryAt?: number }
        if (current !== generation || !qishuiLogin.value) return
        if (result.status === 'verifying' && result.expiresAt !== undefined) verification.expiresAt = result.expiresAt
        const retryAt = Number.isFinite(result.retryAt) && result.retryAt! > Date.now() ? result.retryAt : undefined
        qishuiLogin.value = { ...view, status: result.status, expiresAt: result.expiresAt ?? view.expiresAt, error: '', retryAt }
        if (result.status === 'confirmed') {
          timer = setTimeout(() => { if (current === generation) closeQishuiLogin() }, 1200)
          return
        }
        if (result.status !== 'expired') schedulePoll(qishuiLogin.value)
      } catch (error) {
        if (current !== generation || !qishuiLogin.value) return
        const message = describe(error)
        if (/^汽水音乐登录(?:请求超时|连接失败)/.test(message)) {
          qishuiLogin.value = { ...view, error: '连接暂时中断，正在重试…' }
          schedulePoll(qishuiLogin.value)
        } else qishuiLogin.value = { ...view, status: 'error', error: message, retryAt: undefined }
      }
    }
    schedulePoll(qishuiLogin.value)
  } catch (error) {
    if (current === generation && qishuiLogin.value) qishuiLogin.value = { ...qishuiLogin.value, status: 'error', error: describe(error) }
  }
}
