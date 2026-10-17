<template><canvas ref="canvas" class="ll-full-spectrum" aria-hidden="true" /></template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { getAnalyser, setMediaDeviceId } from '@renderer/plugins/player'
import { isPlay } from '@renderer/store/player/state'
import { appSetting, mergeSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import { patchPlayerPresentation } from '../services/playerPresentation'
const emit = defineEmits<{ notice: [message: string] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
let frame = 0
let observer: ResizeObserver | undefined
let width = 0
let height = 0
let ready = false
let disposed = false
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
let values: Uint8Array<ArrayBuffer> | null = null
const bars = new Float32Array(72)
function stop() { cancelAnimationFrame(frame); frame = 0; canvas.value?.getContext('2d')?.clearRect(0, 0, width, height) }
function draw() {
  const element = canvas.value; const context = element?.getContext('2d')
  if (!context || !element || !isPlay.value || document.hidden || reduced.matches) { stop(); return }
  let analyser: AnalyserNode | null
  try { analyser = getAnalyser() } catch { stop(); patchPlayerPresentation({ spectrum: false }); emit('notice', '当前音频暂不支持频谱'); return }
  context.clearRect(0, 0, width, height)
  if (analyser) {
    if (values?.length !== analyser.frequencyBinCount) values = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(values)
    context.fillStyle = getComputedStyle(element).color
    const barWidth = width / bars.length
    for (let index = 0; index < bars.length; index++) {
      const bin = Math.floor((index / bars.length) ** 1.8 * values.length * 0.7)
      bars[index] += (values[bin] / 255 - bars[index]) * 0.22
      const barHeight = bars[index] * height
      context.fillRect(index * barWidth, height - barHeight, Math.max(1, barWidth - 3), barHeight)
    }
  }
  frame = requestAnimationFrame(draw)
}
function start() { stop(); if (ready && isPlay.value && !document.hidden && !reduced.matches) frame = requestAnimationFrame(draw) }
watch(isPlay, start)
onMounted(async() => {
  observer = new ResizeObserver(() => {
    const element = canvas.value; if (!element) return
    const rect = element.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio, 2)
    width = rect.width; height = rect.height; element.width = Math.round(width * ratio); element.height = Math.round(height * ratio); element.getContext('2d')?.scale(ratio, ratio)
  })
  if (canvas.value) observer.observe(canvas.value)
  document.addEventListener('visibilitychange', start); reduced.addEventListener('change', start)
  try {
    if (appSetting['player.mediaDeviceId'] !== 'default') {
      await setMediaDeviceId('default')
      const setting = { 'player.mediaDeviceId': 'default' }
      await updateSetting(setting); mergeSetting(setting)
      if (!disposed) emit('notice', '音频频谱使用系统默认输出设备')
    }
    if (!disposed) { ready = true; start() }
  } catch { if (!disposed) { patchPlayerPresentation({ spectrum: false }); emit('notice', '暂时无法开启频谱，请检查输出设备') } }
})
onBeforeUnmount(() => { disposed = true; stop(); observer?.disconnect(); document.removeEventListener('visibilitychange', start); reduced.removeEventListener('change', start) })
</script>
<style>.ll-full-spectrum { position: absolute; z-index: -1; bottom: 0; left: 0; width: 100%; height: 25%; color: var(--modern-accent-ink); opacity: .12; pointer-events: none; }</style>
