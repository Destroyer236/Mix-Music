<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { now, playing } from '../core/externalState'
import { wordProgress, type ExternalLine } from '../core/externalTiming'

const props = defineProps<{
  line: ExternalLine
  fontSize: number
  fontWeight: number
  wordByWord: boolean
}>()

const wordElements: Array<HTMLElement | undefined> = []
const lineContent = ref<HTMLElement>()
let lastProgress: number[] = []
let frame = 0

const resetRenderCache = () => {
  lastProgress = []
  wordElements.length = 0
}
const refreshElements = () => {
  wordElements.splice(0, wordElements.length, ...Array.from(lineContent.value?.querySelectorAll<HTMLElement>('.island-word') ?? []))
}
const renderFrame = () => {
  if (!props.wordByWord || !playing.value) {
    frame = 0
    return
  }
  for (let index = 0; index < props.line.words.length; index++) {
    const element = wordElements[index]
    if (!element) continue
    const progress = wordProgress(props.line.words[index], now.value)
    if (lastProgress[index] !== progress) {
      lastProgress[index] = progress
      element.style.setProperty('--island-progress', `${progress * 100}%`)
    }
  }
  frame = requestAnimationFrame(renderFrame)
}
const startRenderLoop = () => {
  if (frame === 0 && props.wordByWord && playing.value) frame = requestAnimationFrame(renderFrame)
}
const stopRenderLoop = () => {
  if (frame !== 0) {
    cancelAnimationFrame(frame)
    frame = 0
  }
}

watch(() => [props.wordByWord, props.line, playing.value], () => {
  resetRenderCache()
  stopRenderLoop()
  void nextTick(() => { refreshElements(); startRenderLoop() })
})
onMounted(() => { refreshElements(); startRenderLoop() })
onBeforeUnmount(stopRenderLoop)
</script>

<template>
  <div class="island-line" :style="{ fontSize: `${fontSize}px`, fontWeight }">
    <span ref="lineContent" class="island-line-inner">
      <template v-if="wordByWord">
        <span v-for="(word, index) in line.words" :key="index" class="island-word">{{ word.text }}</span>
      </template>
      <span v-else class="island-static">{{ line.text }}</span>
    </span>
  </div>
</template>

<style lang="less">
.island-line { display: flex; align-items: center; white-space: nowrap; }
.island-line-inner { display: inline-block; text-align: center; }
.island-word { --island-progress: 0%; display: inline; color: transparent; -webkit-text-fill-color: transparent; background: linear-gradient(90deg, var(--external-played) 0%, var(--external-played) calc(var(--island-progress) - 2px), var(--external-unplayed) calc(var(--island-progress) + 2px), var(--external-unplayed) 100%); background-clip: text; -webkit-background-clip: text; }
.island-static { display: inline-block; color: var(--external-played); }
</style>
