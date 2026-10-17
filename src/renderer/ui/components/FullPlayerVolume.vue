<template>
  <div class="ll-full-volume" @pointerenter="openPanel(false)" @pointerleave="scheduleClose" @wheel.prevent="wheel">
    <button ref="trigger" type="button" class="ui-icon-button" :aria-label="isMute ? '取消静音' : '静音'" :title="`音量 ${percentage}% · 点击${isMute ? '取消静音' : '静音'}`" :aria-pressed="isMute" aria-haspopup="dialog" :aria-expanded="open" @click="setMute(!isMute)" @focus="onFocus" @blur="onBlur" @keydown="onKey"><UiIcon :name="isMute || !volume ? 'mute' : 'volume'" /></button>
    <Teleport to="body"><Transition name="ll-volume-fade"><div v-if="open" ref="panel" class="ui-volume-panel ll-full-volume-panel" :style="position" role="dialog" aria-label="音量设置" @pointerenter="cancelClose" @pointerleave="scheduleClose" @wheel.prevent="wheel" @keydown="onKey" @focusout="onBlur"><output>{{ percentage }}%</output><UiRange vertical :model-value="volume" :min="0" :max="1" :step="0.01" aria-label="音量" @input="changeVolume" /><button type="button" :aria-pressed="isMute" @click="setMute(!isMute)">{{ isMute ? '取消静音' : '静音' }}</button></div></Transition></Teleport>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { isMute, setMute, setVolume, volume } from '@renderer/store/player/volume'
import UiIcon from './UiIcon.vue'
import UiRange from './UiRange.vue'
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const open = ref(false)
const position = ref<Record<string, string>>({})
const percentage = computed(() => Math.round(volume.value * 100))
let closeTimer: ReturnType<typeof setTimeout> | undefined
let restoringFocus = false
function onFocus() { if (!restoringFocus) void openPanel(false) }
function cancelClose() { clearTimeout(closeTimer) }
function scheduleClose() { cancelClose(); closeTimer = setTimeout(() => { if (!panel.value?.contains(document.activeElement)) close() }, 180) }
function place() {
  const rect = trigger.value?.getBoundingClientRect(); if (!rect) return
  const height = panel.value?.offsetHeight ?? 220
  position.value = { left: `${Math.max(8, Math.min(rect.left + rect.width / 2 - 43, innerWidth - 94))}px`, top: `${Math.max(8, rect.top - height - 10)}px` }
}
async function openPanel(focus: boolean) {
  cancelClose()
  open.value = true
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', place)
  await nextTick()
  if (!open.value) return
  place()
  if (focus) panel.value?.querySelector('input')?.focus()
}
function close() { open.value = false; cancelClose(); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', place) }
function outside(event: Event) { if (!panel.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) close() }
function onBlur(event: FocusEvent) { if (!panel.value?.contains(event.relatedTarget as Node) && !trigger.value?.contains(event.relatedTarget as Node)) close() }
function changeVolume(value: number) { setVolume(Math.max(0, Math.min(1, value))); if (value > 0 && isMute.value) setMute(false) }
function wheel(event: Event) { const delta = (event as WheelEvent).deltaY; if (!delta) return; changeVolume(volume.value + (delta < 0 ? 0.05 : -0.05)); void openPanel(false) }
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); restoringFocus = true; trigger.value?.focus(); restoringFocus = false } else if (event.target === trigger.value && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); void openPanel(true) }
}
onBeforeUnmount(close)
</script>
<style lang="less">
.ll-full-volume { display: flex; }
.ll-full-volume-panel { width: 86px; gap: 12px; min-height: 220px; padding: 15px 10px 10px; output { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--modern-text); } input.ui-range { flex: none; } > button { width: 100%; padding: 6px 0; border: 0; border-radius: 6px; background: var(--modern-hover); color: var(--modern-text); cursor: pointer; font-size: 11px; } }
.ll-volume-fade-enter-active, .ll-volume-fade-leave-active { transition: opacity .15s, transform .15s; }.ll-volume-fade-enter-from, .ll-volume-fade-leave-to { opacity: 0; transform: translateY(6px); }
</style>
