import { ipcRenderer } from 'electron'
import { ref, shallowRef } from 'vue'

interface MiguPhoneLoginView {
  phone: string
  code: string
  sending: boolean
  submitting: boolean
  sent: boolean
  error: string
  notice: string
}
export const miguPhoneLogin = shallowRef<MiguPhoneLoginView | null>(null)
export const miguCountdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | undefined

const stopCountdown = () => { clearInterval(countdownTimer); countdownTimer = undefined; miguCountdown.value = 0 }
const describe = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '操作失败，请稍后重试'

export function closeMiguPhoneLogin() {
  stopCountdown()
  miguPhoneLogin.value = null
}

export function startMiguPhoneLogin() {
  stopCountdown()
  miguPhoneLogin.value = { phone: '', code: '', sending: false, submitting: false, sent: false, error: '', notice: '' }
}

export async function sendMiguPhoneCode() {
  const view = miguPhoneLogin.value
  if (!view || view.sending || miguCountdown.value > 0) return
  if (!/^1[3-9]\d{9}$/.test(view.phone)) { miguPhoneLogin.value = { ...view, error: '请输入正确的手机号' }; return }
  miguPhoneLogin.value = { ...view, sending: true, error: '', notice: '' }
  try {
    const result = await ipcRenderer.invoke('platform_migu_phone_send', { phone: view.phone }) as { ok: boolean, message: string }
    const current = miguPhoneLogin.value
    if (!current) return
    if (result.ok) {
      miguPhoneLogin.value = { ...current, sending: false, sent: true, notice: result.message }
      miguCountdown.value = 60
      countdownTimer = setInterval(() => {
        if (miguCountdown.value <= 1) stopCountdown()
        else --miguCountdown.value
      }, 1000)
    } else miguPhoneLogin.value = { ...current, sending: false, error: result.message }
  } catch (error) {
    if (miguPhoneLogin.value) miguPhoneLogin.value = { ...miguPhoneLogin.value, sending: false, error: describe(error) }
  }
}

export async function submitMiguPhoneLogin() {
  const view = miguPhoneLogin.value
  if (!view || view.submitting) return
  if (!/^1[3-9]\d{9}$/.test(view.phone)) { miguPhoneLogin.value = { ...view, error: '请输入正确的手机号' }; return }
  if (!/^\d{4,8}$/.test(view.code)) { miguPhoneLogin.value = { ...view, error: '请输入短信验证码' }; return }
  miguPhoneLogin.value = { ...view, submitting: true, error: '', notice: '' }
  try {
    const result = await ipcRenderer.invoke('platform_migu_phone_login', { phone: view.phone, code: view.code }) as { ok: boolean, message: string }
    const current = miguPhoneLogin.value
    if (!current) return
    if (result.ok) {
      miguPhoneLogin.value = { ...current, submitting: false, notice: result.message }
      setTimeout(() => { if (miguPhoneLogin.value?.notice === result.message) closeMiguPhoneLogin() }, 1200)
    } else miguPhoneLogin.value = { ...current, submitting: false, error: result.message }
  } catch (error) {
    if (miguPhoneLogin.value) miguPhoneLogin.value = { ...miguPhoneLogin.value, submitting: false, error: describe(error) }
  }
}
