// Source scripts often return a valid URL without saying it is a preview.
// Read media metadata before caching it as a complete recording.
const durations = new Map<string, { value: number, until: number }>()
const pending = new Map<string, Promise<number>>()

export const isTruncatedStream = (interval: string | null | undefined, actual: number): boolean => {
  const parts = (interval ?? '').split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || !parts.every(Number.isFinite)) return false
  const expected = parts.reduce((total, part) => total * 60 + part, 0)
  return expected > 0 && actual > 0 && expected - actual > Math.max(10, expected * 0.08)
}

export const readStreamDuration = async(url: string): Promise<number> => {
  const cached = durations.get(url)
  if (cached && cached.until > Date.now()) return cached.value
  let request = pending.get(url)
  if (!request) {
    request = new Promise<number>((resolve, reject) => {
      const audio = new Audio()
      audio.preload = 'metadata'
      audio.muted = true
      audio.crossOrigin = 'anonymous'
      const release = () => {
        clearTimeout(timer)
        audio.onloadedmetadata = audio.ondurationchange = audio.onerror = null
        audio.removeAttribute('src')
        audio.load()
      }
      const timer = setTimeout(() => { release(); reject(new Error('音频时长校验超时')) }, 8000)
      const loaded = () => {
        const duration = audio.duration
        if (!Number.isFinite(duration) || duration <= 0) return
        release()
        if (durations.size > 100) durations.clear()
        durations.set(url, { value: duration, until: Date.now() + 240000 })
        resolve(duration)
      }
      audio.onloadedmetadata = audio.ondurationchange = loaded
      audio.onerror = () => { release(); reject(new Error('音频地址无法加载')) }
      audio.src = url
      audio.load()
    })
    pending.set(url, request)
  }
  try { return await request } finally { if (pending.get(url) === request) pending.delete(url) }
}
