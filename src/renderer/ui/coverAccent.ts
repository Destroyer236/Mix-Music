// 跟随封面点缀色：监听当前曲目封面提取主色写入 coverAccent（hex）。
// 提取算法对照 EchoMusic utils/color.ts 的 extractImageColor：先按 HSL 过滤
// 近黑/近白/灰度像素，再按 饱和度×亮度评分 做色相 18 桶投票，取最高权重桶的
// 加权均值——避免大面积低饱和主体（如黑西装）压过鲜艳点睛色（如红绸带）。
// 供 useAppearance 在 accentSource === 'cover' 时作为有效点缀色；无封面、取色
// 失败或全图过灰时保持空串，由调用方回退到预设颜色。
import { ref, watch } from 'vue'
import { musicInfo } from '@renderer/store/player/state'
import { hex as rgbToHex, rgb as hexToRgb } from '@renderer/ui/wallpaperPalette'

export const coverAccent = ref('')

const cache = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | undefined
let loadSeq = 0

interface Hsl { h: number, s: number, l: number }

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const nr = r / 255
  const ng = g / 255
  const nb = b / 255
  const max = Math.max(nr, ng, nb)
  const min = Math.min(nr, ng, nb)
  const delta = max - min
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (delta !== 0) {
    if (max === nr) h = ((ng - nb) / delta) % 6
    else if (max === ng) h = (nb - nr) / delta + 2
    else h = (nr - ng) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const base = h / 360
  return [channel(base + 1 / 3), channel(base), channel(base - 1 / 3)].map(v => Math.round(v * 255)) as [number, number, number]
}

// EchoMusic 同款评分提取；全图过灰（均值饱和度 < 0.15）时返回 null 走回退。
function extract(img: HTMLImageElement): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  try {
    context.drawImage(img, 0, 0, 64, 64)
    const { data } = context.getImageData(0, 0, 64, 64)
    const BUCKET_COUNT = 18
    const buckets = Array.from({ length: BUCKET_COUNT }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
    let totalSat = 0
    let sampleCount = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue
      const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2])
      if (l < 0.15 || l > 0.92 || s < 0.18) continue
      sampleCount++
      totalSat += s
      const score = s * Math.max(0.15, 1 - Math.abs(l - 0.5) * 1.2)
      const bucket = buckets[Math.min(BUCKET_COUNT - 1, Math.floor(h / (360 / BUCKET_COUNT)))]
      bucket.weight += score
      bucket.r += data[i] * score
      bucket.g += data[i + 1] * score
      bucket.b += data[i + 2] * score
    }
    // 画布被跨域图片污染时 getImageData 直接抛错——由外层 try 捕获走回退。
    if (sampleCount === 0 || totalSat / sampleCount < 0.15) return null
    let best = buckets[0]
    for (const bucket of buckets) if (bucket.weight > best.weight) best = bucket
    if (best.weight <= 0) return null
    return rgbToHex([Math.round(best.r / best.weight), Math.round(best.g / best.weight), Math.round(best.b / best.weight)] as [number, number, number])
  } catch {
    return null
  }
}

// 对照 EchoMusic normalizeAccent：把封面原色规整到当前明暗模式下可用的
// 饱和度/亮度区间；近乎灰度时返回空串，由调用方回退预设颜色。
export function normalizeAccentColor(value: string, dark: boolean): string {
  if (!/^#[\da-f]{6}$/i.test(value)) return ''
  const [r, g, b] = hexToRgb(value)
  const { h, s, l } = rgbToHsl(r, g, b)
  if (s < 0.08) return ''
  const nextS = dark ? Math.min(0.85, Math.max(0.45, s)) : Math.min(0.9, Math.max(0.55, s))
  const nextL = dark ? Math.min(0.72, Math.max(0.55, l)) : Math.min(0.55, Math.max(0.42, l))
  return rgbToHex(hslToRgb(h, nextS, nextL))
}

async function update(pic: string) {
  const seq = ++loadSeq
  let value = ''
  if (pic) {
    const cached = cache.get(pic)
    if (cached !== undefined) {
      value = cached
    } else {
      const img = await new Promise<HTMLImageElement | null>(resolve => {
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.referrerPolicy = 'no-referrer'
        const timeout = setTimeout(() => { resolve(null) }, 5000)
        image.onload = () => { clearTimeout(timeout); resolve(image) }
        image.onerror = () => { clearTimeout(timeout); resolve(null) }
        image.src = pic
      })
      if (seq !== loadSeq) return
      value = (img && extract(img)) ?? ''
      if (cache.size > 24) cache.clear()
      cache.set(pic, value)
    }
  }
  if (seq !== loadSeq) return
  coverAccent.value = value
}

export function useCoverAccent() {
  watch(() => musicInfo.pic ?? '', pic => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void update(pic) }, 180)
  }, { immediate: true })
}
