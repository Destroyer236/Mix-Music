/** Image-derived color roles. Small OKLab implementation; no runtime library. */
export type RGB = [number, number, number]
export interface WallpaperPalette { seed: string, average: string, dark: boolean }
export const rgb = (hex: string): RGB => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) as RGB
export const hex = (color: RGB) => '#' + color.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')
export const mix = (a: RGB, b: RGB, amount: number): RGB => a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount)) as RGB
const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
export const luminance = (color: RGB) => color.reduce((total, channel, index) => total + linear(channel / 255) * [0.2126, 0.7152, 0.0722][index], 0)
export const contrast = (a: RGB, b: RGB) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
function lab(color: RGB): RGB {
  const [r, g, b] = color.map(channel => linear(channel / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function fromLab([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(v => Math.round(Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055)) * 255)) as RGB
}
export function tone(seed: RGB, lightness: number, chroma: number): RGB {
  const [, a, b] = lab(seed)
  const length = Math.hypot(a, b)
  const amount = length ? Math.min(chroma, length) / length : 0
  return fromLab([lightness, a * amount, b * amount])
}
/** Quantize at most 4,096 pixels. Prefer frequent chromatic colors over white/black. */
export function extractWallpaperPalette(pixels: Uint8ClampedArray): WallpaperPalette {
  const buckets = new Map<number, { count: number, sum: RGB }>()
  const total: RGB = [0, 0, 0]
  let weight = 0
  for (let i = 0; i < pixels.length && i < 64 * 64 * 4; i += 4) {
    const alpha = pixels[i + 3] / 255
    if (alpha < 0.5) continue
    const value: RGB = [pixels[i], pixels[i + 1], pixels[i + 2]]
    const key = (value[0] >> 5) * 64 + (value[1] >> 5) * 8 + (value[2] >> 5)
    const bucket = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] as RGB }
    bucket.count++
    for (let j = 0; j < 3; j++) { bucket.sum[j] += value[j]; total[j] += value[j] * alpha }
    weight += alpha
    buckets.set(key, bucket)
  }
  const average = weight ? total.map(channel => Math.round(channel / weight)) as RGB : [128, 128, 128] as RGB
  let seed = average
  let best = -1
  for (const { count, sum } of buckets.values()) {
    const value = sum.map(channel => Math.round(channel / count)) as RGB
    const [L, a, b] = lab(value)
    const chroma = Math.hypot(a, b)
    // A tiny bright speck should not overpower the picture's main color family.
    if (count < weight * 0.025 || L < 0.15 || L > 0.94) continue
    const score = Math.sqrt(count / weight) * (0.025 + Math.min(chroma, 0.22))
    if (score > best) { best = score; seed = value }
  }
  return { seed: hex(seed), average: hex(average), dark: lab(average)[0] < 0.58 }
}
function readable(value: RGB, backgrounds: RGB[], toward: RGB): RGB {
  for (let step = 0; step < 24 && backgrounds.some(bg => contrast(value, bg) < 4.5); step++) value = mix(value, toward, 0.12)
  return value
}
export function wallpaperColors(palette: WallpaperPalette, dark: boolean) {
  const seed = rgb(palette.seed)
  const panel = tone(seed, dark ? 0.22 : 0.97, 0.014)
  const sidebar = tone(seed, dark ? 0.19 : 0.93, 0.022)
  const bg = tone(seed, dark ? 0.15 : 0.89, 0.025)
  const text = tone(seed, dark ? 0.95 : 0.2, 0.014)
  // Both extremes of any image under an 86% opaque panel, not just average pixels.
  const surfaces = [panel, sidebar].flatMap(surface => [mix([0, 0, 0], surface, 0.86), mix([255, 255, 255], surface, 0.86)])
  const toward: RGB = dark ? [255, 255, 255] : [0, 0, 0]
  const muted = readable(tone(seed, dark ? 0.75 : 0.47, 0.012), surfaces, toward)
  const accent = tone(seed, dark ? 0.76 : 0.57, 0.16)
  const ink = readable(accent, [...surfaces, panel, mix(panel, accent, 0.23)], toward)
  return { bg, panel, sidebar, text, muted, accent, ink }
}
