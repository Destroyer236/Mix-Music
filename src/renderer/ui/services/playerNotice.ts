import { ref } from 'vue'

export const playerNotice = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
export function showPlayerNotice(message: string) {
  clearTimeout(timer)
  playerNotice.value = message
  timer = setTimeout(() => { playerNotice.value = '' }, 3200)
}
