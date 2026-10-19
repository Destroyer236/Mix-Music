<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getExternalLyricConfig } from '@common/externalLyric'
import { control, currentLine, hovered, layout, lines, primaryIndex, reportSize, settings, startDrag, track } from '../core/externalState'
import type { ExternalLine as Line } from '../core/externalTiming'
import ExternalCover from './ExternalCover.vue'
import IslandLyricLine from './IslandLyricLine.vue'

const config = computed(() => getExternalLyricConfig(settings, 'island'))
const NOTCH_HEIGHT = 29
const NOTCH_TOP_FILL = 3
const SHAPE_SIDE_OVERHANG = 5
const MIN_SHAPE_WIDTH = 191
const MAX_WINDOW_WIDTH = 620
const MAX_WINDOW_WIDTH_RATIO = 0.55
const MIN_LYRIC_SCALE = 0.78
const mainRowHeight = computed(() => Math.round(40 * config.value.scale))
const padX = computed(() => Math.round(mainRowHeight.value * 0.4))
const gap = computed(() => Math.round(mainRowHeight.value * 0.25))
const coverSize = computed(() => Math.round(mainRowHeight.value * 0.65))
const coverRadius = computed(() => Math.max(6, Math.round(coverSize.value * 0.35)))
const fontSize = computed(() => Math.max(13, Math.round(mainRowHeight.value * 0.5)))
const radiusScale = computed(() => Math.max(0, Math.min(200, config.value.cornerRadius)) / 100)
const snapRadius = computed(() => Math.round(mainRowHeight.value * 0.6) * radiusScale.value)
const shapeBottomRadius = computed(() => Math.max(14, Math.round(coverRadius.value * 2)) * radiusScale.value)
const subFontSize = computed(() => Math.max(11, Math.round(fontSize.value * 0.65)))
const subRowHeight = computed(() => Math.round(subFontSize.value * 1.2))
const notchFusion = computed(() => window.os === 'mac' && config.value.notchFusion && layout.snapped)
const current = computed(() => currentLine.value)
const fallbackText = computed(() => track.artist ? `${track.title} - ${track.artist}` : track.title)
const lineText = (line: Line) => line.text
const subTextFor = (index: number, line: Line | null) => {
  if (config.value.showTranslation && line?.translation) return line.translation
  if (!config.value.doubleLine || index < 0) return ''
  return lines.value[index + 1]?.text || ''
}

const displayLine = ref<Line | null>(null)
const displayFallback = ref('LinkLine')
const displayIndex = ref(-1)
const displaySubText = ref('')
const showSubLine = computed(() => config.value.doubleLine || displaySubText.value !== '')
const contentHeight = computed(() => mainRowHeight.value + (showSubLine.value ? subRowHeight.value : 0))
const windowHeight = computed(() => contentHeight.value + (notchFusion.value ? NOTCH_HEIGHT + NOTCH_TOP_FILL : 0))
const rawLyricWidth = ref(1)
const lyricWidth = ref(1)
const lyricOpacity = ref(1)
const shrinking = ref(false)
const phase = ref<'idle' | 'shrinking' | 'expanding'>('idle')
let hasPainted = false
let pendingShrink: ReturnType<typeof setTimeout> | undefined
let reportedWidth = 0
let reportedHeight = 0

const measureContext = document.createElement('canvas').getContext('2d')!
function measureTextWidth(text: string, size = fontSize.value) {
  const family = config.value.fontFamily || getComputedStyle(document.documentElement).fontFamily
  measureContext.font = `${config.value.fontWeight} ${size}px ${family}`
  return Math.ceil(measureContext.measureText(text).width)
}
const measureTarget = () => {
  const line = current.value
  const main = line ? lineText(line) : fallbackText.value
  const sub = subTextFor(primaryIndex.value, line)
  return Math.max(1, measureTextWidth(main), sub ? measureTextWidth(sub, subFontSize.value) : 0)
}
const fixedContentWidth = computed(() => padX.value * 2 + coverSize.value + gap.value)
const shapeExtraWidth = computed(() => notchFusion.value ? SHAPE_SIDE_OVERHANG * 2 : 0)
const maxLyricSlotWidth = computed(() => Math.max(1, Math.min(MAX_WINDOW_WIDTH, Math.floor(window.screen.width * MAX_WINDOW_WIDTH_RATIO)) - fixedContentWidth.value - shapeExtraWidth.value))
const getLyricSlotWidth = (width: number) => notchFusion.value ? Math.min(Math.max(1, Math.round(width)), maxLyricSlotWidth.value) : Math.max(1, Math.round(width))
const computeWindowWidth = (width: number) => {
  const overshoot = config.value.transition === 'bounce' ? 0.15 : config.value.transition === 'smooth' && !notchFusion.value ? 0.15 : 0
  return Math.max(notchFusion.value ? MIN_SHAPE_WIDTH : 1, fixedContentWidth.value + width + Math.ceil(width * overshoot) + shapeExtraWidth.value)
}

function reportWindow(width: number) {
  const height = windowHeight.value
  if (width === reportedWidth && height === reportedHeight) return
  reportedWidth = width
  reportedHeight = height
  reportSize(width, height)
}
function resizeWindow(width: number) {
  const target = computeWindowWidth(width)
  if (pendingShrink) clearTimeout(pendingShrink)
  if (config.value.transition === 'smooth' && !notchFusion.value) {
    if (target >= reportedWidth || !hasPainted) reportWindow(target)
    else pendingShrink = setTimeout(() => { reportWindow(target) }, 520)
    return
  }
  if (!notchFusion.value || target >= reportedWidth || !hasPainted) reportWindow(target)
  else pendingShrink = setTimeout(() => { reportWindow(target) }, 520)
}
function applyMeasuredWidth(width: number) {
  rawLyricWidth.value = width
  lyricWidth.value = getLyricSlotWidth(width)
  resizeWindow(width)
}
function applyImmediate() {
  displayLine.value = current.value
  displayFallback.value = fallbackText.value
  displayIndex.value = primaryIndex.value
  displaySubText.value = subTextFor(primaryIndex.value, current.value)
  shrinking.value = false
  lyricOpacity.value = 1
  applyMeasuredWidth(measureTarget())
  phase.value = 'expanding'
}
function startSmoothAnimation() {
  displayLine.value = current.value
  displayFallback.value = fallbackText.value
  displayIndex.value = primaryIndex.value
  displaySubText.value = subTextFor(primaryIndex.value, current.value)
  applyMeasuredWidth(measureTarget())
  phase.value = 'idle'
}
function startSwapAnimation() {
  phase.value = 'shrinking'
  shrinking.value = true
  lyricWidth.value = 0
  lyricOpacity.value = 0
}
function onLyricTransitionEnd(event: TransitionEvent) {
  if (event.propertyName !== 'width' || phase.value !== 'shrinking') return
  displayLine.value = current.value
  displayFallback.value = fallbackText.value
  displayIndex.value = primaryIndex.value
  displaySubText.value = subTextFor(primaryIndex.value, current.value)
  const target = measureTarget()
  rawLyricWidth.value = target
  resizeWindow(target)
  requestAnimationFrame(() => {
    if (phase.value !== 'shrinking') return
    shrinking.value = false
    requestAnimationFrame(() => {
      if (phase.value !== 'shrinking') return
      phase.value = 'expanding'
      lyricOpacity.value = 1
      lyricWidth.value = getLyricSlotWidth(target)
    })
  })
}

watch([current, fallbackText], () => {
  const changed = current.value ? displayIndex.value !== primaryIndex.value : displayFallback.value !== fallbackText.value
  if (!changed) return
  if (config.value.transition === 'smooth') { startSmoothAnimation(); return }
  if (phase.value === 'shrinking') return
  if (!hasPainted || lyricWidth.value === 0) { applyImmediate(); return }
  startSwapAnimation()
})
watch(() => [config.value.doubleLine, config.value.showTranslation], () => {
  displaySubText.value = subTextFor(displayIndex.value, displayLine.value)
  if (phase.value === 'idle') applyMeasuredWidth(measureTarget())
})
watch(() => [config.value.scale, config.value.fontWeight, config.value.fontFamily, notchFusion.value], () => {
  if (phase.value === 'idle') applyMeasuredWidth(measureTarget())
})
watch(() => config.value.transition, () => {
  shrinking.value = false
  lyricOpacity.value = 1
  phase.value = 'idle'
  startSmoothAnimation()
})
watch(windowHeight, height => { reportWindow(reportedWidth || computeWindowWidth(measureTarget())) })

const lyricScale = computed(() => !notchFusion.value ? 1 : Math.max(MIN_LYRIC_SCALE, Math.min(1, lyricWidth.value / Math.max(1, rawLyricWidth.value))))
const lyricLayoutWidth = computed(() => Math.max(1, Math.floor(Math.max(1, lyricWidth.value) / lyricScale.value)))
function truncateText(text: string, maxWidth: number, size: number) {
  if (!text || measureTextWidth(text, size) <= maxWidth) return text
  const ellipsis = '...'
  if (maxWidth <= measureTextWidth(ellipsis, size)) return ellipsis
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (measureTextWidth(`${text.slice(0, mid)}${ellipsis}`, size) <= maxWidth) low = mid
    else high = mid - 1
  }
  return `${text.slice(0, low)}${ellipsis}`
}
const displayMainText = computed(() => displayLine.value ? lineText(displayLine.value) : displayFallback.value)
const fittedMainText = computed(() => notchFusion.value ? truncateText(displayMainText.value, lyricLayoutWidth.value, fontSize.value) : displayMainText.value)
const fittedSubText = computed(() => notchFusion.value ? truncateText(displaySubText.value, lyricLayoutWidth.value, subFontSize.value) : displaySubText.value)
const mainTextTruncated = computed(() => fittedMainText.value !== displayMainText.value)
const fittedDisplayLine = computed(() => {
  if (!displayLine.value || !mainTextTruncated.value) return displayLine.value
  return { ...displayLine.value, text: fittedMainText.value, words: [{ start: displayLine.value.start, end: displayLine.value.end, text: fittedMainText.value }] }
})
const shapeWidth = computed(() => Math.max(MIN_SHAPE_WIDTH, Math.round(notchFusion.value ? Math.max(reportedWidth, computeWindowWidth(rawLyricWidth.value)) : reportedWidth)))
const shapeHeight = computed(() => Math.max(windowHeight.value, reportedHeight || NOTCH_HEIGHT))
const notchPath = computed(() => {
  const width = shapeWidth.value
  const height = shapeHeight.value
  const overhang = Math.min(SHAPE_SIDE_OVERHANG, width / 4)
  const left = overhang
  const right = width - overhang
  const topArc = Math.min(overhang * radiusScale.value, height / 4)
  const bottom = Math.min(shapeBottomRadius.value, width / 2, height / 2)
  return ['M 0 0', `L ${width} 0`, `Q ${right} 0 ${right} ${topArc}`, `L ${right} ${height - bottom}`, `Q ${right} ${height} ${right - bottom} ${height}`, `L ${left + bottom} ${height}`, `Q ${left} ${height} ${left} ${height - bottom}`, `L ${left} ${topArc}`, `Q ${left} 0 0 0`, 'Z'].join(' ')
})
const rootStyle = computed(() => ({
  '--island-played': config.value.playedColor,
  '--island-unplayed': config.value.unplayedColor,
  '--external-played': config.value.playedColor,
  '--external-unplayed': config.value.unplayedColor,
  '--island-background': config.value.backgroundColor,
  '--island-background-opacity': Math.max(0, Math.min(100, config.value.backgroundOpacity)) / 100,
  '--island-padx': `${padX.value}px`,
  '--island-gap': `${gap.value}px`,
  '--island-cover': `${coverSize.value}px`,
  '--island-cover-radius': `${coverRadius.value}px`,
  '--island-row': `${mainRowHeight.value}px`,
  '--island-content-height': `${contentHeight.value}px`,
  '--island-shape-width': `${shapeWidth.value}px`,
  '--island-fusion-width': `${Math.max(1, shapeWidth.value - SHAPE_SIDE_OVERHANG * 2)}px`,
  '--island-snap-radius': `${snapRadius.value}px`,
  '--island-floating-radius': `${contentHeight.value / 2 * radiusScale.value}px`,
  '--island-scale': lyricScale.value,
  fontFamily: config.value.fontFamily || undefined,
  fontWeight: config.value.fontWeight,
  '-webkit-app-region': config.value.useCSSDrag ? 'drag' : 'no-drag',
}))

onMounted(() => {
  displayFallback.value = fallbackText.value
  const width = measureTarget()
  rawLyricWidth.value = width
  lyricWidth.value = getLyricSlotWidth(width)
  reportWindow(computeWindowWidth(width))
  requestAnimationFrame(() => { requestAnimationFrame(() => { hasPainted = true }) })
})
onBeforeUnmount(() => { if (pendingShrink) clearTimeout(pendingShrink) })
</script>

<template>
  <div class="island-viewport" :style="rootStyle" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <div class="island-root" :class="[layout.snapped ? 'is-snapped' : 'is-floating', { 'is-hidden': config.nonOcclusive && hovered, 'is-notch-fusion': notchFusion, 'is-smooth': config.transition === 'smooth', 'is-shrinking': shrinking }]" @pointerdown="startDrag" @dblclick="control('focus-main')" @contextmenu.prevent="control('open-settings')">
      <svg v-if="notchFusion" class="notch-shape" :viewBox="`0 0 ${shapeWidth} ${shapeHeight}`" preserveAspectRatio="none" aria-hidden="true"><path :d="notchPath" fill="var(--island-background)" /></svg>
      <div class="island-content">
        <div class="island-cover"><ExternalCover /></div>
        <div class="island-lyric" :style="{ width: `${lyricWidth}px`, opacity: lyricOpacity }" @transitionend="onLyricTransitionEnd">
          <div class="island-lyric-scale" :style="notchFusion ? { width: `${lyricLayoutWidth}px`, transform: `scale(${lyricScale})` } : {}">
            <Transition name="island-roll">
              <div :key="displayLine ? `line-${displayIndex}` : `fallback-${displayFallback}`" class="island-lyric-content">
                <div class="main-line">
                  <IslandLyricLine v-if="fittedDisplayLine" :line="fittedDisplayLine" :font-size="fontSize" :font-weight="config.fontWeight" :word-by-word="config.wordByWord && !mainTextTruncated" />
                  <div v-else class="fallback" :style="{ fontSize: `${fontSize}px` }">{{ fittedMainText }}</div>
                </div>
                <div v-if="showSubLine" class="sub-line" :style="{ fontSize: `${subFontSize}px` }">{{ fittedSubText }}</div>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less">
.island-viewport { width: 100%; height: 100%; display: flex; justify-content: center; align-items: flex-start; }
.island-root { position: relative; height: 100%; overflow: hidden; box-sizing: border-box; cursor: move; color: var(--island-played); transition: border-radius .3s cubic-bezier(.22,.61,.36,1), opacity .2s ease-out; }
.island-root.is-hidden { opacity: 0; }
.island-root:not(.is-notch-fusion) { width: fit-content; }
.island-root:not(.is-notch-fusion):not(.is-smooth)::before, .island-root.is-smooth:not(.is-notch-fusion) .island-content::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--island-background); opacity: var(--island-background-opacity); pointer-events: none; }
.island-root.is-smooth:not(.is-notch-fusion) .island-content::before { z-index: -1; }
.island-root.is-snapped { border-radius: 0 0 var(--island-snap-radius) var(--island-snap-radius); }
.island-root.is-notch-fusion { width: 100%; background: transparent; border-radius: 0; }
.island-root.is-floating { border-radius: var(--island-floating-radius); }
.island-root.is-smooth:not(.is-notch-fusion) { display: flex; justify-content: center; width: 100%; background: transparent; }
.island-root.is-smooth:not(.is-notch-fusion) .island-content { flex: 0 0 auto; width: fit-content; }
.island-root.is-smooth.is-snapped:not(.is-notch-fusion) .island-content { border-radius: 0 0 var(--island-snap-radius) var(--island-snap-radius); }
.island-root.is-smooth.is-floating:not(.is-notch-fusion) .island-content { border-radius: var(--island-floating-radius); }
.notch-shape { position: absolute; inset: 0 auto auto 50%; width: var(--island-shape-width); height: 100%; transform: translateX(-50%); opacity: var(--island-background-opacity); pointer-events: none; transition: width .5s cubic-bezier(.34,1.56,.64,1); }
.island-content { position: relative; z-index: 1; display: flex; align-items: center; gap: var(--island-gap); min-width: 0; height: 100%; padding: 0 var(--island-padx); box-sizing: border-box; }
.island-root:not(.is-notch-fusion) .island-content { width: fit-content; }
.island-root.is-notch-fusion .island-content { width: 100%; }
.island-root.is-snapped.is-notch-fusion .island-content { position: absolute; left: 50%; bottom: 0; width: var(--island-fusion-width); height: var(--island-content-height); transform: translateX(-50%); transition: width .5s cubic-bezier(.34,1.56,.64,1); }
.island-cover { flex: 0 0 auto; width: var(--island-cover); height: var(--island-cover); border-radius: var(--island-cover-radius); overflow: hidden; background: rgba(255,255,255,.08); }
.island-cover .external-cover { width: 100%; height: 100%; border-radius: 0; }
.island-lyric { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; white-space: nowrap; transition: width .5s cubic-bezier(.34,1.56,.64,1), opacity .25s ease-out; }
.island-root.is-shrinking .island-lyric { transition: width .25s ease-in, opacity .25s ease-in; }
.island-lyric-scale { position: relative; flex: 0 0 auto; min-width: 0; transform-origin: center center; }
.island-lyric-content { width: 100%; }
.island-lyric .external-line { padding: 0; }
.island-root.is-smooth .island-roll-enter-active, .island-root.is-smooth .island-roll-leave-active { will-change: transform, opacity; transition: transform .5s cubic-bezier(.33,1,.68,1), opacity .25s ease-out; }
.island-root.is-smooth .island-roll-leave-active { position: absolute; inset: 0; }
.island-root.is-smooth .island-roll-enter-from { opacity: 0; transform: translateY(10px); }
.island-root.is-smooth .island-roll-leave-to { opacity: 0; transform: translateY(-10px); }
.main-line { display: flex; align-items: center; justify-content: center; min-width: 0; width: 100%; overflow: hidden; }
.fallback { max-width: 100%; overflow: hidden; color: var(--island-played); text-overflow: ellipsis; white-space: nowrap; }
.sub-line { display: flex; align-items: center; justify-content: center; min-width: 0; width: 100%; max-width: 100%; overflow: hidden; color: var(--island-played); opacity: .65; text-overflow: ellipsis; white-space: nowrap; }
</style>
