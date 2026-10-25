<template>
  <section ref="root" class="ui-full-player-lyrics" :class="{ 'fpl-blur': preferences.blur, 'fpl-animate': animations, 'fpl-manual': manual, 'fpl-dragging': dragging }" :style="lyricStyle" aria-label="歌曲歌词">
    <div
      v-if="lyric.lines.length" ref="viewport" class="fpl-viewport" tabindex="0" aria-label="歌词，点击任意一行跳转播放"
      @wheel.passive="pauseFollowing" @touchstart.passive="pauseFollowing" @keydown="onViewportKey"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @click.capture="captureClick"
    >
      <div class="fpl-spacer" aria-hidden="true" />
      <div class="fpl-lines">
        <button
          v-for="(line, index) in lyric.lines" :key="`${index}:${line.time}`" type="button" class="fpl-line"
          :class="{ 'fpl-current': lyric.line === index, 'fpl-passed': index < lyric.line, 'fpl-word-line': wordsFor(line).length }"
          :data-line="index" :aria-current="lyric.line === index ? 'true' : undefined" :aria-label="`${line.text || '间奏'}，跳转到 ${formatTime(line.time)}`"
          :style="lineStyle(index)" @click="seekLine(line)"
        >
          <span v-if="wordsFor(line).length" class="fpl-main fpl-words"><span v-for="(word, wordIndex) in wordsFor(line)" :key="wordIndex" class="fpl-word" :style="{ '--word-progress': index < lyric.line ? '100%' : '0%' }">{{ word.text }}</span></span>
          <span v-else class="fpl-main">{{ line.text || '♪' }}</span>
          <small v-for="(text, extendedIndex) in line.extendedLyrics" :key="extendedIndex" class="fpl-extended">{{ stripWordTags(text) }}</small>
        </button>
      </div>
      <div class="fpl-spacer" aria-hidden="true" />
    </div>
    <div v-else class="fpl-empty" role="status">
      <div v-if="loading" class="fpl-loading" aria-hidden="true"><i /><i /><i /></div>
      <UiIcon v-else name="lyric" />
      <span>{{ emptyLabel }}</span>
      <small v-if="!loading && musicInfo.id">让音乐陪你度过此刻</small>
    </div>

    <Transition name="fpl-return"><button v-if="manual && lyric.lines.length" type="button" class="fpl-return" @click="focusCurrent"><UiIcon name="focus" />回到当前歌词</button></Transition>

    <div class="fpl-actions" aria-label="歌词工具">
      <button ref="copyTrigger" type="button" title="复制歌词" aria-label="复制歌词" aria-haspopup="dialog" :aria-expanded="menu === 'copy'" :disabled="!lyric.lines.length" @click="toggleMenu('copy')"><UiIcon name="copy" /></button>
      <span class="fpl-divider" />
      <button type="button" title="歌词提前 0.5 秒" aria-label="歌词提前 0.5 秒" :disabled="!lyric.lines.length" @click="changeOffset(500)"><UiIcon name="plus" /></button>
      <button ref="offsetTrigger" type="button" class="fpl-offset-value" :title="`歌词偏移 ${offsetLabel} 秒，点击调整`" :aria-label="`歌词偏移 ${offsetLabel} 秒，点击调整`" aria-haspopup="dialog" :aria-expanded="menu === 'offset'" :disabled="!lyric.lines.length" @click="toggleMenu('offset')"><span>{{ offsetLabel }}</span><small>s</small></button>
      <button type="button" title="歌词延后 0.5 秒" aria-label="歌词延后 0.5 秒" :disabled="!lyric.lines.length" @click="changeOffset(-500)"><UiIcon name="minimize" /></button>
      <span class="fpl-divider" />
      <slot name="tools" />
    </div>

    <div v-if="menu" ref="menuPanel" class="fpl-menu" :class="{ 'fpl-copy-menu': menu === 'copy' }" role="dialog" aria-modal="false" :aria-label="menuTitle" tabindex="-1" @keydown="onMenuKey">
      <header><strong>{{ menuTitle }}</strong><button type="button" :aria-label="`关闭${menuTitle}`" @click="closeMenu"><UiIcon name="close" /></button></header>
      <template v-if="menu === 'copy'">
        <div class="fpl-copy-selection"><span>已选择 {{ selectedLines.length }} / {{ copyLines.length }} 行</span><button type="button" @click="toggleSelectAll">{{ allSelected ? '取消全选' : '全选' }}</button><button type="button" @click="invertSelection">反选</button></div>
        <div class="fpl-copy-lines" aria-label="选择歌词行">
          <label v-for="(line, index) in copyLines" :key="index" class="fpl-copy-line"><input v-model="selectedLines" type="checkbox" :value="index" :aria-label="`选择歌词：${line.text}`"><span><span>{{ line.text }}</span><small v-if="copyOptions.translation && line.translation">{{ line.translation }}</small><small v-if="copyOptions.romanization && line.romanization" class="fpl-romaji">{{ line.romanization }}</small></span></label>
        </div>
        <div class="fpl-copy-filters" role="group" aria-label="复制内容选项"><label v-for="option in copyOptionLabels" :key="option.key"><input v-model="copyOptions[option.key]" type="checkbox">{{ option.label }}</label></div>
        <p v-if="copySuffix" class="fpl-copy-suffix">{{ copySuffix }}</p>
        <div class="fpl-copy-footer"><button type="button" :disabled="!musicInfo.lrc" @click="copyRawLyrics">复制原始歌词</button><button type="button" :disabled="!selectedLines.length || exporting" @click="exportImage">{{ exporting ? '导出中…' : '导出图片' }}</button><button type="button" class="fpl-copy-primary" :disabled="!selectedLines.length || !copyText" @click="copySelectedLyrics">复制歌词</button></div>
      </template>
      <template v-else-if="menu === 'offset'">
        <p class="fpl-menu-hint">正值提前显示，负值延后显示。</p>
        <label class="fpl-number-label">歌词偏移<input type="number" :value="lyric.tempOffset" step="100" min="-60000" max="60000" aria-label="歌词偏移毫秒" @change="editOffset"><small>ms</small></label>
        <button type="button" class="fpl-menu-row" :disabled="lyric.tempOffset === 0" @click="resetOffset"><span>重置本首歌词偏移</span><UiIcon name="refresh" /></button>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { promises as fileSystem } from 'fs'
import { clipboardWriteText } from '@common/utils/electron'
import { lyric, type Line } from '@renderer/store/player/lyric'
import { isPlay, musicInfo, statusText } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'
import { appSetting } from '@renderer/store/setting'
import { setLyricOffset } from '@renderer/core/lyric'
import { play } from '@renderer/core/player/action'
import { getCurrentTime } from '@renderer/plugins/player'
import { openSaveDir } from '@renderer/utils/ipc'
import UiIcon from './UiIcon.vue'
import { fullPlayerLyricPreferences as preferences } from '../services/fullPlayerLyricPreferences'
import { composeLyricCopy, lyricSeekTime, parseLyricWords, parseTimedLyricText, wordProgress, type CopyLyricOptions } from './fullPlayerLyricTiming'

const emit = defineEmits<{ notice: [message: string] }>()
type Menu = 'copy' | 'offset'
const root = ref<HTMLElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const copyTrigger = ref<HTMLButtonElement | null>(null)
const offsetTrigger = ref<HTMLButtonElement | null>(null)
const menuPanel = ref<HTMLElement | null>(null)
const menu = ref<Menu | null>(null)
const selectedLines = ref<number[]>([])
const exporting = ref(false)
const copyOptions = reactive<CopyLyricOptions>({ original: true, translation: true, romanization: true, songName: true, artist: true, emptyLine: false })
const copyOptionLabels: Array<{ key: keyof CopyLyricOptions, label: string }> = [{ key: 'original', label: '原文' }, { key: 'translation', label: '翻译' }, { key: 'romanization', label: '罗马音' }, { key: 'emptyLine', label: '空行' }, { key: 'songName', label: '歌名' }, { key: 'artist', label: '歌手' }]
const translations = computed(() => parseTimedLyricText(musicInfo.tlrc))
const romanizations = computed(() => parseTimedLyricText(musicInfo.rlrc))
function secondaryText(map: Map<number, string>, time: number) {
  const exact = map.get(time)
  if (exact) return exact
  for (const [stamp, text] of map) if (Math.abs(stamp - time) <= 40) return text
  return ''
}
const copyLines = computed(() => lyric.lines.map(line => ({ text: line.text, translation: secondaryText(translations.value, line.time), romanization: secondaryText(romanizations.value, line.time) })))
const selectedSet = computed(() => new Set(selectedLines.value))
const selectedCopyLines = computed(() => copyLines.value.filter((line, index) => selectedSet.value.has(index)))
const allSelected = computed(() => copyLines.value.length > 0 && selectedLines.value.length === copyLines.value.length)
const copyText = computed(() => composeLyricCopy(selectedCopyLines.value, copyOptions, musicInfo.name, musicInfo.singer))
const copySuffix = computed(() => composeLyricCopy([], copyOptions, musicInfo.name, musicInfo.singer))
const manual = ref(false)
const dragging = ref(false)
const reducedMotion = ref(false)
const animations = computed(() => preferences.animation && appSetting['common.isShowAnimation'] && !reducedMotion.value)
const lyricStyle = computed(() => ({ '--fpl-font-size': `clamp(24px, ${preferences.fontSize / 12}vw, ${preferences.fontSize}px)`, '--fpl-line-spacing': `${preferences.lineSpacing}px`, '--fpl-align': preferences.align, '--fpl-origin': preferences.align === 'center' ? 'center' : `${preferences.align} center` }))
const wordMap = computed(() => parseLyricWords(musicInfo.lxlrc))
const wordsFor = (line: Line) => {
  if (!appSetting['player.isPlayLxlrc']) return []
  const words = wordMap.value.get(line.time) ?? []
  return words.map(word => word.text).join('').trim() === line.text.trim() ? words : []
}
const totalOffset = computed(() => lyric.offset + lyric.tempOffset)
const offsetLabel = computed(() => `${lyric.tempOffset > 0 ? '+' : ''}${(lyric.tempOffset / 1000).toFixed(1).replace(/\.0$/, '')}`)
const loading = computed(() => Boolean(musicInfo.id) && musicInfo.lrc === null && !/error|失败|错误/i.test(statusText.value))
const emptyLabel = computed(() => !musicInfo.id ? '选择一首歌曲，开始聆听' : loading.value ? '正在获取歌词…' : /error|失败|错误/i.test(statusText.value) ? '歌词暂时无法加载' : '暂无歌词，欣赏音乐吧')
const menuTitle = computed(() => menu.value === 'copy' ? '复制歌词' : '歌词偏移')
const stripWordTags = (text: string) => text.replace(/<\d+,\d+>/g, '')
const formatTime = (time: number) => `${Math.floor(time / 60000)}:${String(Math.floor(time / 1000) % 60).padStart(2, '0')}`
const lineStyle = (index: number) => ({ '--line-blur': `${Math.min(Math.abs(index - lyric.line) * 0.5, 2)}px` })

let mounted = false
let followTimer: ReturnType<typeof setTimeout> | undefined
let scrollFrame = 0
let wordFrame = 0
let resizeObserver: ResizeObserver | undefined
let mediaQuery: MediaQueryList | undefined
let pointer: { id: number, y: number, top: number } | null = null
let suppressClick = false
let activeWords: HTMLElement[] = []
function cancelScroll() { cancelAnimationFrame(scrollFrame); scrollFrame = 0 }
function stopWordClock() { cancelAnimationFrame(wordFrame); wordFrame = 0 }
function updateWords() {
  const line = lyric.lines[lyric.line]
  if (!line) return
  const elapsed = getCurrentTime() * 1000 + totalOffset.value - line.time
  wordsFor(line).forEach((word, index) => {
    activeWords[index]?.style.setProperty('--word-progress', `${wordProgress(word, elapsed) * 100}%`)
  })
}
function animateWords() {
  wordFrame = 0
  updateWords()
  if (mounted && isPlay.value && appSetting['player.isPlayLxlrc'] && document.visibilityState !== 'hidden' && activeWords.length) wordFrame = requestAnimationFrame(animateWords)
}
function refreshWordClock() {
  stopWordClock()
  activeWords = Array.from(viewport.value?.querySelectorAll<HTMLElement>(`[data-line="${lyric.line}"] .fpl-word`) ?? [])
  animateWords()
}
async function centerCurrent(smooth = true) {
  await nextTick()
  if (!mounted || manual.value || document.visibilityState === 'hidden') return
  const panel = viewport.value
  const line = panel?.querySelector<HTMLElement>(`[data-line="${lyric.line}"]`)
  if (!panel || !line) return
  cancelScroll()
  const target = Math.max(0, Math.min(panel.scrollHeight - panel.clientHeight, panel.scrollTop + line.getBoundingClientRect().top - panel.getBoundingClientRect().top + line.offsetHeight / 2 - panel.clientHeight * 0.4))
  if (!smooth || !animations.value) { panel.scrollTop = target; return }
  let position = panel.scrollTop
  let velocity = 0
  let previousTime = performance.now()
  const step = (now: number) => {
    const delta = Math.min((now - previousTime) / 1000, 0.032)
    previousTime = now
    velocity += ((target - position) * 180 - velocity * 26) * delta
    position += velocity * delta
    panel.scrollTop = position
    if (Math.abs(target - position) < 0.3 && Math.abs(velocity) < 0.5) { panel.scrollTop = target; scrollFrame = 0; return }
    scrollFrame = requestAnimationFrame(step)
  }
  scrollFrame = requestAnimationFrame(step)
}
function focusCurrent() {
  clearTimeout(followTimer)
  manual.value = false
  void centerCurrent()
}
defineExpose({ focusCurrent })
function pauseFollowing() {
  cancelScroll()
  manual.value = true
  clearTimeout(followTimer)
  followTimer = setTimeout(focusCurrent, 5000)
}
function onViewportKey(event: KeyboardEvent) {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseFollowing()
}
function onPointerDown(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || event.button !== 0 || !viewport.value) return
  suppressClick = false
  pointer = { id: event.pointerId, y: event.clientY, top: viewport.value.scrollTop }
  if (event.target === viewport.value) pauseFollowing()
}
function onPointerMove(event: PointerEvent) {
  if (!pointer || event.pointerId !== pointer.id || !viewport.value || (!dragging.value && Math.abs(event.clientY - pointer.y) < 6)) return
  if (!dragging.value) { dragging.value = true; viewport.value.setPointerCapture(event.pointerId) }
  suppressClick = true
  event.preventDefault()
  pauseFollowing()
  viewport.value.scrollTop = pointer.top + pointer.y - event.clientY
}
function onPointerUp(event: PointerEvent) {
  if (pointer?.id !== event.pointerId) return
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
  pointer = null
  dragging.value = false
}
function captureClick(event: MouseEvent) {
  if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false }
}
function seekLine(line: Line) {
  window.app_event.setProgress(lyricSeekTime(line.time, totalOffset.value, playProgress.maxPlayTime))
  if (!isPlay.value) play()
  focusCurrent()
}
function changeOffset(delta: number) { setLyricOffset(lyric.offset + Math.max(-60000, Math.min(60000, lyric.tempOffset + delta))); refreshWordClock() }
function resetOffset() { setLyricOffset(lyric.offset); refreshWordClock() }
function editOffset(event: Event) {
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  if (Number.isFinite(value)) changeOffset(Math.max(-60000, Math.min(60000, value)) - lyric.tempOffset)
  input.value = String(lyric.tempOffset)
}
function activeTrigger() { return menu.value === 'copy' ? copyTrigger.value : offsetTrigger.value }
function closeMenu(restoreFocus = true) {
  const trigger = activeTrigger()
  menu.value = null
  if (restoreFocus) trigger?.focus()
}
async function toggleMenu(value: Menu) {
  if (menu.value === value) { closeMenu(); return }
  if (value === 'copy') selectedLines.value = copyLines.value.map((line, index) => index)
  menu.value = value
  await nextTick()
  if (mounted && menu.value === value) menuPanel.value?.focus()
}
function writeClipboard(text: string) {
  if (!text) return
  try { clipboardWriteText(text); emit('notice', '歌词已复制到剪贴板'); closeMenu() } catch { emit('notice', '复制失败，请重试') }
}
function copySelectedLyrics() { writeClipboard(copyText.value) }
function copyRawLyrics() { writeClipboard((musicInfo.rawlrc?.length ? musicInfo.rawlrc : musicInfo.lrc) ?? '') }
function toggleSelectAll() { selectedLines.value = allSelected.value ? [] : copyLines.value.map((line, index) => index) }
function invertSelection() { selectedLines.value = copyLines.value.map((line, index) => index).filter(index => !selectedSet.value.has(index)) }
async function exportImage() {
  if (exporting.value || !selectedLines.value.length || !copyText.value) return
  exporting.value = true
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    const colors = getComputedStyle(root.value ?? document.body)
    const background = colors.getPropertyValue('--modern-bg').trim() || '#181821'
    const foreground = colors.getPropertyValue('--modern-text').trim() || '#f0f0f5'
    const muted = colors.getPropertyValue('--modern-muted').trim() || '#9999aa'
    const family = '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
    const rows: Array<{ text: string, size: number, color: string, weight: number }> = []
    const addParagraph = (text: string, size: number, color: string, weight = 500) => {
      context.font = `${weight} ${size}px ${family}`
      for (const paragraph of text.split('\n')) {
        let current = ''
        for (const character of paragraph) {
          if (current && context.measureText(current + character).width > 1008) { rows.push({ text: current, size, color, weight }); current = character } else current += character
        }
        rows.push({ text: current, size, color, weight })
      }
    }
    if (copyOptions.songName && musicInfo.name) addParagraph(musicInfo.name, 44, foreground, 700)
    if (copyOptions.artist && musicInfo.singer) addParagraph(musicInfo.singer, 24, muted)
    rows.push({ text: '', size: 28, color: foreground, weight: 500 })
    for (const line of selectedCopyLines.value) {
      if (copyOptions.original) addParagraph(line.text, 34, foreground, 650)
      if (copyOptions.translation && line.translation) addParagraph(line.translation, 24, muted)
      if (copyOptions.romanization && line.romanization) addParagraph(line.romanization, 23, muted)
      rows.push({ text: '', size: copyOptions.emptyLine ? 30 : 15, color: foreground, weight: 500 })
    }
    const height = 184 + rows.reduce((total, row) => total + row.size * 1.7, 0)
    const scale = Math.min(1, 16000 / height)
    canvas.width = Math.round(1200 * scale)
    canvas.height = Math.ceil(height * scale)
    context.scale(scale, scale)
    context.fillStyle = background
    context.fillRect(0, 0, 1200, height)
    context.textBaseline = 'top'
    let top = 82
    for (const row of rows) {
      context.font = `${row.weight} ${row.size}px ${family}`
      context.fillStyle = row.color
      context.fillText(row.text, 96, top)
      top += row.size * 1.7
    }
    context.fillStyle = muted
    context.font = `20px ${family}`
    context.fillText('Mix Music · 歌词', 96, height - 62)
    const blob = await new Promise<Blob>((resolve, reject) => { canvas.toBlob(value => { if (value) resolve(value); else reject(new Error('Image encoding failed')) }, 'image/png') })
    const filename = `${musicInfo.name || '歌曲'} - 歌词.png`.replace(/[\\/:*?"<>|]/g, ' ')
    const result = await openSaveDir({ title: '导出歌词图片', defaultPath: filename, filters: [{ name: 'PNG 图片', extensions: ['png'] }] })
    if (result.canceled || !result.filePath) return
    await fileSystem.writeFile(result.filePath, Buffer.from(await blob.arrayBuffer()))
    emit('notice', '歌词图片已保存')
  } catch { emit('notice', '导出歌词图片失败，请重试') } finally { exporting.value = false }
}
function onMenuKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return }
  if (event.target instanceof HTMLInputElement && event.key !== 'Tab') return
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return
  const items = Array.from(menuPanel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])
  if (!items.length) return
  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLElement)
  const direction = event.key === 'ArrowUp' ? -1 : event.key === 'Tab' && event.shiftKey ? -1 : 1
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + direction + items.length) % items.length
  items[next]?.focus()
}
function onOutsidePointer(event: PointerEvent) {
  if (!menu.value || menuPanel.value?.contains(event.target as Node) === true || activeTrigger()?.contains(event.target as Node) === true) return
  closeMenu(false)
}
function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !menu.value) return
  event.preventDefault()
  event.stopPropagation()
  closeMenu()
}
function onMotionChange() { reducedMotion.value = mediaQuery?.matches ?? false; if (reducedMotion.value) { cancelScroll(); void centerCurrent(false) } }
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') { cancelScroll(); stopWordClock(); clearTimeout(followTimer) } else { manual.value = false; void centerCurrent(false); refreshWordClock() }
}
watch(() => lyric.line, () => { void centerCurrent(); void nextTick(refreshWordClock) })
watch([() => lyric.lines, () => musicInfo.lxlrc, () => appSetting['player.isPlayLxlrc']], () => { void centerCurrent(false); void nextTick(refreshWordClock) })
watch(isPlay, () => { void nextTick(refreshWordClock) })
watch(totalOffset, updateWords)
watch(() => musicInfo.id, () => { clearTimeout(followTimer); manual.value = false; closeMenu(false); cancelScroll() })
watch(preferences, () => { void centerCurrent(false) }, { deep: true })
onMounted(() => {
  mounted = true
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  onMotionChange()
  mediaQuery.addEventListener('change', onMotionChange)
  document.addEventListener('pointerdown', onOutsidePointer, true)
  document.addEventListener('keydown', onEscape, true)
  document.addEventListener('visibilitychange', onVisibilityChange)
  resizeObserver = new ResizeObserver(() => { void centerCurrent(false) })
  if (root.value) resizeObserver.observe(root.value)
  void centerCurrent(false)
  void nextTick(refreshWordClock)
})
onBeforeUnmount(() => {
  mounted = false
  clearTimeout(followTimer)
  cancelScroll()
  stopWordClock()
  resizeObserver?.disconnect()
  mediaQuery?.removeEventListener('change', onMotionChange)
  document.removeEventListener('pointerdown', onOutsidePointer, true)
  document.removeEventListener('keydown', onEscape, true)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  activeWords = []
  pointer = null
})
</script>

<style lang="less">
.ui-full-player-lyrics { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; color: var(--modern-text); isolation: isolate; -webkit-app-region: no-drag; }
.fpl-viewport { position: absolute; inset: 0 66px 0 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; -webkit-mask-image: linear-gradient(transparent, #000 12%, #000 84%, transparent); mask-image: linear-gradient(transparent, #000 12%, #000 84%, transparent); outline: none; touch-action: pan-y; user-select: none; }
.fpl-viewport::-webkit-scrollbar { display: none; }
.fpl-viewport:focus-visible { outline: 2px solid var(--modern-accent-ink); outline-offset: -4px; border-radius: 12px; }
.fpl-spacer { height: 40%; min-height: 40%; pointer-events: none; }
// Reserve both sides for the active row's scale, including left/right alignment.
.fpl-lines { position: relative; padding: 0 max(18px, 3%); }
.fpl-line { position: relative; display: block; box-sizing: border-box; width: 100%; margin: 0; padding: var(--fpl-line-spacing, 18px) 12px; border: 0; border-radius: 12px; background: transparent; color: var(--modern-text); text-align: var(--fpl-align); font: inherit; font-weight: 700; font-size: var(--fpl-font-size); line-height: 1.4; letter-spacing: -.025em; overflow-wrap: anywhere; cursor: pointer; opacity: .25; transform-origin: var(--fpl-origin); }
.fpl-animate .fpl-line { transition: opacity .45s ease, transform .6s cubic-bezier(.2,.8,.2,1.15), filter .45s ease, background-color .18s; }
.fpl-main { display: block; white-space: pre-wrap; }
.fpl-current { opacity: 1; }
.fpl-animate .fpl-current { transform: scale(1.025); }
.fpl-line:hover, .fpl-line:focus-visible { opacity: 1; background: var(--modern-hover); filter: none !important; }
.fpl-line:focus-visible { outline: 2px solid var(--modern-accent-ink); outline-offset: 0; }
.fpl-blur .fpl-line:not(.fpl-current) { filter: blur(var(--line-blur, 0px)); }
.fpl-manual .fpl-line { opacity: .65; filter: none !important; }
.fpl-manual .fpl-current { opacity: 1; }
.fpl-word { background-color: color-mix(in srgb, var(--modern-text) 30%, transparent); background-image: linear-gradient(var(--modern-text), var(--modern-text)); background-repeat: no-repeat; background-size: var(--word-progress, 0%) 100%; background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.fpl-line:not(.fpl-current) .fpl-word { background-size: 100% 100%; }
.fpl-extended { display: block; margin-top: 8px; font: inherit; font-size: .53em; font-weight: 500; letter-spacing: 0; line-height: 1.65; opacity: .72; white-space: pre-wrap; }
.fpl-dragging, .fpl-dragging .fpl-line { cursor: grabbing; }
.fpl-actions { position: absolute; right: 2px; top: 50%; display: flex; flex-direction: column; align-items: center; gap: 10px; transform: translateY(-50%); opacity: .65; transition: opacity .2s; }
.ui-full-player-lyrics:hover .fpl-actions, .fpl-actions:focus-within { opacity: 1; }
.fpl-actions > button, .fpl-actions .ui-full-more-trigger, .fpl-menu header > button { display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.fpl-actions > button:hover, .fpl-actions .ui-full-more-trigger:hover, .fpl-menu header > button:hover { background: var(--modern-hover); }
.fpl-actions button:disabled { opacity: .3; cursor: default; }
.fpl-actions button:focus-visible, .fpl-menu button:focus-visible, .fpl-return:focus-visible { outline: 2px solid var(--modern-accent-ink); outline-offset: 3px; }
.fpl-actions .ui-svg-icon { width: 22px; height: 22px; }
.fpl-divider { display: block; width: 23px; height: 1px; margin: 3px 0; background: var(--modern-border); }
.fpl-actions > .fpl-offset-value { width: 44px; height: 26px; gap: 2px; border: 1px solid var(--modern-border); border-radius: 7px; font: inherit; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.fpl-offset-value small { font-size: 9px; opacity: .65; }
.fpl-return { position: absolute; left: calc((100% - 66px) / 2); bottom: 8px; display: flex; align-items: center; gap: 8px; transform: translateX(-50%); border: 1px solid var(--modern-border); border-radius: 24px; padding: 10px 15px; background: var(--modern-panel); color: var(--modern-text); box-shadow: 0 6px 22px #0002; font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.fpl-return .ui-svg-icon { width: 15px; height: 15px; }
.fpl-return-enter-active, .fpl-return-leave-active { transition: opacity .2s, bottom .2s; }
.fpl-return-enter-from, .fpl-return-leave-to { opacity: 0; bottom: 0; }
.fpl-empty { display: flex; height: 100%; padding-right: 66px; align-items: center; justify-content: center; flex-direction: column; gap: 18px; color: var(--modern-muted); font-size: 18px; }
.fpl-empty > .ui-svg-icon { width: 44px; height: 44px; opacity: .4; }
.fpl-empty small { opacity: .65; font-size: 13px; }
.fpl-loading { display: flex; align-items: center; gap: 10px; height: 38px; }
.fpl-loading i { width: 10px; height: 10px; border-radius: 50%; background: currentColor; animation: fpl-breathe 1.5s ease-in-out infinite; }
.fpl-loading i:nth-child(2) { animation-delay: .15s; }
.fpl-loading i:nth-child(3) { animation-delay: .3s; }
.fpl-menu { position: absolute; z-index: 5; right: 52px; top: 50%; width: min(282px, calc(100% - 60px)); max-height: calc(100% - 24px); overflow: auto; box-sizing: border-box; padding: 12px; border: 1px solid var(--modern-border); border-radius: 14px; background: var(--modern-panel); color: var(--modern-text); box-shadow: 0 16px 48px #0003; transform: translateY(-50%); outline: none; font-size: 13px; animation: fpl-menu-in .18s ease both; }
.ui-full-player-lyrics .fpl-menu > header { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 16px; height: auto; min-height: 32px; padding: 0 4px 6px 8px; font-size: inherit; -webkit-app-region: no-drag; }
.fpl-menu header strong { font-size: 15px; font-weight: 650; }
.fpl-menu header > button { width: 28px; height: 28px; }
.fpl-menu header .ui-svg-icon { width: 16px; height: 16px; }
.fpl-menu-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 40px; padding: 8px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.fpl-menu-row:hover { background: var(--modern-hover); }
.fpl-menu-row:disabled { opacity: .4; cursor: default; }
.fpl-menu-row > .ui-svg-icon { width: 16px; height: 16px; color: var(--modern-muted); }
.fpl-menu-hint { margin: 0 8px 10px; color: var(--modern-muted); font-size: 12px; line-height: 1.6; }
.fpl-number-label { display: flex; align-items: center; gap: 8px; padding: 8px; }
.fpl-number-label input { flex: 1; min-width: 0; width: 70px; padding: 7px; border: 1px solid var(--modern-border); border-radius: 6px; background: var(--modern-hover); color: inherit; font: inherit; }
.fpl-number-label small { color: var(--modern-muted); }
.fpl-copy-menu { display: flex; flex-direction: column; width: min(460px, calc(100% - 60px)); overflow: hidden; }
.fpl-copy-selection { display: flex; flex: none; align-items: center; gap: 9px; padding: 3px 6px 9px; color: var(--modern-muted); font-size: 11px; }
.fpl-copy-selection > span { flex: 1; }
.fpl-copy-selection button { border: 0; padding: 4px 0; background: transparent; color: var(--modern-accent-ink); font: inherit; }
.fpl-copy-lines { min-height: 45px; max-height: 230px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--modern-border) transparent; }
.fpl-copy-line { display: flex; align-items: flex-start; gap: 10px; padding: 9px 6px; border-radius: 6px; cursor: pointer; line-height: 1.5; }
.fpl-copy-line:hover { background: var(--modern-hover); }
.fpl-copy-line > input { flex: none; margin: 3px 0 0; }
.fpl-copy-line > span { min-width: 0; overflow-wrap: anywhere; }
.fpl-copy-line small { display: block; margin-top: 3px; color: var(--modern-muted); font-size: 11px; white-space: pre-wrap; }
.fpl-copy-line .fpl-romaji { font-style: italic; opacity: .8; }
.fpl-copy-menu input { accent-color: var(--modern-accent); }
.fpl-copy-filters { display: flex; flex: none; flex-wrap: wrap; gap: 7px 12px; margin-top: 10px; padding: 12px 5px 7px; border-top: 1px solid var(--modern-border); font-size: 11px; color: var(--modern-muted); }
.fpl-copy-filters label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; }
.fpl-copy-filters input { margin: 0; }
.fpl-copy-suffix { flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 6px 5px 3px; color: var(--modern-muted); font-size: 11px; text-align: right; }
.fpl-copy-footer { display: flex; flex: none; justify-content: flex-end; flex-wrap: wrap; gap: 6px; padding: 10px 3px 2px; }
.fpl-copy-footer button { padding: 8px 10px; border: 0; border-radius: 7px; background: var(--modern-hover); color: var(--modern-text); font: inherit; font-size: 11px; }
.fpl-copy-footer button:disabled { opacity: .35; cursor: default; }
.fpl-copy-footer > .fpl-copy-primary { background: var(--modern-accent); color: var(--modern-accent-contrast); }
@keyframes fpl-breathe { 0%, 100% { opacity: .3; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }
@keyframes fpl-menu-in { from { opacity: 0; margin-right: -5px; } to { opacity: 1; margin-right: 0; } }
@media (max-width: 900px) { .fpl-line { padding-left: 6px; padding-right: 6px; } .fpl-lines { padding: 0 max(10px, 3%); } .fpl-viewport { right: 50px; } .fpl-actions { right: 0; gap: 7px; } .fpl-actions > button { width: 34px; height: 34px; } }
@media (prefers-reduced-motion: reduce) { .ui-full-player-lyrics *, .ui-full-player-lyrics *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
</style>
