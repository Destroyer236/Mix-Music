<template><canvas ref="canvas" class="ui-category-motion" aria-hidden="true" /></template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props: { symbol: string } = defineProps<{ symbol: string }>()
const canvas = ref<HTMLCanvasElement | null>(null)
interface Particle { x: number, y: number, targetX: number, targetY: number, character: string }
let particles: Particle[] = []
let context: CanvasRenderingContext2D | null = null
let frame = 0
let lastTime = 0
let activeUntil = 0
let pointer: { x: number, y: number } | null = null
let color = ''
let motionPreference: MediaQueryList | null = null
let mounted = false
const size = 128
function paint() {
  if (!context) return
  context.clearRect(0, 0, size, size)
  context.fillStyle = color
  context.font = '5px monospace'
  context.textAlign = 'center'
  for (const p of particles) context.fillText(p.character, p.x, p.y)
}
function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; lastTime = 0 }
function settle() { for (const p of particles) { p.x = p.targetX; p.y = p.targetY } paint() }
function animate(time: number) {
  frame = 0
  if (!mounted || document.hidden || motionPreference?.matches) { settle(); return }
  const delta = Math.min(32, lastTime ? time - lastTime : 16)
  lastTime = time
  const easing = 1 - Math.exp(-delta / 95)
  for (const p of particles) {
    let x = p.targetX
    let y = p.targetY
    if (pointer) {
      const dx = x - pointer.x
      const dy = y - pointer.y
      const distance = Math.hypot(dx, dy)
      const force = Math.max(0, 1 - distance / 65) * 18
      x += dx / Math.max(distance, 1) * force
      y += dy / Math.max(distance, 1) * force
    }
    p.x += (x - p.x) * easing
    p.y += (y - p.y) * easing
  }
  paint()
  if (time < activeUntil) frame = requestAnimationFrame(animate)
  else { lastTime = 0; if (!pointer) settle() }
}
function start() {
  if (!mounted || document.hidden || motionPreference?.matches) { settle(); return }
  activeUntil = performance.now() + 850
  if (!frame) frame = requestAnimationFrame(animate)
}
function create() {
  if (!canvas.value) return
  stop()
  const scale = Math.min(window.devicePixelRatio || 1, 1.5)
  canvas.value.width = size * scale
  canvas.value.height = size * scale
  context = canvas.value.getContext('2d')
  if (!context) return
  context.setTransform(scale, 0, 0, scale, 0, 0)
  color = getComputedStyle(canvas.value).color
  const sample = document.createElement('canvas')
  sample.width = size; sample.height = size
  const ink = sample.getContext('2d', { willReadFrequently: true })
  if (!ink) return
  ink.font = '52px "Segoe UI Symbol", "Microsoft YaHei", sans-serif'
  ink.textAlign = 'center'
  ink.fillText(props.symbol, 64, 57)
  const pixels = ink.getImageData(0, 0, size, size).data
  particles = []
  const characters = '01+·:/'
  for (let y = 10; y < 65; y += 3) {
    for (let x = 20; x < 108; x += 3) {
      if (pixels[(y * size + x) * 4 + 3] < 70 || particles.length >= 320) continue
      const angle = particles.length * 2.399963
      particles.push({ targetX: x, targetY: y, x: x + Math.cos(angle) * 28, y: y + Math.sin(angle) * 28, character: characters[particles.length % characters.length] })
    }
  }
  pointer = null
  start()
}
function move(event: PointerEvent) {
  if (!canvas.value || event.pointerType === 'touch' || motionPreference?.matches) return
  const box = canvas.value.getBoundingClientRect()
  pointer = { x: (event.clientX - box.x) / box.width * size, y: (event.clientY - box.y) / box.height * size }
  start()
}
function release() { pointer = null; start() }
function visibility() { if (document.hidden) { stop(); pointer = null } else { settle() } }
function preference() { stop(); pointer = null; settle() }
watch(() => props.symbol, () => { if (mounted) create() })
onMounted(() => {
  mounted = true
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionPreference.addEventListener('change', preference)
  document.addEventListener('visibilitychange', visibility)
  create()
})
onBeforeUnmount(() => {
  mounted = false
  stop()
  motionPreference?.removeEventListener('change', preference)
  document.removeEventListener('visibilitychange', visibility)
  particles = []
  context = null
})
defineExpose({ move, release })
</script>
<style scoped>
.ui-category-motion { position: absolute; left: 28%; top: 28%; width: 44%; height: 44%; pointer-events: none; color: var(--modern-accent-ink); }
</style>
