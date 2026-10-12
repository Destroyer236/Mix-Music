import { onMounted, onUnmounted, ref } from 'vue'

export function timeGreeting(date: Date): string {
  const hour = date.getHours()
  return hour < 6 || hour >= 22 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
}

export function useTimeGreeting() {
  const greeting = ref(timeGreeting(new Date()))
  let timer: ReturnType<typeof setTimeout> | undefined
  function update() {
    if (timer) clearTimeout(timer)
    const now = new Date()
    greeting.value = timeGreeting(now)
    const next = new Date(now)
    next.setHours(now.getHours() + 1, 0, 0, 0)
    timer = setTimeout(update, next.getTime() - now.getTime() + 50)
  }
  onMounted(() => { update(); window.addEventListener('focus', update) })
  onUnmounted(() => { if (timer) clearTimeout(timer); window.removeEventListener('focus', update) })
  return greeting
}
