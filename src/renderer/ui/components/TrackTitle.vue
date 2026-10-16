<template>
  <span ref="host" class="ui-track-title">
    <span ref="anchor" class="ui-track-title-text" title="" :tabindex="focusable ? 0 : undefined" :aria-describedby="open ? tooltipId : undefined" @mouseenter="onPointerEnter" @mouseleave="onPointerLeave" @focus="onFocus" @blur="onBlur"><span class="ui-track-title-primary">{{ name }}</span><span v-if="subtitle" class="ui-track-title-subtitle">{{ subtitle }}</span></span>
    <TrackBadges v-if="showBadges" :track="badgeTrack || track" :show-source="showSource" :trial="trial" />
    <Teleport to="body">
      <div v-if="open" :id="tooltipId" ref="tooltip" class="ui-track-title-tooltip" :style="position" role="tooltip">
        <div class="ui-track-title-tooltip-name">{{ name }}</div>
        <div v-if="subtitle" class="ui-track-title-tooltip-subtitle">{{ subtitle }}</div>
      </div>
    </Teleport>
  </span>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TrackBadges from './TrackBadges.vue'

const props = defineProps({
  track: { type: Object, default: null },
  text: { type: String, default: undefined },
  badgeTrack: { type: Object, default: null },
  showSource: { type: Boolean, default: true },
  showBadges: { type: Boolean, default: true },
  trial: { type: Boolean, default: false },
  focusable: { type: Boolean, default: false },
})

const host = ref(null)
const anchor = ref(null)
const tooltip = ref(null)
const open = ref(false)
const position = ref({ visibility: 'hidden' })
const tooltipId = `ui-track-title-${crypto.randomUUID()}`
const name = computed(() => props.text ?? props.track?.name ?? '')
const normalized = value => String(value ?? '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
const subtitle = computed(() => {
  const metadata = props.track?.meta
  const text = String(metadata?.subtitle || metadata?.recordingVersion || '').trim()
  const simpleText = normalized(text)
  return simpleText && !normalized(name.value).includes(simpleText) ? text : ''
})

let delayTimer = null
let focused = false
let hovered = false
let focusOwner = null
let observing = false
let version = 0

function describeOwner(visible) {
  if (!focusOwner) return
  const ids = (focusOwner.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tooltipId)
  if (visible) ids.push(tooltipId)
  if (ids.length) focusOwner.setAttribute('aria-describedby', ids.join(' '))
  else focusOwner.removeAttribute('aria-describedby')
}

function observe() {
  if (observing) return
  observing = true
  document.addEventListener('scroll', close, true)
  document.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
  window.visualViewport?.addEventListener('resize', close)
  window.visualViewport?.addEventListener('scroll', close)
}

function close() {
  version++
  if (delayTimer !== null) { clearTimeout(delayTimer); delayTimer = null }
  open.value = false
  describeOwner(false)
  if (!observing) return
  observing = false
  document.removeEventListener('scroll', close, true)
  document.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
  window.visualViewport?.removeEventListener('resize', close)
  window.visualViewport?.removeEventListener('scroll', close)
}

async function show() {
  delayTimer = null
  if (!name.value || !anchor.value?.isConnected || (!hovered && !focused)) { close(); return }
  const request = ++version
  position.value = { visibility: 'hidden' }
  open.value = true
  observe()
  await nextTick()
  if (!open.value || request !== version || !tooltip.value || !anchor.value) return
  const rect = anchor.value.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = tooltip.value.offsetWidth
  const height = tooltip.value.offsetHeight
  const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8))
  const below = rect.bottom + 10
  const top = Math.max(8, Math.min(below + height <= viewportHeight - 8 ? below : rect.top - height - 10, viewportHeight - height - 8))
  position.value = { left: `${left}px`, top: `${top}px` }
  describeOwner(true)
}

function schedule() {
  if (!name.value || open.value || delayTimer !== null) return
  observe()
  delayTimer = setTimeout(() => { void show() }, 400)
}

function onPointerEnter() { hovered = true; schedule() }
function onPointerLeave() {
  hovered = false
  if (!focused || !(focusOwner || anchor.value)?.matches(':focus-visible')) { focused = false; close() }
}
function onFocus(event) {
  focused = event.currentTarget?.matches(':focus-visible') === true
  if (!focused) return
  if (delayTimer !== null) { clearTimeout(delayTimer); delayTimer = null }
  void show()
}
function onBlur() { focused = false; if (!hovered) close() }
function onKeydown(event) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  close()
}

// Lists refresh track objects as metadata arrives; only actual song/detail
// changes should cancel a pending hover for the same title.
watch([() => props.track?.source, () => props.track?.id, name, subtitle], close)
onMounted(() => {
  // Reuse an enclosing song button's focus instead of inserting a second tab stop.
  if (props.focusable) return
  focusOwner = host.value?.parentElement?.closest('button, a[href], [role="button"], [tabindex]') ?? null
  focusOwner?.addEventListener('focus', onFocus)
  focusOwner?.addEventListener('blur', onBlur)
})
onBeforeUnmount(() => {
  close()
  focusOwner?.removeEventListener('focus', onFocus)
  focusOwner?.removeEventListener('blur', onBlur)
})
</script>

<style scoped lang="less">
.ui-track-title { display: flex; align-items: center; gap: 7px; min-width: 0; max-width: 100%; color: inherit; font: inherit; line-height: inherit; text-align: inherit; }
.ui-track-title-text { display: block; flex: 0 1 auto; min-width: 0; overflow: hidden; color: inherit; font: inherit; line-height: inherit; white-space: nowrap; text-overflow: ellipsis; }
.ui-track-title-primary, .ui-track-title-subtitle { display: inline; width: auto; color: inherit; font: inherit; line-height: inherit; }
.ui-track-title-subtitle { margin-left: 6px; color: var(--modern-muted); }
.ui-track-title-text:focus-visible { outline: 1px solid var(--modern-accent); outline-offset: 2px; border-radius: 2px; }
.ui-track-title > .ui-track-badges { flex: none; }
.ui-track-title-tooltip { position: fixed; z-index: 3100; box-sizing: border-box; width: max-content; max-width: min(560px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow: hidden; padding: 14px 18px; border-radius: 12px; background: var(--modern-panel); color: var(--modern-text); box-shadow: 0 6px 25px #0003; font-size: 13px; font-weight: 400; line-height: 1.65; text-align: left; white-space: normal; overflow-wrap: anywhere; pointer-events: none; -webkit-app-region: no-drag; }
.ui-track-title-tooltip-subtitle { margin-top: 3px; color: var(--modern-muted); }
</style>
