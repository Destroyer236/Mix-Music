<template>
  <Teleport to="body">
    <Transition name="appearance-float">
      <div v-if="appearancePanelOpen" class="appearance-overlay" @click.self="close">
        <section ref="panel" class="appearance-panel" role="dialog" aria-modal="true" aria-label="外观设置" tabindex="-1" @keydown="handleKeydown">
          <header class="appearance-header">
            <button class="appearance-close" type="button" aria-label="关闭外观设置" @click="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>

          <div class="appearance-body scroll">
            <fieldset class="appearance-section">
              <legend>UI 风格</legend>
              <div class="appearance-skins">
                <button v-for="skin in skins" :key="skin.value" type="button" class="appearance-skin" :class="{ selected: appearance.skin === skin.value }" :aria-pressed="appearance.skin === skin.value" @click="appearance.skin = skin.value">
                  <span class="appearance-skin-preview" :class="skin.value" aria-hidden="true"><i /><i /><i /><i /></span>
                  <span class="appearance-skin-name">{{ skin.label }}</span>
                  <UiIcon v-if="appearance.skin === skin.value" class="appearance-mode-check" name="check" />
                </button>
              </div>
              <p class="appearance-control-hint">EchoMusic 风格：氛围渐变、浮岛面板与 EchoMusic 版页面布局，切换即时生效</p>
            </fieldset>

            <fieldset class="appearance-section">
              <legend>外观主题</legend>
              <div class="appearance-modes">
                <button v-for="mode in modes" :key="mode.value" type="button" class="appearance-mode" :class="{ selected: appearance.mode === mode.value }" :aria-pressed="appearance.mode === mode.value" :disabled="wallpaperBusy" @click="chooseMode(mode.value)">
                  <span class="appearance-mode-preview" :class="mode.value" :style="mode.value === 'custom' && wallpaperUrl ? { backgroundImage: `url(${JSON.stringify(wallpaperUrl)})` } : undefined" aria-hidden="true"><UiIcon v-if="mode.value === 'custom' && !wallpaperUrl" name="imagePlus" /><template v-else><i /><i /><i /></template></span>
                  <span>{{ mode.label }}</span>
                  <UiIcon v-if="appearance.mode === mode.value" class="appearance-mode-check" name="check" />
                </button>
              </div>
            </fieldset>

            <div v-if="appearance.mode === 'custom' || wallpaperBusy || wallpaperError" class="appearance-section appearance-wallpaper">
              <button type="button" class="appearance-wallpaper-upload" :disabled="wallpaperBusy" :aria-busy="wallpaperBusy" @click="uploadWallpaper">
                <span v-if="wallpaperUrl" class="appearance-wallpaper-thumb" :style="{ backgroundImage: `url(${JSON.stringify(wallpaperUrl)})` }" /><span v-else class="appearance-wallpaper-glyph"><UiIcon name="imagePlus" /></span>
                <span><strong>{{ wallpaperBusy ? '正在生成配色…' : wallpaper ? '更换背景图片' : '选择背景图片' }}</strong><small :title="wallpaper?.name">{{ wallpaper?.name || 'JPG、PNG、WebP、BMP · 最大 32 MB' }}</small></span><UiIcon name="plus" />
              </button>
              <p v-if="wallpaperError" class="appearance-wallpaper-error" role="alert">{{ wallpaperError }}</p>
              <div v-if="wallpaper" class="appearance-wallpaper-caption"><span>图片已保存到本地</span><button type="button" @click="openWallpaperFolder"><UiIcon name="folderOpen" />打开文件夹</button></div>
              <div v-if="wallpaper && appearance.mode === 'custom'" class="appearance-wallpaper-tones" role="group" aria-label="背景明暗"><span>背景明暗</span><div><button v-for="tone in customTones" :key="tone.value" type="button" :aria-pressed="appearance.customTone === tone.value" @click="appearance.customTone = tone.value">{{ tone.label }}</button></div></div>
            </div>

            <fieldset v-if="appearance.mode === 'custom' && wallpaper" class="appearance-section appearance-image-colors"><legend>图片配色<span class="appearance-value">自动协调</span></legend><div><span v-for="role in colorRoles" :key="role.variable" :style="{ background: `var(${role.variable})` }" :title="role.label" /><p>面板、文字与按钮随背景配色</p></div></fieldset>
            <fieldset v-else class="appearance-section">
              <legend>点缀颜色 <span class="appearance-value">{{ accentHexLabel }}</span></legend>
              <div class="appearance-accent-sources" role="group" aria-label="主题色来源">
                <button v-for="source in accentSources" :key="source.value" type="button" :class="{ selected: appearance.accentSource === source.value }" :aria-pressed="appearance.accentSource === source.value" @click="appearance.accentSource = source.value">{{ source.label }}</button>
              </div>
              <div v-if="appearance.accentSource === 'preset'" class="appearance-colors">
                <button v-for="swatch in swatches" :key="swatch.color" type="button" class="appearance-swatch" :class="{ selected: appearance.accent === swatch.color }" :style="{ '--swatch': swatch.color }" :aria-label="swatch.label" :aria-pressed="appearance.accent === swatch.color" @click="appearance.accent = swatch.color">
                  <svg v-if="appearance.accent === swatch.color" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
                </button>
              </div>
              <div v-else-if="appearance.accentSource === 'custom'" class="appearance-colors">
                <label class="appearance-custom-color" title="选择自定义颜色">
                  <input :value="appearance.accent" type="color" aria-label="自定义点缀颜色" @input="handleAccentInput">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                </label>
                <span class="appearance-custom-hex">{{ appearance.accent.toUpperCase() }}</span>
              </div>
              <p v-else class="appearance-control-hint">从播放中的歌曲封面提取主色，切歌即时跟随；暂无封面时使用预设颜色</p>
            </fieldset>

            <div class="appearance-section appearance-toggle-row">
              <div><label id="appearance-shadows-label">显示阴影</label><p>为浮动面板、卡片和弹出菜单添加阴影，默认关闭</p></div>
              <button type="button" class="appearance-toggle" role="switch" :aria-checked="appearance.showShadows" aria-labelledby="appearance-shadows-label" @click="appearance.showShadows = !appearance.showShadows"><span /></button>
            </div>

            <div class="appearance-section">
              <label class="appearance-label" for="appearance-radius">浮动面板圆角 <span class="appearance-value">{{ appearance.radius }} px</span></label>
              <input id="appearance-radius" :value="appearance.radius" class="appearance-range" type="range" min="0" max="32" step="1" @input="handleRadiusInput">
              <div class="appearance-range-labels"><span>利落</span><span>柔和</span></div>
              <p class="appearance-control-hint">默认 8 px，可调范围 0–32 px</p>
            </div>

            <div class="appearance-section">
              <label class="appearance-label" for="appearance-panel-gap">浮动面板间距 <span class="appearance-value">{{ appearance.panelGap }} px</span></label>
              <input id="appearance-panel-gap" :value="appearance.panelGap" class="appearance-range" type="range" min="0" max="32" step="1" @input="handlePanelGapInput">
              <div class="appearance-range-labels"><span>紧密</span><span>宽松</span></div>
              <p class="appearance-control-hint">默认 8 px；0 px 时面板无缝衔接</p>
            </div>

            <div class="appearance-section appearance-toggle-row">
              <div><label id="appearance-scrollbars-label">显示滚动条</label><p>默认隐藏，仍可使用滚轮、触控板和键盘滚动</p></div>
              <button type="button" class="appearance-toggle" role="switch" :aria-checked="appearance.showScrollbars" aria-labelledby="appearance-scrollbars-label" @click="appearance.showScrollbars = !appearance.showScrollbars"><span /></button>
            </div>

            <div class="appearance-section appearance-toggle-row">
              <div><label id="appearance-explore-label">显示发现推荐</label><p>在发现页展示氛围与灵感卡片</p></div>
              <button type="button" class="appearance-toggle" role="switch" :aria-checked="appearance.showExplore" aria-labelledby="appearance-explore-label" @click="appearance.showExplore = !appearance.showExplore"><span /></button>
            </div>

          </div>
          <footer class="appearance-footer">
            <button type="button" class="appearance-reset" @click="resetAppearance">恢复默认</button>
            <button type="button" class="appearance-done" @click="close">完成</button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { appearance, appearancePanelOpen, resetAppearance, type Appearance } from '@renderer/composables/useAppearance'
import { coverAccent } from '@renderer/ui/coverAccent'
import { selectWallpaper, wallpaper, wallpaperUrl, wallpaperBusy, wallpaperError, openWallpaperFolder } from '../useWallpaper'
import UiIcon from './UiIcon.vue'

const panel = ref<HTMLElement | null>(null)
const skins: Array<{ value: Appearance['skin'], label: string }> = [
  { value: 'linkline', label: 'Mix Music 原版' },
  { value: 'echo', label: 'EchoMusic' },
]
const modes: Array<{ value: Appearance['mode'], label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'custom', label: '自定义' },
]
const customTones: Array<{ value: Appearance['customTone'], label: string }> = [{ value: 'auto', label: '自动' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]
const accentSources: Array<{ value: Appearance['accentSource'], label: string }> = [
  { value: 'cover', label: '跟随封面' },
  { value: 'preset', label: '预设主题' },
  { value: 'custom', label: '自定义' },
]
// 图例展示当前生效色：跟随封面时显示封面主色（未取到则回退已存颜色）。
const accentHexLabel = computed(() => (appearance.accentSource === 'cover' && coverAccent.value ? coverAccent.value : appearance.accent).toUpperCase())
const colorRoles = [{ variable: '--modern-accent', label: '强调色' }, { variable: '--modern-accent-soft', label: '选中背景' }, { variable: '--modern-sidebar', label: '侧栏' }, { variable: '--modern-panel', label: '内容面板' }, { variable: '--modern-text', label: '文字' }]
async function uploadWallpaper() { if (await selectWallpaper()) { appearance.customTone = 'auto'; appearance.mode = 'custom' } }
async function chooseMode(mode: Appearance['mode']) {
  if (mode === 'custom' && !wallpaper.value) await uploadWallpaper()
  else appearance.mode = mode
}
const swatches = [
  { color: '#00eb81', label: 'Mix Music 绿（默认）' },
  { color: '#638575', label: '鼠尾草绿' },
  { color: '#6287b5', label: '雾霭蓝' },
  { color: '#9181b3', label: '柔和紫' },
  { color: '#b68086', label: '玫瑰粉' },
  { color: '#b39260', label: '琥珀金' },
  { color: '#737e83', label: '石墨灰' },
]
let previousFocus: HTMLElement | null = null
const close = () => {
  appearancePanelOpen.value = false
  if (wallpaper.value) wallpaperError.value = ''
}
function handleAccentInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (/^#[\da-f]{6}$/i.test(value)) appearance.accent = value.toLowerCase()
}
function handleRadiusInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) appearance.radius = Math.max(0, Math.min(32, Math.round(value)))
}
function handlePanelGapInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) appearance.panelGap = Math.max(0, Math.min(32, Math.round(value)))
}
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = panel.value?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')
  if (!focusable?.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
watch(appearancePanelOpen, async open => {
  if (open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    panel.value?.focus()
  } else {
    previousFocus?.focus()
    previousFocus = null
  }
})
onBeforeUnmount(() => { previousFocus?.focus() })
</script>

<style lang="less">
.appearance-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 24px;
  box-sizing: border-box;
  background: var(--modern-overlay);
  backdrop-filter: blur(5px);
  -webkit-app-region: no-drag;
}
.appearance-panel {
  width: 360px;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--modern-border);
  border-radius: var(--modern-radius);
  outline: none;
  color: var(--modern-text);
  background: var(--modern-panel);
  box-shadow: 0 20px 90px rgba(0, 0, 0, .17);
  overflow: hidden;
  font-size: 13px;
  line-height: 1.5;
}
.appearance-panel > .appearance-header {
  display: flex;
  justify-content: flex-end;
  padding: 12px 18px 0;
  flex: none;
  border: 0;
}
.appearance-close {
  border: 0;
  background: var(--modern-hover);
  color: var(--modern-muted);
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  svg { width: 15px; height: 15px; }
  &:hover { color: var(--modern-text); }
}
.appearance-body { padding: 22px 24px; overflow-y: auto; min-height: 0; }
.appearance-section { margin: 0 0 23px; padding: 0; border: 0; min-width: 0; }
.appearance-section legend, .appearance-label { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-bottom: 13px; font-weight: 500; font-size: 12px; }
.appearance-value { color: var(--modern-muted); font-size: 10px; font-weight: 400; font-variant-numeric: tabular-nums; }
.appearance-modes { display: flex; gap: 9px; }
.appearance-skins { display: flex; gap: 9px; }
.appearance-skin {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 8px 8px 9px;
  background: transparent;
  border: 1px solid var(--modern-border);
  border-radius: 10px;
  color: var(--modern-muted);
  cursor: pointer;
  font-size: 11px;
  text-align: left;
  &.selected { border-color: var(--modern-accent); background: var(--modern-accent-soft); color: var(--modern-text); }
}
.appearance-skin-preview {
  height: 46px;
  display: block;
  position: relative;
  border: 1px solid rgba(0, 0, 0, .08);
  border-radius: 5px;
  margin-bottom: 8px;
  overflow: hidden;
  i { position: absolute; border-radius: 2px; }
  // Mix Music：连续面板骨架
  &.linkline { background: #f0f0f0;
    i:nth-child(1) { inset: 0 auto 0 0; width: 24%; border-radius: 0; background: #e3e6e4; }
    i:nth-child(2) { left: 30%; right: 6%; top: 8px; height: 5px; background: #c9d1cc; }
    i:nth-child(3) { left: 30%; right: 34%; bottom: 8px; height: 12px; border-radius: 3px; background: #d7ded9; }
    i:nth-child(4) { left: 30%; right: 6%; bottom: 8px; height: 5px; background: #bfe9d2; }
  }
  // EchoMusic：浮岛 + 氛围渐变 + 大圆播放钮
  &.echo { background: linear-gradient(160deg, #ffe9d6 0%, #fdf3e7 46%, #f6f6f6 100%);
    i:nth-child(1) { left: 6%; top: 7%; bottom: 7%; width: 20%; border-radius: 4px; background: rgba(255, 255, 255, .85); }
    i:nth-child(2) { left: 30%; right: 6%; top: 10%; height: 38%; border-radius: 4px; background: rgba(255, 255, 255, .9); }
    i:nth-child(3) { left: 30%; right: 6%; bottom: 10%; height: 26%; border-radius: 4px; background: rgba(255, 255, 255, .9); }
    i:nth-child(4) { left: 36%; bottom: 17%; width: 9px; height: 9px; border-radius: 50%; background: #00cc65; }
  }
}
.appearance-skin-name { display: block; padding-right: 16px; }
.appearance-mode {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 8px 8px 9px;
  background: transparent;
  border: 1px solid var(--modern-border);
  border-radius: 10px;
  color: var(--modern-muted);
  cursor: pointer;
  font-size: 11px;
  &.selected { border-color: var(--modern-accent); background: var(--modern-accent-soft); color: var(--modern-text); }
}
.appearance-mode-preview {
  height: 43px;
  display: flex;
  position: relative;
  background: #f6f7f6;
  border: 1px solid rgba(0, 0, 0, .08);
  border-radius: 5px;
  margin-bottom: 8px;
  overflow: hidden;
  i:first-child { width: 22%; height: 100%; background: #e5e9e6; }
  i:nth-child(2) { position: absolute; left: 32%; right: 11%; top: 10px; height: 4px; border-radius: 5px; background: #c1cac4; }
  i:last-child { position: absolute; left: 32%; right: 27%; top: 19px; height: 4px; border-radius: 5px; background: #d4dad6; }
  &.dark { background: #242727; i:first-child { background: #171b19; } i:nth-child(2) { background: #65706a; } i:last-child { background: #424b46; } }
  &.system { background: linear-gradient(90deg, #f6f7f6 50%, #242727 50%); i:last-child { background: linear-gradient(90deg, #d4dad6 40%, #65706a 40%); } }
}
.appearance-mode-check { width: 12px; height: 12px; position: absolute; right: 5px; bottom: 11px; color: var(--modern-accent-ink); }
.appearance-colors { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
// 主题色来源三选项（对照 EchoMusic：跟随封面 / 预设主题 / 自定义）
.appearance-accent-sources {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  button {
    flex: 1;
    min-width: 0;
    padding: 7px 0;
    border: 1px solid var(--modern-border);
    border-radius: 9px;
    background: transparent;
    color: var(--modern-muted);
    font-size: 11px;
    cursor: pointer;
    &.selected { border-color: var(--modern-accent); background: var(--modern-accent-soft); color: var(--modern-text); }
  }
}
.appearance-custom-hex { color: var(--modern-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.appearance-swatch {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: var(--swatch);
  color: white;
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  svg { width: 17px; height: 17px; }
  &.selected { outline: 1px solid var(--swatch); outline-offset: 3px; }
}
.appearance-custom-color {
  position: relative;
  width: 29px;
  height: 29px;
  border: 1px dashed var(--modern-muted);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--modern-muted);
  cursor: pointer;
  input { position: absolute; width: 100%; height: 100%; inset: 0; opacity: 0; cursor: pointer; }
  svg { width: 15px; height: 15px; pointer-events: none; }
  &:focus-within { outline: 2px solid var(--modern-accent); outline-offset: 3px; }
}
.appearance-range { width: 100%; margin: 0; height: 18px; cursor: pointer; accent-color: var(--modern-accent); }
.appearance-range-labels { display: flex; justify-content: space-between; margin-top: 4px; color: var(--modern-muted); font-size: 10px; }
.appearance-control-hint { margin-top: 8px; color: var(--modern-muted); font-size: 10px; }
.appearance-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  label { font-size: 12px; font-weight: 500; }
  p { margin-top: 4px; font-size: 10px; color: var(--modern-muted); }
}
.appearance-toggle {
  display: flex;
  align-items: center;
  width: 34px;
  height: 20px;
  border: 0;
  border-radius: 20px;
  background: var(--modern-muted);
  padding: 3px;
  cursor: pointer;
  transition: background .2s;
  span { width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .2s; box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
  &[aria-checked='true'] { background: var(--modern-accent); span { transform: translateX(14px); } }
}
.appearance-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 24px;
  border-top: 1px solid var(--modern-border);
  flex: none;
  button { font-size: 12px; padding: 8px 15px; border: 0; border-radius: 9px; cursor: pointer; }
}
.appearance-reset { background: transparent; color: var(--modern-muted); &:hover { color: var(--modern-text); } }
.appearance-done { background: var(--modern-text); color: var(--modern-panel); }
.appearance-panel button:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 3px; }
.appearance-float-enter-active, .appearance-float-leave-active { transition: opacity .2s; .appearance-panel { transition: transform .25s ease; } }
.appearance-float-enter-from, .appearance-float-leave-to { opacity: 0; .appearance-panel { transform: translateX(20px); } }
@media (max-width: 760px) { .appearance-overlay { padding: 12px; justify-content: center; } }
@media (prefers-reduced-motion: reduce) { .appearance-float-enter-active, .appearance-float-leave-active, .appearance-toggle span { transition: none; } }
</style>

