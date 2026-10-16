import { ipcRenderer } from 'electron'
import { shallowRef } from 'vue'

type Status = 'loading' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error'
interface LoginView { flowId: string, image: string, expiresAt: number, status: Status, error: string }
export const bodianLogin = shallowRef<LoginView | null>(null)
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
const describe = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '波点音乐登录失败，请重试'

export function closeBodianLogin() {
  ++generation
  clearTimeout(timer)
  const previous = bodianLogin.value
  bodianLogin.value = null
  if (previous?.flowId) void ipcRenderer.invoke('platform_bodian_login_cancel', { flowId: previous.flowId }).catch(() => {})
}

export async function startBodianLogin() {
  closeBodianLogin()
  const current = generation
  bodianLogin.value = { flowId: '', image: '', expiresAt: 0, status: 'loading', error: '' }
  try {
    const response = await ipcRenderer.invoke('platform_bodian_login_start') as Omit<LoginView, 'error'>
    if (current !== generation) {
      void ipcRenderer.invoke('platform_bodian_login_cancel', { flowId: response.flowId }).catch(() => {})
      return
    }
    bodianLogin.value = { ...response, error: '' }
    const poll = async() => {
      const view = bodianLogin.value
      if (current !== generation || !view) return
      if (Date.now() >= view.expiresAt) { bodianLogin.value = { ...view, status: 'expired' }; return }
      try {
        const result = await ipcRenderer.invoke('platform_bodian_login_check', { flowId: view.flowId }) as { status: 'waiting' | 'scanned' | 'confirmed' | 'expired' }
        if (current !== generation || !bodianLogin.value) return
        bodianLogin.value = { ...view, status: result.status }
        if (result.status === 'confirmed') {
          timer = setTimeout(() => { if (current === generation) closeBodianLogin() }, 1200)
          return
        }
        if (result.status !== 'expired') timer = setTimeout(() => { void poll() }, 2500)
      } catch (error) {
        if (current === generation && bodianLogin.value) bodianLogin.value = { ...view, status: 'error', error: describe(error) }
      }
    }
    timer = setTimeout(() => { void poll() }, 2500)
  } catch (error) {
    if (current === generation && bodianLogin.value) bodianLogin.value = { ...bodianLogin.value, status: 'error', error: describe(error) }
  }
}
