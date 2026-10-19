import { ipcRenderer } from 'electron'
import { shallowRef } from 'vue'

type Status = 'loading' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error'
interface LoginView { flowId: string, image: string, expiresAt: number, status: Status, error: string }
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
    const poll = async() => {
      const view = qishuiLogin.value
      if (current !== generation || !view) return
      if (Date.now() >= view.expiresAt) { qishuiLogin.value = { ...view, status: 'expired', error: '' }; return }
      try {
        const result = await ipcRenderer.invoke('platform_qishui_login_check', { flowId: view.flowId }) as { status: 'waiting' | 'scanned' | 'confirmed' | 'expired' }
        if (current !== generation || !qishuiLogin.value) return
        qishuiLogin.value = { ...view, status: result.status, error: '' }
        if (result.status === 'confirmed') {
          timer = setTimeout(() => { if (current === generation) closeQishuiLogin() }, 1200)
          return
        }
        if (result.status !== 'expired') timer = setTimeout(() => { void poll() }, 2500)
      } catch (error) {
        if (current !== generation || !qishuiLogin.value) return
        const message = describe(error)
        if (/^汽水音乐登录(?:请求超时|连接失败)/.test(message)) {
          qishuiLogin.value = { ...view, error: '连接暂时中断，正在重试…' }
          timer = setTimeout(() => { void poll() }, 2500)
        } else qishuiLogin.value = { ...view, status: 'error', error: message }
      }
    }
    timer = setTimeout(() => { void poll() }, 2500)
  } catch (error) {
    if (current === generation && qishuiLogin.value) qishuiLogin.value = { ...qishuiLogin.value, status: 'error', error: describe(error) }
  }
}
