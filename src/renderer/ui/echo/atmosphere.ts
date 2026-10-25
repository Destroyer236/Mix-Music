// 封面取色氛围层：EchoMusic 皮肤下监听当前曲目封面，提取主色并压成低饱和
// 氛围色写入 --echo-atmosphere-rgb（echo-skin.less 的背景渐变消费它）。
// 提取失败（跨域受限、加载失败）时回退到点缀色同相染色。
import { watch } from 'vue'
import { appearance, resolvedAppearanceMode } from '@renderer/composables/useAppearance'
import { coverAccent, normalizeAccentColor } from '@renderer/ui/coverAccent'
import { musicInfo } from '@renderer/store/player/state'
import { wallpaper } from '@renderer/ui/useWallpaper'
import { extractWallpaperPalette, rgb, tone } from '@renderer/ui/wallpaperPalette'

const cache = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | undefined
let loadSeq = 0

function fallbackAtmosphere(dark: boolean): string {
  return tone(rgb(appearance.accent), dark ? 0.56 : 0.88, 0.065).join(', ')
}

// 跟随封面模式下氛围色与点缀色同源（对照 EchoMusic：atmosphere 由
// getAccentPalette(coverColor) 派生），避免两套取色算法给出不同色相。
function coverModeAtmosphere(dark: boolean): string | null {
  if (appearance.accentSource !== 'cover') return null
  const base = coverAccent.value ? normalizeAccentColor(coverAccent.value, dark) : ''
  return tone(rgb(base || appearance.accent), dark ? 0.56 : 0.88, 0.065).join(', ')
}

function extract(img: HTMLImageElement, dark: boolean): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  try {
    context.drawImage(img, 0, 0, 64, 64)
    const { data } = context.getImageData(0, 0, 64, 64)
    const { seed } = extractWallpaperPalette(data)
    return tone(rgb(seed), dark ? 0.56 : 0.88, 0.065).join(', ')
  } catch {
    // 画布被跨域图片污染时 getImageData 直接抛错——走兜底色。
    return null
  }
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => { resolve(img) }
    img.onerror = () => { resolve(null) }
    img.src = url
  })
}

async function update(pic: string, dark: boolean) {
  const seq = ++loadSeq
  const unified = coverModeAtmosphere(dark)
  let value = unified ?? ''
  if (unified === null) {
    value = fallbackAtmosphere(dark)
    if (pic) {
      const key = `${pic}|${dark ? 'd' : 'l'}`
      const cached = cache.get(key)
      if (cached) {
        value = cached
      } else {
        const img = await loadImage(pic)
        // 只应用最后一次请求的结果，快速切歌时旧请求作废。
        if (img && seq === loadSeq) {
          value = extract(img, dark) ?? fallbackAtmosphere(dark)
          if (cache.size > 24) cache.clear()
          cache.set(key, value)
        }
      }
    }
  }
  if (seq !== loadSeq) return
  document.documentElement.style.setProperty('--echo-atmosphere-rgb', value)
}

export function useAtmosphere() {
  watch(
    () => [appearance.skin, resolvedAppearanceMode.value === 'dark', appearance.mode, appearance.accentSource, coverAccent.value, appearance.accent, musicInfo.pic ?? '', wallpaper.value] as const,
    ([skin, dark, mode, , , , pic, wall]) => {
      if (timer) clearTimeout(timer)
      if (skin !== 'echo' || (mode === 'custom' && wall)) {
        loadSeq++
        document.documentElement.style.setProperty('--echo-atmosphere-rgb', fallbackAtmosphere(dark))
        return
      }
      // 封面切换 180ms 防抖，与 EchoMusic 的取色节奏一致。
      timer = setTimeout(() => { void update(pic, dark) }, 180)
    },
    { immediate: true },
  )
}
