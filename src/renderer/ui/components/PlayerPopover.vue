<template>
  <Teleport to="body"><section v-if="show" :id="id" ref="panel" class="ui-player-popover" :class="panelClass" :style="[detailTheme, position]" role="dialog" aria-modal="false" :aria-label="title" tabindex="-1" @keydown="onKey"><header v-if="showHeader"><div><h2>{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p></div><button type="button" class="ui-icon-button" :aria-label="'关闭' + title" @click="emit('close')"><UiIcon name="close" /></button></header><div class="ui-player-popover-content scroll"><slot /></div></section></Teleport>
</template>
<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { playerDetailThemeKey } from '../playerDetailPalette'
import UiIcon from './UiIcon.vue'
const props = withDefaults(defineProps<{ show: boolean, title: string, subtitle?: string, showHeader?: boolean, id?: string, width?: number, trigger?: HTMLElement | null, panelClass?: string, anchor?: 'right' | 'trigger' | 'center' }>(), { subtitle: '', showHeader: true, id: undefined, width: 360, trigger: null, panelClass: '', anchor: 'right' })
const emit = defineEmits<{ close: [] }>()
const detailTheme = inject(playerDetailThemeKey, undefined)
const panel = ref<HTMLElement | null>(null)
const position = ref<Record<string, string>>({})
let previousFocus: HTMLElement | null = null
function place() {
  const width = Math.min(props.width, innerWidth - 32)
  if (props.anchor === 'center') {
    position.value = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: `${Math.min(width, innerHeight - 32)}px`, maxHeight: `${innerHeight - 32}px` }
    return
  }
  const trigger = props.trigger?.getBoundingClientRect()
  if (props.anchor === 'trigger' && trigger) {
    const left = Math.max(16, Math.min(trigger.left, innerWidth - width - 16))
    const above = trigger.top - 24
    const below = innerHeight - trigger.bottom - 24
    const bottom = Math.max(16, Math.min(innerHeight - trigger.top + 8, innerHeight - 16))
    const top = Math.max(16, Math.min(trigger.bottom + 8, innerHeight - 16))
    position.value = above >= Math.min(320, below)
      ? { left: `${left}px`, bottom: `${bottom}px`, width: `${width}px`, maxHeight: `${Math.max(0, Math.min(above, innerHeight - bottom - 16))}px` }
      : { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${Math.max(0, Math.min(below, innerHeight - top - 16))}px` }
    return
  }
  const player = props.trigger?.closest('.ui-player')?.getBoundingClientRect()
  const bottom = Math.max(94, player ? innerHeight - player.top + 10 : 94)
  position.value = { right: '16px', bottom: `${bottom}px`, width: `${width}px`, maxHeight: `${Math.max(120, innerHeight - bottom - 16)}px` }
}
function outside(event: PointerEvent) { const target = event.target as Node; if (!panel.value?.contains(target) && !props.trigger?.contains(target)) emit('close') }
function removeListeners() { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', place) }
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (event.target instanceof HTMLInputElement)) return
  const items = Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])
  if (!items.length) return
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  event.preventDefault()
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
  items[index]?.focus()
}
watch(() => props.show, async show => {
  removeListeners()
  if (!show) { if ((panel.value?.contains(document.activeElement) ?? false) || document.activeElement === document.body) previousFocus?.focus(); previousFocus = null; return }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : props.trigger
  place()
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', place)
  await nextTick()
  if (props.show) panel.value?.focus()
}, { immediate: true })
watch(() => [props.width, props.anchor, props.trigger], () => { if (props.show) place() })
onBeforeUnmount(removeListeners)
</script>
