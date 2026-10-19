<template>
  <div ref="viewport" class="external-line" :class="{ secondary, overflow: overflow > 0 }" :style="{ textAlign: overflow > 0 ? 'left' : align }">
    <span ref="content" class="external-line-content" :class="{ mask, marquee: overflow > 0 && !line }" :style="contentStyle">
      <span v-if="wordByWord && line" class="external-text"><span v-for="(word, index) in line.words" :key="index" class="external-word">{{ word.text }}</span></span>
      <span v-else class="external-text external-static">{{ text ?? line?.text ?? '' }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { now, playing } from '../core/externalState'
import { lyricScrollOffset, wordProgress, type ExternalLine } from '../core/externalTiming'

const props = withDefaults(defineProps<{
  line?: ExternalLine | null
  text?: string
  align?: 'left' | 'center' | 'right'
  wordByWord?: boolean
  secondary?: boolean
  mask?: boolean
  active?: boolean
}>(), { line: null, text: undefined, align: 'left', wordByWord: false, secondary: false, mask: false, active: true })
const viewport = ref<HTMLElement>()
const content = ref<HTMLElement>()
const overflow = ref(0)
let activatedAt = now.value
let observer: ResizeObserver | null = null
let frame = 0
let wordElements: HTMLElement[] = []
let lastWordProgress: number[] = []
function measure() {
  overflow.value = Math.max(0, (content.value?.scrollWidth ?? 0) - (viewport.value?.clientWidth ?? 0))
  render()
  schedule()
}
const contentStyle = computed(() => ({
  '--overflow': `${-overflow.value}px`,
  '--marquee-duration': `${Math.max(4, overflow.value / 30 + 3)}s`,
}))
function refreshElements() {
  wordElements = Array.from(content.value?.querySelectorAll<HTMLElement>('.external-word') ?? [])
  lastWordProgress = Array(wordElements.length).fill(Number.NaN)
}
function shouldAnimate() {
  return playing.value && !!props.line && !!props.active && (props.wordByWord || overflow.value > 0)
}
function schedule() {
  if (!frame && shouldAnimate()) frame = requestAnimationFrame(animate)
}
function animate() {
  frame = 0
  render()
  schedule()
}
function render() {
  const line = props.line
  const current = now.value
  if (line && props.wordByWord) {
    // Update only words whose highlight changed. Normally just the active word needs a
    // style write per frame; completed and upcoming words stay untouched.
    for (let index = 0; index < wordElements.length; index++) {
      const progress = props.active ? wordProgress(line.words[index], current) : 0
      if (progress !== lastWordProgress[index]) {
        wordElements[index].style.setProperty('--progress', `${progress * 100}%`)
        lastWordProgress[index] = progress
      }
    }
  }
  if (line && props.active && overflow.value > 0 && content.value) {
    content.value.style.transform = `translateX(${lyricScrollOffset(current, line, activatedAt, overflow.value)}px)`
  } else if (content.value) content.value.style.removeProperty('transform')
}
watch(() => [props.line, props.text, props.active, props.wordByWord, playing.value], () => {
  activatedAt = now.value
  void nextTick(() => {
    refreshElements(); measure()
    if (!shouldAnimate() && frame) { cancelAnimationFrame(frame); frame = 0 }
    schedule()
  })
})
// A paused seek still changes the displayed progress, without starting a frame loop.
watch(() => playing.value ? null : now.value, () => { render() }, { flush: 'post' })
onMounted(() => {
  observer = new ResizeObserver(measure)
  if (viewport.value) observer.observe(viewport.value)
  if (content.value) observer.observe(content.value)
  refreshElements(); measure(); schedule()
})
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame) })
</script>

<style lang="less">
.external-line { width: 100%; min-width: 0; overflow: hidden; white-space: nowrap; line-height: 1.4; padding: 3px 0; box-sizing: border-box; }
.external-line-content { display: inline-block; vertical-align: top; white-space: pre; will-change: transform; }
.external-line-content.mask { padding: .12em .4em; border-radius: 6px; background: var(--external-mask); }
.external-text { filter: drop-shadow(0 0 1px var(--external-stroke, transparent)) drop-shadow(0 0 2px var(--external-stroke, transparent)); }
.external-word { --progress: 0%; color: transparent; -webkit-text-fill-color: transparent; background: linear-gradient(90deg, var(--external-played) 0%, var(--external-played) calc(var(--progress) - 2px), var(--external-unplayed) calc(var(--progress) + 2px), var(--external-unplayed) 100%); background-clip: text; -webkit-background-clip: text; }
.external-static { color: var(--external-played); }
.external-line.secondary .external-static { color: var(--external-unplayed); }
.external-line-content.marquee { animation: external-marquee var(--marquee-duration) ease-in-out infinite alternate; }
@keyframes external-marquee { 0%, 22% { transform: translateX(0); } 78%, 100% { transform: translateX(var(--overflow)); } }
@media (prefers-reduced-motion: reduce) { .external-line-content.marquee { animation: none; } }
</style>
