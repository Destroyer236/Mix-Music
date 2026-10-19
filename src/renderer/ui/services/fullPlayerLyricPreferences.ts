import { reactive, watch } from 'vue'

export type LyricAlignment = 'left' | 'center' | 'right'

export const fullPlayerLyricPreferences = reactive({ fontSize: 32, lineSpacing: 18, align: 'left' as LyricAlignment, blur: true, animation: true })

const storageKey = 'linkline.full-player-lyrics.v1'
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<typeof fullPlayerLyricPreferences>
  if (Number.isFinite(saved.fontSize)) fullPlayerLyricPreferences.fontSize = Math.max(24, Math.min(58, Number(saved.fontSize)))
  if (Number.isFinite(saved.lineSpacing)) fullPlayerLyricPreferences.lineSpacing = Math.max(8, Math.min(40, Number(saved.lineSpacing)))
  if (saved.align && ['left', 'center', 'right'].includes(saved.align)) fullPlayerLyricPreferences.align = saved.align
  if (typeof saved.blur === 'boolean') fullPlayerLyricPreferences.blur = saved.blur
  if (typeof saved.animation === 'boolean') fullPlayerLyricPreferences.animation = saved.animation
} catch { /* Defaults also work when local storage is unavailable. */ }

watch(fullPlayerLyricPreferences, value => {
  try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* Keep the current session preference. */ }
}, { deep: true, flush: 'sync' })
