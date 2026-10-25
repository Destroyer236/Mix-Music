<template>
  <div class="desktop-external" :class="{ hovered, locked: config.locked, animated: config.animation }" :style="rootStyle" @pointerdown="startDrag" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <div v-if="config.alwaysShowSongInfo && !hovered" class="desktop-persistent" :style="{ textAlign: config.align === 'justify' ? 'center' : config.align }"><div :class="{ mask: config.backgroundMask }"><strong>{{ track.title }}</strong><small>{{ track.artist }}</small></div></div>
    <header class="desktop-header">
      <button type="button" class="focus-main" title="显示 Mix Music" aria-label="显示 Mix Music" @click="control('focus-main')"><UiIcon name="quality" /></button>
      <div class="desktop-song"><strong>{{ track.title }}</strong><small>{{ track.artist || '桌面歌词' }}</small></div>
      <div class="desktop-playback">
        <button type="button" title="上一首" aria-label="上一首" @click="control('prev')"><UiIcon name="prev" /></button>
        <button type="button" :title="playing ? '暂停' : '播放'" :aria-label="playing ? '暂停' : '播放'" @click="control(playing ? 'pause' : 'play')"><UiIcon :name="playing ? 'pause' : 'play'" /></button>
        <button type="button" title="下一首" aria-label="下一首" @click="control('next')"><UiIcon name="next" /></button>
      </div>
      <div class="desktop-actions">
        <button type="button" title="外部歌词设置" aria-label="外部歌词设置" @click="control('open-settings')"><UiIcon name="settings" /></button>
        <button ref="unlock" type="button" class="desktop-unlock" :title="config.locked ? '解锁歌词' : '锁定歌词'" :aria-label="config.locked ? '解锁歌词' : '锁定歌词'" @click="saveSetting('locked', !config.locked)"><UiIcon name="lock" /></button>
        <button type="button" title="关闭桌面歌词" aria-label="关闭桌面歌词" @click="saveSetting('enabled', false)"><UiIcon name="close" /></button>
      </div>
    </header>
    <TransitionGroup tag="div" class="desktop-stage" name="desktop-line" :css="config.animation">
      <div v-for="(item, index) in displayItems" :key="item.key" class="desktop-row" :class="{ secondary: index > 0 }" :style="{ '--row-y': `${index * config.fontSize * 1.6}px`, '--row-scale': index > 0 ? 0.8 : 1, transformOrigin: item.align }">
        <ExternalLine :line="item.line" :text="item.text" :align="item.align" :secondary="index > 0" :word-by-word="!!item.line && config.wordByWord && (config.autoGenerateWordByWord || item.line.timed)" :active="index === 0" :mask="config.backgroundMask" />
      </div>
    </TransitionGroup>
    <div v-if="!config.locked" class="desktop-width-handle" title="调整歌词宽度" @pointerdown.stop.prevent="startResize" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ipcRenderer } from 'electron'
import UiIcon from '@renderer/ui/components/UiIcon.vue'
import { getExternalLyricConfig } from '@common/externalLyric'
import { control, currentLine, hovered, lines, playing, primaryIndex, resize, saveSetting, settings, startDrag, track } from '../core/externalState'
import type { ExternalLine as Line } from '../core/externalTiming'
import ExternalLine from './ExternalLine.vue'

const config = computed(() => getExternalLyricConfig(settings, 'desktop'))
const unlock = ref<HTMLElement>()
const rootStyle = computed(() => ({
  '--external-played': config.value.playedColor,
  '--external-unplayed': config.value.unplayedColor,
  '--external-stroke': config.value.strokeColor,
  '--external-mask': config.value.backgroundMaskColor,
  '--desktop-duration': config.value.animation ? '.4s' : '0s',
  fontSize: `${config.value.fontSize}px`,
  fontWeight: config.value.fontWeight,
  fontFamily: config.value.fontFamily || undefined,
  '-webkit-app-region': config.value.useCSSDrag && !config.value.locked ? 'drag' : 'no-drag',
}))
const align = (index: number): 'left' | 'center' | 'right' => config.value.align === 'justify' ? (index % 2 ? 'right' : 'left') : config.value.align
const displayItems = computed(() => {
  const line = currentLine.value
  const index = primaryIndex.value
  const items: Array<{ key: string, line?: Line, text?: string, align: 'left' | 'center' | 'right' }> = []
  if (!line) {
    items.push({ key: `title-${track.id}`, text: track.title, align: align(0) })
    if (config.value.doubleLine && track.artist) items.push({ key: `artist-${track.id}`, text: track.artist, align: align(0) })
    return items
  }
  items.push({ key: `line-${index}`, line, align: align(index) })
  if (config.value.showTranslation && line.translation) items.push({ key: `translation-${index}`, text: line.translation, align: align(index) })
  else if (config.value.doubleLine && lines.value[index + 1]) items.push({ key: `line-${index + 1}`, line: lines.value[index + 1], align: align(index + 1) })
  return items
})
function size() {
  const font = Math.min(96, Math.max(20, config.value.fontSize))
  resize(undefined, Math.round(140 + (font - 20) / 76 * 220))
  void nextTick(reportUnlock)
}
function reportUnlock() {
  const bounds = unlock.value?.getBoundingClientRect()
  if (bounds) ipcRenderer.send('externalLyric:unlock-bounds', { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
}
function startResize(input: Event) {
  const event = input as PointerEvent
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const origin = event.screenX
  const width = window.innerWidth
  const move = (next: PointerEvent) => { resize(Math.max(280, width + next.screenX - origin)) }
  const stop = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', stop); target.removeEventListener('pointercancel', stop); target.releasePointerCapture(event.pointerId) }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', stop)
  target.addEventListener('pointercancel', stop)
}
watch(() => config.value.fontSize, size)
onMounted(() => { size(); window.addEventListener('resize', reportUnlock) })
onBeforeUnmount(() => { window.removeEventListener('resize', reportUnlock) })
</script>

<style lang="less">
.desktop-external { position: relative; height: 100%; box-sizing: border-box; border-radius: 12px; background: transparent; cursor: move; transition: background .2s; color: #fff; &.hovered:not(.locked) { background: #0008; } &.locked { cursor: default; } }
.desktop-header { height: 56px; display: flex; align-items: center; gap: 6px; padding: 0 12px; box-sizing: border-box; button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: white; padding: 0; cursor: pointer; -webkit-app-region: no-drag; &:hover { background: #fff3; } svg { width: 19px; height: 19px; } } button, .desktop-song { opacity: 0; transition: opacity .2s; } }
.desktop-external.hovered:not(.locked) .desktop-header button, .desktop-external.hovered:not(.locked) .desktop-song, .desktop-external.hovered.locked .desktop-header .desktop-unlock { opacity: 1; }
.desktop-external.locked .desktop-header button:not(.desktop-unlock), .desktop-external.locked .desktop-song { pointer-events: none; }
.desktop-song { flex: 1; min-width: 0; strong, small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.4; } strong { font-size: 13px; font-weight: 500; } small { font-size: 11px; opacity: .65; } }
.desktop-playback, .desktop-actions { display: flex; gap: 3px; }
.desktop-playback { margin-right: auto; }
.desktop-actions { margin-left: auto; }
.desktop-persistent { position: absolute; top: 0; left: 24px; right: 24px; height: 56px; display: block; line-height: 56px; pointer-events: none; > div { display: inline-block; vertical-align: middle; line-height: 1.3; max-width: 100%; &.mask { background: var(--external-mask); padding: 4px .4em; border-radius: 6px; } } strong, small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 0 4px #000c; } strong { font-size: 14px; font-weight: 500; } small { font-size: 12px; opacity: .65; } }
.desktop-stage { position: relative; width: 100%; pointer-events: none; }
.desktop-row { position: absolute; top: 0; left: 0; right: 0; padding: 0 24px; box-sizing: border-box; transform: translateY(var(--row-y)) scale(var(--row-scale)); transition: transform var(--desktop-duration) cubic-bezier(.55,0,.1,1), opacity var(--desktop-duration); }
.desktop-line-enter-from { opacity: 0; transform: translateY(calc(var(--row-y) + 100%)) scale(var(--row-scale)); }
.desktop-line-leave-to { opacity: 0; transform: translateY(calc(var(--row-y) - 100%)) scale(var(--row-scale)); }
.desktop-width-handle { position: absolute; top: 0; bottom: 0; right: 0; width: 6px; cursor: ew-resize; -webkit-app-region: no-drag; }
@media (max-width: 430px) { .desktop-header { gap: 0; padding: 0 8px; button { width: 29px; } .focus-main { display: none; } } }
</style>
