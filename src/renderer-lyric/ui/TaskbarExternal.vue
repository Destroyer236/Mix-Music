<template>
  <div ref="wrapper" class="taskbar-wrapper" :data-align="layout.anchor" @mouseenter="setHovered(true)" @mouseleave="setHovered(false)">
    <div class="taskbar-external" :class="{ hovered, background: config.showBackground, light: lightTheme }" :style="rootStyle" @dblclick="control('focus-main')" @contextmenu.prevent="control('open-settings')">
      <ExternalCover v-if="config.showCover" />
      <div class="taskbar-controls">
        <button type="button" title="上一首" aria-label="上一首" @click.stop="control('prev')" @dblclick.stop><UiIcon name="prev" /></button>
        <button type="button" :title="playing ? '暂停' : '播放'" :aria-label="playing ? '暂停' : '播放'" @click.stop="control(playing ? 'pause' : 'play')" @dblclick.stop><UiIcon :name="playing ? 'pause' : 'play'" /></button>
        <button type="button" title="下一首" aria-label="下一首" @click.stop="control('next')" @dblclick.stop><UiIcon name="next" /></button>
      </div>
      <div class="taskbar-text">
        <TransitionGroup name="taskbar-line" tag="div" class="taskbar-lines" @after-leave="scheduleReport" @after-enter="scheduleReport">
          <ExternalLine v-for="(item, index) in items" :key="item.key" :line="item.line" :text="item.text" :secondary="index > 0" :active="index === 0" :word-by-word="config.wordByWord && !!item.line" :align="layout.anchor" />
        </TransitionGroup>
        <div class="taskbar-meta"><ExternalLine :text="track.title" :align="layout.anchor" /><ExternalLine v-if="config.doubleLine" :text="track.artist || '未知歌手'" :align="layout.anchor" secondary /></div>
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
  '--external-played': lightTheme.value ? '#141414' : '#ffffff',
  '--external-unplayed': lightTheme.value ? '#14141480' : '#ffffff80',
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
  if (!config.value.doubleLine) return list
  if (config.value.showTranslation && line.translation) list.push({ key: `translation-${index}`, text: line.translation })
  else if (lines.value[index + 1]) list.push({ key: `line-${index + 1}`, line: lines.value[index + 1] })
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
  const maximum = Math.max(100, layout.maxWidth)
  const cover = root.querySelector<HTMLElement>('.external-cover')?.offsetWidth ?? 0
  const textElements = root.querySelectorAll<HTMLElement>('.taskbar-lines .external-line:not(.taskbar-line-leave-active) .external-line-content')
  const textWidth = Math.max(0, ...Array.from(textElements, element => {
    const line = element.closest<HTMLElement>('.external-line')!
    const actualFont = Number.parseFloat(getComputedStyle(line).fontSize)
    const targetFont = config.value.fontSize * (line.classList.contains('secondary') ? 0.82 : 1)
    return actualFont > 0 ? element.scrollWidth * targetFont / actualFont : element.scrollWidth
  }))
  const target = hovered.value ? maximum : Math.min(maximum, textWidth + cover + 24)
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
.taskbar-wrapper { width: 100%; height: 100%; box-sizing: border-box; padding: 3px 4px; }
.taskbar-external { height: 100%; width: 100%; display: flex; align-items: center; gap: 4px; border-radius: 7px; box-sizing: border-box; padding: 1px 3px; color: var(--external-played); transition: background .2s; &.hovered.background { background: #ffffff17; } &.light.hovered.background { background: #00000013; } .external-cover { height: calc(100vh - 10px); width: calc(100vh - 10px); border-radius: 5px; transition: opacity .2s; } .external-line { padding: 0; line-height: 1.2; } .external-line.secondary { font-size: .82em; } }
.taskbar-text { flex: 1; min-width: 0; height: 100%; position: relative; margin: 0 4px; }
.taskbar-lines, .taskbar-meta { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-evenly; transition: opacity .18s; }
.taskbar-meta { opacity: 0; pointer-events: none; }
.taskbar-controls { width: 0; opacity: 0; overflow: hidden; height: 26px; display: flex; gap: 3px; flex: none; pointer-events: none; transition: width .3s, opacity .2s; button { width: 25px; height: 25px; padding: 0; display: grid; place-items: center; border: 1px solid currentColor; border-radius: 6px; background: transparent; color: var(--external-played); cursor: pointer; &:hover { background: #8883; } svg { width: 14px; height: 14px; } } }
.taskbar-external.hovered { .taskbar-controls { width: 81px; opacity: 1; pointer-events: auto; } .taskbar-lines { opacity: 0; } .taskbar-meta { opacity: 1; } }
.taskbar-wrapper[data-align=right] .taskbar-external { flex-direction: row-reverse; }
.taskbar-line-move, .taskbar-line-enter-active, .taskbar-line-leave-active { transition: transform .4s cubic-bezier(.4,0,.2,1), opacity .4s, font-size .4s; }
.taskbar-line-leave-active { position: absolute; left: 0; right: 0; }
.taskbar-line-enter-from { opacity: 0; transform: translateY(100%); }
.taskbar-line-leave-to { opacity: 0; transform: translateY(-100%); }
</style>
