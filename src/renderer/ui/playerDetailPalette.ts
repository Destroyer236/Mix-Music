import type { ComputedRef, InjectionKey } from 'vue'
import { contrast, hex, mix, rgb, tone, type RGB, type WallpaperPalette } from './wallpaperPalette'

export const playerDetailThemeKey: InjectionKey<ComputedRef<Record<string, string>>> = Symbol('player-detail-theme')

function readable(value: RGB, surfaces: RGB[], toward: RGB): RGB {
  for (let step = 0; step < 32 && surfaces.some(surface => contrast(value, surface) < 4.5); step++) value = mix(value, toward, 0.12)
  return value
}

/** Wallpaper controls surfaces and mode; the cover supplies accents only. */
export function playerDetailColors(background: WallpaperPalette, cover: WallpaperPalette | null, fallbackAccent: string) {
  const dark = background.dark
  const seed = rgb(background.seed)
  const average = rgb(background.average)
  const accentSeed = rgb(cover?.seed ?? fallbackAccent)
  const bg = tone(average, dark ? 0.20 : 0.97, 0.022)
  const glow = tone(seed, dark ? 0.29 : 0.91, 0.035)
  const panel = tone(seed, dark ? 0.24 : 0.98, 0.018)
  const dock = tone(average, dark ? 0.17 : 0.94, 0.024)
  const surfaces = [bg, glow, panel, dock]
  const toward: RGB = dark ? [255, 255, 255] : [0, 0, 0]
  const text = readable(tone(seed, dark ? 0.95 : 0.22, 0.014), surfaces, toward)
  const muted = readable(tone(seed, dark ? 0.75 : 0.48, 0.016), surfaces, toward)
  const accent = tone(accentSeed, dark ? 0.76 : 0.57, 0.13)
  const ink = readable(accent, surfaces, toward)
  const alpha = (color: RGB, opacity: number) => `rgba(${color.join(', ')}, ${opacity})`
  return {
    '--detail-bg': hex(bg),
    '--detail-glow-secondary': hex(glow),
    '--detail-player-bg': hex(dock),
    '--record-base': hex(tone(seed, dark ? 0.20 : 0.90, 0.015)),
    '--record-base-shade': hex(tone(seed, dark ? 0.13 : 0.83, 0.018)),
    '--record-tint': hex(tone(accentSeed, dark ? 0.57 : 0.66, 0.045)),
    '--record-highlight': hex(tone(accentSeed, dark ? 0.76 : 0.85, 0.035)),
    '--record-shade': hex(tone(accentSeed, dark ? 0.37 : 0.42, 0.035)),
    '--modern-bg': hex(bg),
    '--modern-panel': hex(panel),
    '--modern-panel-surface': hex(panel),
    '--modern-text': hex(text),
    '--modern-muted': hex(muted),
    '--modern-accent': hex(accent),
    '--modern-accent-ink': hex(ink),
    '--modern-accent-contrast': contrast(accent, [255, 255, 255]) >= contrast(accent, [0, 0, 0]) ? '#ffffff' : '#000000',
    '--modern-accent-soft': hex(mix(panel, accent, dark ? 0.17 : 0.10)),
    '--modern-border': alpha(text, dark ? 0.14 : 0.12),
    '--modern-hover': alpha(text, dark ? 0.08 : 0.06),
    'color-scheme': dark ? 'dark' : 'light',
  }
}
