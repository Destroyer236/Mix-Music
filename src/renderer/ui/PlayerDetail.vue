<template>
  <Transition name="ui-detail">
    <section v-if="isShowPlayerDetail" class="ui-player-detail ui-player-detail--immersive ui-player-detail--record" :style="coverColors" aria-label="播放详情">
      <header class="ui-detail-header">
        <button type="button" class="ui-detail-back" aria-label="收起播放详情" title="返回 · Esc" @click="setShowPlayerDetail(false)"><UiIcon name="chevronDown" /></button>
        <div class="ui-detail-header-tools">
          <button type="button" class="ui-icon-button" aria-label="切换桌面歌词" title="桌面歌词" :aria-pressed="appSetting['desktopLyric.enable']" @click="toggleDesktopLyric"><UiIcon name="lyric" /></button>
          <WindowControls />
        </div>
      </header>
      <div class="ui-detail-body">
        <div class="ui-detail-song">
          <RecordPlayer :track="currentTrack" :src="musicInfo.pic" :alt="musicInfo.name || '专辑封面'" :playing="isPlay" @loaded="readCover" />
        </div>
        <div class="ui-detail-lyric-stage">
          <div class="ui-detail-metadata">
            <h1 :title="musicInfo.name">{{ musicInfo.name || '静候一首好歌' }}</h1>
            <p class="ui-detail-artists">
              <template v-if="artistNames.length"><template v-for="(artist, index) in artistNames" :key="artist"><span v-if="index" aria-hidden="true"> / </span><button type="button" class="ui-detail-metadata-link" :aria-label="`搜索歌手 ${artist}`" @click="searchMetadata('artist', artist)">{{ artist }}</button></template></template>
              <span v-else>从你的音乐库开始聆听</span>
            </p>
          </div>
          <div ref="lyricPanel" class="ui-detail-lyrics scroll" :style="{ '--ui-lyric-size': (appSetting['playDetail.style.fontSize'] / 100) + 'rem' }">
            <div v-if="!lyric.lines.length" class="ui-lyric-empty"><UiIcon name="lyric" /><p>{{ musicInfo.name ? '纯粹聆听，暂无歌词' : '歌词会随音乐在这里展开' }}</p></div>
            <button v-for="(line, index) in lyric.lines" :key="index" type="button" :data-line="index" :class="{ 'ui-lyric-current': lyric.line === index }" :aria-current="lyric.line === index ? 'true' : undefined" @click="seekLine(line)"><span>{{ line.text || '♪' }}</span><template v-if="showExtended"><small v-for="(extended, i) in line.extendedLyrics" :key="i">{{ extended }}</small></template></button>
          </div>
          <div v-if="lyric.lines.length" class="ui-detail-lyric-tools">
            <button type="button" aria-label="复制歌词" title="复制歌词" @click="copyLyric"><UiIcon name="copy" /></button>
            <button ref="offsetTrigger" type="button" aria-label="调整歌词延迟" title="歌词延迟" aria-haspopup="dialog" :aria-expanded="offsetOpen" @click="offsetOpen = !offsetOpen"><UiIcon name="clock" /></button>
            <button v-if="hasExtended" type="button" class="ui-detail-translation" :class="{ active: showExtended }" :aria-pressed="showExtended" :aria-label="showExtended ? '隐藏翻译与音译' : '显示翻译与音译'" title="翻译与音译" @click="showExtended = !showExtended">译</button>
          </div>
        </div>
      </div>
      <PlayerBar />
      <PlayerPopover :show="offsetOpen" title="歌词延迟" :width="230" :trigger="offsetTrigger" anchor="trigger" @close="offsetOpen = false"><div class="ui-detail-offset" aria-label="调整歌词延迟"><button type="button" aria-label="歌词提前半秒" @click="setLyricOffset(lyric.offset + lyric.tempOffset - 500)"><UiIcon name="minimize" /></button><small>{{ ((lyric.offset + lyric.tempOffset) / 1000).toFixed(1) }}s</small><button type="button" aria-label="歌词延后半秒" @click="setLyricOffset(lyric.offset + lyric.tempOffset + 500)"><UiIcon name="plus" /></button></div></PlayerPopover>
    </section>
  </Transition>
</template>
<script setup>
import RecordPlayer from './components/RecordPlayer.vue'
import { ref, watch, nextTick, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { getCatalogSources } from './services/catalogSearch'
import { musicInfo, playMusicInfo, isShowPlayerDetail, isPlay } from '@renderer/store/player/state'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import { lyric } from '@renderer/store/player/lyric'
import { setLyricOffset } from '@renderer/core/lyric'
import { appSetting } from '@renderer/store/setting'
import { clipboardWriteText } from '@common/utils/electron'
import { extractWallpaperPalette, wallpaperColors, rgb, hex, tone, contrast } from './wallpaperPalette'
import UiIcon from './components/UiIcon.vue'
import PlayerBar from './PlayerBar.vue'
import WindowControls from './components/WindowControls.vue'
import PlayerPopover from './components/PlayerPopover.vue'
import useToggleDesktopLyric from '@renderer/utils/compositions/useToggleDesktopLyric'
import { appearance } from '@renderer/composables/useAppearance'

const seekLine = line => { window.app_event.setProgress(line.time / 1000) }
const currentTrack = computed(() => { const item = playMusicInfo.musicInfo; return item && 'metadata' in item ? item.metadata.musicInfo : item })
const router = useRouter()
const artistNames = computed(() => String(musicInfo.singer || '').split(/\s*、\s*|\s+\/\s+/).map(name => name.trim()).filter(Boolean))
const searchMetadata = (type, text) => {
  text = String(text || '').trim()
  if (!text) return
  const preferredSource = currentTrack.value?.source
  const source = getCatalogSources(type).includes(preferredSource) ? preferredSource : 'all'
  setShowPlayerDetail(false)
  void router.push({ path: '/search', query: { text, type, source, page: '1' } })
}
const lyricPanel = ref(null)
const offsetTrigger = ref(null)
const offsetOpen = ref(false)
const showExtended = ref(true)
const hasExtended = computed(() => lyric.lines.some(line => line.extendedLyrics?.length))
const { toggleDesktopLyric } = useToggleDesktopLyric()
const copyLyric = () => { clipboardWriteText(lyric.lines.map(line => line.text).join('\n')) }

// Read only the displayed cover. No extra request or change to saved wallpaper.
const fallbackPalette = { seed: '#637989', average: '#475764', dark: true }
const palette = ref(fallbackPalette)
const paletteCache = new Map()
function readCover(image) {
  if (!image.naturalWidth || !image.naturalHeight || !isShowPlayerDetail.value) return
  const key = image.currentSrc || image.src
  const cached = paletteCache.get(key)
  if (cached) { palette.value = cached; return }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(image, 0, 0, 64, 64)
    const result = extractWallpaperPalette(context.getImageData(0, 0, 64, 64).data)
    paletteCache.set(key, result)
    if (paletteCache.size > 24) paletteCache.delete(paletteCache.keys().next().value)
    palette.value = result
  } catch { palette.value = fallbackPalette }
}
const coverColors = computed(() => {
  const colors = wallpaperColors(palette.value, true)
  const seed = rgb(palette.value.seed)
  const average = rgb(palette.value.average)
  const chosenAccent = rgb(appearance.accent)
  const accent = contrast(chosenAccent, tone(average, 0.32, 0.045)) >= 4.5 ? chosenAccent : tone(chosenAccent, 0.8, 0.14)
  return {
    '--detail-bg': hex(tone(average, 0.24, 0.035)),
    '--detail-glow': hex(tone(seed, 0.4, 0.065)),
    '--detail-glow-secondary': hex(tone(average, 0.32, 0.045)),
    '--record-tint': hex(tone(seed, 0.57, 0.065)),
    '--record-highlight': hex(tone(seed, 0.76, 0.04)),
    '--record-shade': hex(tone(seed, 0.37, 0.04)),
    '--modern-bg': hex(colors.bg),
    '--modern-panel': hex(colors.panel),
    '--modern-text': hex(colors.text),
    '--modern-muted': hex(colors.muted),
    '--modern-accent': hex(accent),
    '--modern-accent-ink': hex(accent),
    '--modern-accent-contrast': hex(colors.bg),
    '--modern-accent-soft': `rgba(${accent.join(',')}, .14)`,
    '--modern-border': `rgba(${colors.text.join(',')}, .12)`,
    '--modern-hover': `rgba(${colors.text.join(',')}, .07)`,
  }
})
watch(() => musicInfo.id, () => { palette.value = fallbackPalette })
async function centerLyric(smooth = false) {
  await nextTick()
  const panel = lyricPanel.value
  const line = panel?.querySelector(`[data-line="${lyric.line}"]`)
  if (!panel || !line) return
  const top = panel.scrollTop + line.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.clientHeight / 2 + line.clientHeight / 2
  panel.scrollTo({ top, behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' })
}
watch(() => lyric.line, () => { if (isShowPlayerDetail.value) void centerLyric(true) })
watch(() => lyric.lines, () => { if (isShowPlayerDetail.value) void centerLyric() })
watch(isShowPlayerDetail, show => { if (show) void centerLyric(); else offsetOpen.value = false })
watch(showExtended, () => { if (isShowPlayerDetail.value) void centerLyric() })
function onKey(event) {
  if (event.key === 'Escape' && isShowPlayerDetail.value && !event.defaultPrevented && !document.querySelector('.ui-player-popover, .ui-dialog-backdrop, .ui-volume-panel')) setShowPlayerDetail(false)
}
function resizeLyrics() { if (isShowPlayerDetail.value) void centerLyric() }
onMounted(() => { window.addEventListener('keydown', onKey); window.addEventListener('resize', resizeLyrics) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', resizeLyrics) })
</script>
