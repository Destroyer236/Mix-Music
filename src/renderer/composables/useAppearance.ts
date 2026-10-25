import { computed, reactive, ref, watch } from 'vue'
import { initializeWallpaper, wallpaper, wallpaperUrl } from '@renderer/ui/useWallpaper'
import { tone, wallpaperColors } from '@renderer/ui/wallpaperPalette'
import { coverAccent, normalizeAccentColor } from '@renderer/ui/coverAccent'

export interface Appearance {
  mode: 'light' | 'dark' | 'system' | 'custom'
  customTone: 'auto' | 'light' | 'dark'
  accent: string
  // 主题色来源（对照 EchoMusic AccentSource）：跟随封面取当前曲目封面主色，
  // 预设主题用下方色板，自定义用取色器；cover/custom 都落在 accent 存储上。
  accentSource: 'preset' | 'cover' | 'custom'
  radius: number
  panelGap: number
  showShadows: boolean
  showScrollbars: boolean
  density: 'comfortable' | 'compact'
  showExplore: boolean
  skin: 'linkline' | 'echo'
}

const STORAGE_KEY = 'lx-modern-appearance-v1'
// Visual defaults for Mix Music. Saved user
// preferences are validated against these and always win.
const defaults: Appearance = {
  mode: 'light',
  customTone: 'auto',
  accent: '#00eb81',
  accentSource: 'preset',
  radius: 8,
  panelGap: 8,
  showShadows: false,
  showScrollbars: false,
  density: 'comfortable',
  showExplore: true,
  skin: 'linkline',
}

/** Keep old or malformed saved preferences from breaking the renderer. */
export function validateAppearance(value: unknown): Appearance {
  const input = value && typeof value === 'object' ? value as Partial<Appearance> : {}
  return {
    mode: input.mode === 'dark' || input.mode === 'system' || input.mode === 'custom' ? input.mode : 'light',
    customTone: input.customTone === 'dark' || input.customTone === 'light' ? input.customTone : 'auto',
    accent: typeof input.accent === 'string' && /^#[\da-f]{6}$/i.test(input.accent) ? input.accent.toLowerCase() : defaults.accent,
    accentSource: input.accentSource === 'cover' || input.accentSource === 'custom' ? input.accentSource : 'preset',
    radius: typeof input.radius === 'number' && Number.isFinite(input.radius) ? Math.min(32, Math.max(0, Math.round(input.radius))) : defaults.radius,
    panelGap: typeof input.panelGap === 'number' && Number.isFinite(input.panelGap) ? Math.min(32, Math.max(0, Math.round(input.panelGap))) : defaults.panelGap,
    showShadows: typeof input.showShadows === 'boolean' ? input.showShadows : defaults.showShadows,
    showScrollbars: typeof input.showScrollbars === 'boolean' ? input.showScrollbars : defaults.showScrollbars,
    density: input.density === 'compact' ? 'compact' : 'comfortable',
    showExplore: typeof input.showExplore === 'boolean' ? input.showExplore : defaults.showExplore,
    skin: input.skin === 'echo' ? 'echo' : 'linkline',
  }
}

function readAppearance(): Appearance {
  try {
    return validateAppearance(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return { ...defaults }
  }
}

export const appearance = reactive<Appearance>(readAppearance())
export const appearancePanelOpen = ref(false)
const systemDark = ref(false)
export const resolvedAppearanceMode = computed<'light' | 'dark'>(() => {
  if (appearance.mode === 'system') return systemDark.value ? 'dark' : 'light'
  if (appearance.mode === 'custom') return appearance.customTone === 'auto' ? (wallpaper.value?.palette.dark ? 'dark' : 'light') : appearance.customTone
  return appearance.mode
})
export function toggleAppearanceMode() {
  const next = resolvedAppearanceMode.value === 'light' ? 'dark' : 'light'
  if (appearance.mode === 'custom') appearance.customTone = next
  else appearance.mode = next
}

type RGB = [number, number, number]
const rgb = (hex: string): RGB => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) as RGB
const mix = (first: RGB, second: RGB, amount: number): RGB => first.map((channel, index) => Math.round(channel + (second[index] - channel) * amount)) as RGB
const color = (value: RGB) => `rgb(${value.join(', ')})`
const alpha = (value: RGB, opacity: number) => `rgba(${value.join(', ')}, ${opacity})`
const luminance = (value: RGB) => value.map(channel => {
  const normalized = channel / 255
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
}).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
const contrast = (first: RGB, second: RGB) => (Math.max(luminance(first), luminance(second)) + 0.05) / (Math.min(luminance(first), luminance(second)) + 0.05)

function readableAccent(accent: RGB, panel: RGB, text: RGB): RGB {
  let value = accent
  for (let step = 0; contrast(value, panel) < 4.5 && step < 10; step++) value = mix(value, text, 0.18)
  return value
}

function applyAppearance() {
  const root = document.documentElement
  const dark = resolvedAppearanceMode.value === 'dark'
  const echo = appearance.skin === 'echo'
  const custom = appearance.mode === 'custom' && wallpaper.value && wallpaperUrl.value ? wallpaperColors(wallpaper.value.palette, dark) : null
  // EchoMusic 皮肤走 EchoMusic 的中性色板；自定义壁纸模式仍然优先。
  // echo：窗口底色保持比面板更深的 Shell 色，主面板/播放栏作为浮岛被衬出来
  // （对照 EchoMusic neutralThemePalette：shell #171718 / main #29292b）
  const bg = custom?.bg ?? rgb(echo ? (dark ? '#171718' : '#f6f6f6') : dark ? '#17191e' : '#f0f0f0')
  // 跟随封面模式：封面主色经 normalizeAccentColor 规整到当前明暗模式的可用
  // 区间（对照 EchoMusic normalizeAccent），取色不可用/过灰时回退到已存颜色。
  const accent = custom?.accent ?? rgb(appearance.accentSource === 'cover' && coverAccent.value ? normalizeAccentColor(coverAccent.value, dark) || appearance.accent : appearance.accent)
  const atmosphereSeed = tone(accent, dark ? 0.56 : 0.88, 0.065)
  // echo：面板保持中性黑，主题色只通过顶部氛围渐变（echo-skin.less 的
  // background-image）与点缀元素出现——整面染色会失去 EchoMusic 的黑底观感
  const panel = custom?.panel ?? rgb(echo ? (dark ? '#29292b' : '#ffffff') : dark ? '#22252c' : '#f6f6f6')
  const sidebar = custom?.sidebar ?? (echo ? rgb(dark ? '#1d1d1f' : '#f2f2f3') : dark ? rgb('#1c1f26') : panel)
  const text = custom?.text ?? rgb(echo ? (dark ? '#f5f5f6' : '#0b0b0c') : dark ? '#eceef3' : '#252832')
  const muted = custom?.muted ?? rgb(echo ? (dark ? '#bcbcbc' : '#666666') : dark ? '#adb3c1' : '#626b7a')
  const ink = custom?.ink ?? readableAccent(accent, panel, text)
  const soft = mix(panel, accent, echo ? (dark ? 0.18 : 0.12) : dark ? 0.17 : 0.1)
  const hover = mix(panel, text, dark ? 0.06 : 0.04)
  const border = echo ? color(rgb(dark ? '#444446' : '#dedede')) : alpha(text, dark ? 0.1 : 0.08)
  const gap = echo ? Math.max(10, appearance.panelGap) : appearance.panelGap
  const tokens: Record<string, string> = {
    '--modern-bg': color(bg),
    '--modern-panel': color(panel),
    '--modern-sidebar': color(sidebar),
    '--modern-hero-bg': custom ? color(mix(panel, accent, 0.12)) : echo ? color(mix(panel, accent, dark ? 0.1 : 0.08)) : dark ? '#29312c' : '#e9efea',
    '--modern-wallpaper-image': custom ? `url(${JSON.stringify(wallpaperUrl.value)})` : 'none',
    '--modern-panel-surface': custom ? alpha(panel, 0.86) : color(panel),
    '--modern-sidebar-surface': custom ? alpha(sidebar, 0.9) : color(sidebar),
    '--modern-text': color(text),
    '--modern-muted': color(muted),
    '--modern-border': border,
    '--modern-accent': color(accent),
    '--modern-accent-ink': color(ink),
    '--modern-accent-contrast': custom ? (contrast(accent, [255, 255, 255]) >= contrast(accent, [0, 0, 0]) ? '#ffffff' : '#000000') : contrast(accent, [255, 255, 255]) >= contrast(accent, [20, 25, 23]) ? '#ffffff' : '#141917',
    '--modern-accent-soft': color(soft),
    '--modern-hover': color(hover),
    '--modern-radius': `${appearance.radius}px`,
    '--modern-radius-small': `${Math.round(appearance.radius * 0.6)}px`,
    '--modern-panel-gap': `${gap}px`,
    '--modern-shadow': appearance.showShadows ? (dark ? '0 8px 32px rgba(0, 0, 0, 0.18)' : '0 4px 24px rgba(28, 42, 34, 0.04)') : 'none',
    '--modern-row-height': appearance.density === 'compact' ? '36px' : '46px',
    '--modern-gap': appearance.density === 'compact' ? '10px' : '16px',
    '--modern-overlay': dark ? 'rgba(0, 0, 0, 0.46)' : 'rgba(34, 42, 38, 0.18)',
    '--color-app-background': color(bg),
    '--color-main-background': color(panel),
    '--color-content-background': color(panel),
    '--color-nav-font': color(text),
    '--color-font': color(text),
    '--color-font-label': color(muted),
    '--color-label': color(muted),
    '--color-primary': color(ink),
    '--color-primary-theme': color(accent),
    '--color-primary-font': color(ink),
    '--color-primary-font-hover': color(mix(ink, text, 0.18)),
    '--color-primary-font-active': color(text),
    '--color-primary-background': color(soft),
    '--color-primary-background-hover': color(hover),
    '--color-primary-background-active': color(mix(panel, accent, 0.19)),
    '--color-button-font': color(text),
    '--color-button-font-selected': color(ink),
    '--color-button-background': color(soft),
    '--color-button-background-selected': color(mix(panel, accent, 0.19)),
    '--color-button-background-hover': color(mix(panel, accent, 0.15)),
    '--color-button-background-active': color(mix(panel, accent, 0.23)),
    '--color-list-header-border-bottom': `1px solid ${border}`,
    '--color-badge-primary': color(ink),
    '--background-image': 'none',
  }

  // EchoMusic 皮肤的专属令牌：固定圆角阶梯、控件几何、氛围渐变兜底色。
  // echo-skin.less 只消费这些变量，派生公式与 Mix Music 原版解耦。
  // 必须是完整颜色值而非 RGB 三元组：color-mix(in srgb, var(--echo-content-tone) N%, …)
  // 会把 var 原样替换进表达式，三元组会导致 color-mix 非法而静默透明。
  tokens['--echo-content-tone'] = echo ? (dark ? '#ffffff' : '#0b0b0c') : '#000000'
  tokens['--echo-radius-control'] = '6px'
  tokens['--echo-radius-card'] = '10px'
  tokens['--echo-radius-dialog'] = '12px'
  tokens['--echo-control-height'] = '36px'
  tokens['--echo-row-height'] = appearance.density === 'compact' ? '54px' : '62px'
  tokens['--echo-player-height'] = '88px'
  tokens['--echo-shell-inset'] = '8px'
  tokens['--echo-shadow-card'] = dark ? '0 1px 3px rgba(0, 0, 0, .28)' : '0 1px 3px rgba(0, 0, 0, .10)'
  tokens['--echo-shadow-elevated'] = dark
    ? '0 12px 32px rgba(0, 0, 0, .36), 0 2px 6px rgba(0, 0, 0, .18)'
    : '0 12px 32px rgba(0, 0, 0, .12), 0 2px 6px rgba(0, 0, 0, .06)'
  tokens['--echo-motion-enter'] = 'cubic-bezier(0.16, 1, 0.3, 1)'
  tokens['--echo-motion-standard'] = 'cubic-bezier(0.2, 0, 0, 1)'
  // 氛围色兜底：把点缀色压成低饱和同相色；atmosphere.ts 会用真实封面色覆盖。
  tokens['--echo-atmosphere-rgb'] = atmosphereSeed.join(', ')

  // Original components use hundreds of generated theme shades. Recreate them
  // against the current surface so dialogs and existing pages share both modes.
  for (let step = 0; step <= 1000; step += 50) {
    tokens[`--color-${String(step).padStart(3, '0')}`] = color(mix(panel, text, step / 1000))
  }
  for (let step = 100; step <= 900; step += 100) {
    tokens[`--color-primary-alpha-${step}`] = alpha(ink, 1 - step / 1000)
  }
  for (const shade of ['light', 'dark'] as const) {
    for (let step = 100; step <= 1000; step += 100) {
      const value = shade === 'light' ? mix(accent, panel, step / 1050) : mix(ink, text, step / 1500)
      const name = `--color-primary-${shade}-${step}`
      tokens[name] = color(value)
      for (let opacity = 100; opacity <= 900; opacity += 100) tokens[`${name}-alpha-${opacity}`] = alpha(value, 1 - opacity / 1000)
    }
  }
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
  root.dataset.modernTheme = resolvedAppearanceMode.value
  root.dataset.uiSkin = appearance.skin
  root.dataset.modernWallpaper = custom ? 'true' : 'false'
  root.dataset.modernDensity = appearance.density
  root.dataset.modernShadows = String(appearance.showShadows)
  root.dataset.modernScrollbars = String(appearance.showScrollbars)
  root.dataset.modernJoinedPanels = String(appearance.panelGap === 0)
  root.style.colorScheme = resolvedAppearanceMode.value
}

export function resetAppearance() {
  Object.assign(appearance, defaults)
}

let initialized = false
export function useAppearance() {
  if (!initialized && typeof document !== 'undefined') {
    initialized = true
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = media.matches
    media.addEventListener('change', event => { systemDark.value = event.matches })
    void initializeWallpaper()
    watch([appearance, systemDark, wallpaper, wallpaperUrl, coverAccent], () => {
      applyAppearance()
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance))
      } catch {
        // The live controls also work when storage is unavailable.
      }
    }, { deep: true, immediate: true })
    window.addEventListener('storage', event => {
      if (event.key === STORAGE_KEY) {
        try {
          Object.assign(appearance, validateAppearance(JSON.parse(event.newValue ?? 'null')))
        } catch {
          resetAppearance()
        }
      }
    })
  }
  return { appearance, appearancePanelOpen, resolvedAppearanceMode, resetAppearance }
}
