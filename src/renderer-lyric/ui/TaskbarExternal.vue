<template>
  <div ref="wrapper" class="taskbar-wrapper" :data-align="layout.anchor" @mouseenter="setHovered(true)" @mouseleave="setHovered(false)">
    <div class="taskbar-external" :class="{ hovered, background: config.showBackground, light: lightTheme }" :style="rootStyle" @dblclick="control('focus-main')" @contextmenu.prevent="control('open-settings')">
      <div v-if="config.showCover" class="taskbar-cover"><ExternalCover /></div>
      <div class="taskbar-controls">
        <div class="taskbar-controls-inner">
          <button type="button" title="上一首" aria-label="上一首" @click.stop="control('prev')" @dblclick.stop><UiIcon name="prev" /></button>
          <button type="button" :title="playing ? '暂停' : '播放'" :aria-label="playing ? '暂停' : '播放'" @click.stop="control(playing ? 'pause' : 'play')" @dblclick.stop><UiIcon :name="playing ? 'pause' : 'play'" /></button>
          <button type="button" title="下一首" aria-label="下一首" @click.stop="control('next')" @dblclick.stop><UiIcon name="next" /></button>
        </div>
      </div>
      <div class="taskbar-text">
        <TransitionGroup name="taskbar-line" tag="div" class="taskbar-lines" @after-leave="scheduleReport" @after-enter="scheduleReport">
          <ExternalLine v-for="(item, index) in items" :key="item.key" :line="item.line" :text="item.text" :secondary="index > 0" :active="index === 0" :word-by-word="config.wordByWord && !!item.line" :align="layout.anchor" />
        </TransitionGroup>
        <div class="taskbar-meta"><div class="taskbar-title">{{ track.title }}</div><div v-if="config.doubleLine" class="taskbar-artist">{{ track.artist || '未知歌手' }}</div></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getExternalLyricConfig } from '@common/externalLyric'
import UiIcon from '@renderer/ui/components/UiIcon.vue'
import { control, currentLine, hovered, layout, lines, playing, primaryIndex, reportSize, settings, track } from '../core/externalState'
import type { ExternalLine as Line } from '../core/externalTiming'
import ExternalCover from './ExternalCover.vue'
import ExternalLine from './ExternalLine.vue'

const config = computed(() => getExternalLyricConfig(settings, 'taskbar'))
const wrapper = ref<HTMLElement>()
const lightTheme = computed(() => config.value.colorMode === 'light' || (config.value.colorMode === 'taskbar' && layout.isLight) || (config.value.colorMode === 'taskbarInverse' && !layout.isLight))
const rootStyle = computed(() => ({
  '--external-played': lightTheme.value ? '#1a1a1a' : '#ffffff',
  '--external-unplayed': lightTheme.value ? 'rgba(0, 0, 0, .62)' : 'rgba(255, 255, 255, .5)',
  '--taskbar-button-border': lightTheme.value ? 'rgba(26, 26, 26, .24)' : 'rgba(255, 255, 255, .24)',
  '--taskbar-button-hover': lightTheme.value ? 'rgba(26, 26, 26, .16)' : 'rgba(255, 255, 255, .16)',
  fontFamily: config.value.fontFamily || undefined,
  fontSize: `${config.value.fontSize}px`,
  fontWeight: config.value.fontWeight,
}))
const items = computed(() => {
  const line = currentLine.value
  const index = primaryIndex.value
  const list: Array<{ key: string, line?: Line, text?: string }> = []
  if (!line) {
    list.push({ key: 'meta-title', text: track.title })
    if (config.value.doubleLine) list.push({ key: 'meta-artist', text: track.artist || '未知歌手' })
    return list
  }
  list.push({ key: `line-${index}`, line })
  if (config.value.showTranslation && line.translation) list.push({ key: `translation-${index}`, text: line.translation })
  else if (config.value.doubleLine && lines.value[index + 1]) list.push({ key: `line-${index + 1}`, line: lines.value[index + 1] })
  return list
})
let leaveTimer: ReturnType<typeof setTimeout> | undefined
let sizeFrame = 0
let observer: ResizeObserver | null = null
let lastWidth = 0
function setHovered(value: boolean) {
  if (leaveTimer) clearTimeout(leaveTimer)
  if (value) hovered.value = true
  else leaveTimer = setTimeout(() => { hovered.value = false }, 40)
}
function report() {
  sizeFrame = 0
  const root = wrapper.value
  if (!root) return
  const maximum = Math.max(0, layout.maxWidth)
  const wrapperStyle = getComputedStyle(root)
  const textArea = root.querySelector<HTMLElement>('.taskbar-text')
  const textStyle = textArea ? getComputedStyle(textArea) : null
  const fixedWidth = Number.parseFloat(wrapperStyle.paddingLeft) + Number.parseFloat(wrapperStyle.paddingRight) +
    (root.querySelector<HTMLElement>('.taskbar-cover')?.offsetWidth ?? 0) +
    (textStyle ? Number.parseFloat(textStyle.marginLeft) + Number.parseFloat(textStyle.marginRight) : 0)
  const textElements = root.querySelectorAll<HTMLElement>('.taskbar-lines .external-line:not(.taskbar-line-leave-active) .external-line-content')
  const textWidth = Math.max(0, ...Array.from(textElements, element => {
    const line = element.closest<HTMLElement>('.external-line')!
    const actualFont = Number.parseFloat(getComputedStyle(line).fontSize)
    const targetFont = config.value.fontSize * (line.classList.contains('secondary') ? 0.82 : 1)
    return actualFont > 0 ? element.scrollWidth * targetFont / actualFont : element.scrollWidth
  }))
  // Measure natural text at its target font size, leaving room for rounding
  // and the soft edge of the word highlight before applying native clipping.
  const target = hovered.value ? maximum : Math.min(maximum, textWidth + fixedWidth + 8)
  const width = Math.ceil(target)
  if (width === lastWidth) return
  lastWidth = width
  reportSize(width, root.clientHeight)
}
function scheduleReport() { if (!sizeFrame) sizeFrame = requestAnimationFrame(report) }
watch(items, () => { void nextTick(scheduleReport) })
watch(() => [config.value.fontSize, config.value.fontWeight, config.value.fontFamily, config.value.showCover, config.value.doubleLine, layout.maxWidth, hovered.value], () => { void nextTick(scheduleReport) })
onMounted(() => {
  observer = new ResizeObserver(scheduleReport)
  if (wrapper.value) observer.observe(wrapper.value)
  scheduleReport()
})
onBeforeUnmount(() => { observer?.disconnect(); if (leaveTimer) clearTimeout(leaveTimer); if (sizeFrame) cancelAnimationFrame(sizeFrame) })
</script>

<style lang="less">
.taskbar-wrapper { width: 100%; height: 100%; box-sizing: border-box; padding: 0 6px; display: flex; align-items: center; }
.taskbar-external { height: calc(100% - 8px); width: 100%; display: flex; align-items: center; border-radius: 8px; box-sizing: border-box; overflow: hidden; color: var(--external-played); transition: background .3s; &.hovered.background { background: rgba(255, 255, 255, .12); } &.light.hovered.background { background: rgba(0, 0, 0, .08); } .external-line { padding: 0; line-height: 1.2; transform-origin: left center; } .external-line.secondary { font-size: .82em; } }
.taskbar-cover { flex: none; height: 100%; aspect-ratio: 1; padding: 4px; box-sizing: border-box; overflow: hidden; .external-cover { width: 100%; height: 100%; border-radius: 6px; } }
.taskbar-text { flex: 1; min-width: 0; height: 100%; position: relative; margin: 0 4px; overflow: hidden; }
.taskbar-lines, .taskbar-meta { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-evenly; transition: opacity .18s; }
.taskbar-meta { opacity: 0; pointer-events: none; }
.taskbar-title, .taskbar-artist { width: fit-content; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.taskbar-artist { font-size: .82em; color: var(--external-unplayed); }
.taskbar-controls { display: flex; flex: none; align-self: stretch; max-width: 0; overflow: hidden; pointer-events: none; transition: max-width .45s cubic-bezier(.22, 1, .36, 1); }
.taskbar-controls-inner { display: flex; align-items: center; gap: 4px; padding: 4px; box-sizing: border-box; opacity: 0; transition: opacity .25s; button { flex: none; height: 100%; aspect-ratio: 1; padding: 0; box-sizing: border-box; display: grid; place-items: center; border: 1px solid var(--taskbar-button-border); border-radius: 6px; background: transparent; color: var(--external-played); cursor: pointer; transition: background .3s, transform .3s; &:hover { background: var(--taskbar-button-hover); } &:active { transform: scale(.9); } svg { width: 14px; height: 14px; } } }
.taskbar-external.hovered { .taskbar-controls { max-width: calc(3 * (100vh - 16px) + 16px); pointer-events: auto; } .taskbar-controls-inner { opacity: 1; transition-delay: .1s; } .taskbar-lines { opacity: 0; pointer-events: none; } .taskbar-meta { opacity: 1; transition-delay: .08s; pointer-events: auto; } }
.taskbar-wrapper[data-align=right] { .taskbar-external { flex-direction: row-reverse; } .taskbar-meta { align-items: flex-end; } .external-line { transform-origin: right center; } }
.taskbar-line-move, .taskbar-line-enter-active, .taskbar-line-leave-active { transition: transform .4s cubic-bezier(.4,0,.2,1), opacity .4s, font-size .4s; }
.taskbar-line-leave-active { position: absolute; left: 0; right: 0; }
.taskbar-line-enter-from { opacity: 0; transform: translateY(100%); }
.taskbar-line-leave-to { opacity: 0; transform: translateY(-100%); }
</style>
