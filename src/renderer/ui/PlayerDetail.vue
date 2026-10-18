<template>
  <Transition name="ll-player-reveal" @after-enter="contentReady = true" @before-leave="contentReady = false">
    <section v-if="isShowPlayerDetail" ref="player" class="ui-player-detail ll-full-player" :class="[{ 'is-idle': idle, 'is-centered': coverCentered, 'is-playing': isPlay }, `ll-cover-${playerPresentation.coverLayout}`, `ll-background-${playerPresentation.background}`]" :style="auraStyle" aria-label="播放详情" @pointermove="wake" @pointerdown="wake" @focusin="wake">
      <div class="ll-full-background" aria-hidden="true"><Transition name="ll-background-fade"><div v-if="backgroundUrl && playerPresentation.background !== 'theme'" :key="backgroundUrl" class="ll-full-background-image" :style="{ backgroundImage: `url(${JSON.stringify(backgroundUrl)})` }" /></Transition><div class="ll-full-background-glow" /><div class="ll-full-background-veil" /></div>
      <FullPlayerSpectrum v-if="contentReady && playerPresentation.spectrum" @notice="notify" />
      <header class="ll-full-header" @pointerenter="toolbarHover = true" @pointerleave="toolbarHover = false; wake()">
        <button type="button" class="ui-icon-button" aria-label="收起播放详情" title="收起 · Esc" @click="setShowPlayerDetail(false)"><UiIcon name="chevronDown" /></button>
        <div class="ll-full-window-tools"><button type="button" class="ui-icon-button" :aria-label="isFullscreen ? '退出全屏' : '进入全屏'" :title="isFullscreen ? '退出全屏' : '进入全屏'" @click="toggleFullscreen"><UiIcon :name="isFullscreen ? 'restore' : 'expand'" /></button><WindowControls /></div>
      </header>
      <div class="ll-full-stage">
        <div class="ll-full-song">
          <Transition name="ll-song-change" mode="out-in">
            <div :key="musicInfo.id || 'empty'" class="ll-full-album">
              <div class="ll-full-artwork" :class="{ 'is-paused': !isPlay }"><div class="ll-full-artwork-spin"><TrackArtwork :track="currentTrack" :src="musicInfo.pic" :alt="musicInfo.name || '专辑封面'" @loaded="readCover" /></div></div>
              <div class="ll-full-metadata">
                <h1 ref="songHeading" :class="{ 'll-title-marquee': titleOverflow }" :style="titleStyle" :title="musicInfo.name"><TrackTitle :track="currentTrack" :text="musicInfo.name || '静候一首好歌'" :show-badges="false" focusable /><small v-if="playbackRate !== 1">{{ playbackRate }}×</small></h1>
                <div class="ll-full-badges" aria-label="歌曲与音源信息">
                  <span v-if="currentTrack" class="ll-full-source" :title="sourceTitle"><UiIcon name="headphones" />{{ sourceLabel }}</span>
                  <span v-if="currentTrack" class="ll-full-quality" :title="`播放音质 · ${qualityLabel}`">{{ qualityLabel }}</span>
                  <span v-if="currentStream?.isTrial" class="ll-full-trial">试听</span>
                </div>
                <p class="ll-full-artists"><UiIcon name="micVocal" /><span v-if="artistNames.length"><template v-for="(artist, index) in artistNames" :key="artist"><span v-if="index" class="ll-metadata-divider"> / </span><button type="button" :title="`查看歌手 ${artist}`" @click="searchMetadata('artist', artist)">{{ artist }}</button></template></span><span v-else>{{ currentTrack ? '未知歌手' : '从你的音乐库开始聆听' }}</span></p>
                <p class="ll-full-album-name"><UiIcon name="disc" /><button v-if="musicInfo.album" type="button" :title="`查看专辑 ${musicInfo.album}`" @click="searchMetadata('album', musicInfo.album)">{{ musicInfo.album }}</button><span v-else>{{ currentTrack ? '未知专辑' : 'LinkLine' }}</span></p>
              </div>
            </div>
          </Transition>
        </div>
        <div class="ll-full-right" :class="{ 'is-hidden': coverCentered }" :inert="coverCentered || undefined">
          <Transition name="ll-panel-switch" mode="out-in"><FullPlayerQueue v-if="queueOpen && contentReady" @close="queueOpen = false" @notice="notify" /><FullPlayerLyrics v-else-if="contentReady && showLyrics && !coverCentered" @notice="notify" /></Transition>
        </div>
      </div>
      <footer class="ll-full-toolbar" @pointerenter="toolbarHover = true" @pointerleave="toolbarHover = false; wake()">
        <div class="ll-full-actions">
          <button type="button" class="ui-icon-button" :class="{ 'ui-active': collected }" :aria-pressed="collected" :aria-label="collected ? '取消收藏当前歌曲' : '收藏当前歌曲'" :title="collected ? '取消喜欢' : '喜欢'" :disabled="!currentTrack || favoritePending.has(currentTrack.id)" @click="toggleCollect"><UiIcon name="heart" :filled="collected" /></button>
          <button type="button" class="ui-icon-button" aria-label="查看歌曲评论" title="评论" :disabled="!currentTrack" @click="openComments"><UiIcon name="comment" /></button>
          <FullPlayerMore :track="currentTrack" @notice="notify" />
        </div>
        <div class="ll-full-transport">
          <div class="ll-full-controls">
            <button type="button" class="ui-icon-button ll-full-play-mode" :class="{ 'ui-active': playMode !== 'list' }" :aria-label="playModeLabel" :title="playModeLabel" @click="cyclePlayMode"><UiIcon :name="playModeIcon" /></button>
            <button type="button" class="ui-icon-button ll-full-skip" aria-label="上一首" title="上一首" @click="playPrev()"><UiIcon name="prev" filled /></button>
            <button type="button" class="ll-full-play" :aria-label="isPlay ? '暂停' : '播放'" :title="isPlay ? '暂停' : '播放'" @click="togglePlay"><UiIcon :name="isPlay ? 'pause' : 'play'" filled /></button>
            <button type="button" class="ui-icon-button ll-full-skip" aria-label="下一首" title="下一首" @click="playNext()"><UiIcon name="next" filled /></button>
            <FullPlayerVolume />
          </div>
          <div class="ll-full-progress"><button type="button" aria-label="切换进度时间显示" :title="timeMode ? '显示已播放时间' : '显示剩余时间'" @click="timeMode = !timeMode">{{ timeMode ? '-' + formatTime(Math.max(0, playProgress.maxPlayTime - displayedTime)) : formatTime(displayedTime) }}</button><UiRange :model-value="displayedTime" :max="playProgress.maxPlayTime || 1" :step="0.1" aria-label="播放进度" :disabled="!playProgress.maxPlayTime" @input="seeking = $event" @change="seek" /><span>{{ playProgress.maxPlayTimeStr }}</span></div>
        </div>
        <div class="ll-full-tools"><QualityControl :track="currentTrack" :label="qualityLabel" :local-file="playingFile" :playback-id="playMusicInfo.musicInfo?.id" defer-load /><ExternalLyricsMenu /><button type="button" class="ui-icon-button" :class="{ 'ui-active': queueOpen }" aria-label="播放队列" title="播放队列" :aria-pressed="queueOpen" @click="queueOpen = !queueOpen"><UiIcon name="queue" /></button><button type="button" class="ui-icon-button" :class="{ 'ui-active': showLyrics }" :aria-label="showLyrics ? '隐藏歌词' : '显示歌词'" :title="showLyrics ? '隐藏歌词' : '显示歌词'" :aria-pressed="showLyrics" @click="toggleLyrics"><UiIcon name="lyric" /></button></div>
      </footer>
      <Transition name="ll-toast"><div v-if="notice" class="ll-full-notice" role="status" aria-live="polite">{{ notice }}</div></Transition>
    </section>
  </Transition>
</template>
<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { musicInfo, playMusicInfo, isShowPlayerDetail, isPlay } from '@renderer/store/player/state'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import { playProgress } from '@renderer/store/player/playProgress'
import { playbackRate } from '@renderer/store/player/playbackRate'
import { repeatMode } from '@renderer/store/player/repeatMode'
import { lyric } from '@renderer/store/player/lyric'
import { togglePlay, playPrev, playNext } from '@renderer/core/player'
import { appSetting, mergeSetting, setTogglePlayMode } from '@renderer/store/setting'
import { isFullscreen, sourceNames } from '@renderer/store'
import { setFullScreen } from '@renderer/utils/ipc'
import { qualityLabels } from '@common/platformPlayback'
import { favoritePending, isFavorite, requestFavorite } from './services/platformAccounts'
import { activePlaybackResource, activeStream, preferredQuality } from './services/platformPlayback'
import { heartbeatActive, toggleHeartbeat } from './services/heartbeat'
import { playerPresentation } from './services/playerPresentation'
import { getCatalogSources } from './services/catalogSearch'
import { extractWallpaperPalette } from './wallpaperPalette'
import UiIcon from './components/UiIcon.vue'
import UiRange from './components/UiRange.vue'
import TrackArtwork from './components/TrackArtwork.vue'
import TrackTitle from './components/TrackTitle.vue'
import WindowControls from './components/WindowControls.vue'
import QualityControl from './components/QualityControl.vue'
import ExternalLyricsMenu from './components/ExternalLyricsMenu.vue'
import FullPlayerLyrics from './components/FullPlayerLyrics.vue'
import FullPlayerQueue from './components/FullPlayerQueue.vue'
import FullPlayerMore from './components/FullPlayerMore.vue'
import FullPlayerSpectrum from './components/FullPlayerSpectrum.vue'
import FullPlayerVolume from './components/FullPlayerVolume.vue'
import './full-player.less'

const router = useRouter()
const player = ref(null)
const songHeading = ref(null)
const titleOverflow = ref(false)
const titleStyle = ref({})
let titleObserver
function measureTitle() {
  const title = songHeading.value?.querySelector('.ui-track-title')
  const text = title?.querySelector('.ui-track-title-text')
  const distance = text && title ? text.scrollWidth - title.clientWidth : 0
  titleOverflow.value = distance > 4
  titleStyle.value = { '--ll-title-distance': `${Math.max(0, distance)}px`, '--ll-title-duration': `${Math.max(10, distance / 20 + 5)}s` }
}
watch(songHeading, async heading => {
  titleObserver?.disconnect()
  if (!heading) return
  titleObserver = new ResizeObserver(measureTitle)
  titleObserver.observe(heading)
  const text = heading.querySelector('.ui-track-title-text')
  if (text) titleObserver.observe(text)
  await nextTick(); measureTitle()
})
const contentReady = ref(false)
const showLyrics = ref(true)
const queueOpen = ref(false)
const coverCentered = computed(() => !queueOpen.value && (!showLyrics.value || (playerPresentation.autoCenterCover && !lyric.lines.length)))
const currentTrack = computed(() => { const item = playMusicInfo.musicInfo; return item && 'metadata' in item ? item.metadata.musicInfo : item })
const playingFile = computed(() => activePlaybackResource.value && activePlaybackResource.value.trackId === playMusicInfo.musicInfo?.id ? activePlaybackResource.value.local : Boolean(playMusicInfo.musicInfo && 'metadata' in playMusicInfo.musicInfo) || currentTrack.value?.source === 'local')
const currentStream = computed(() => activeStream.value?.trackId === playMusicInfo.musicInfo?.id ? activeStream.value : null)
const platformNames = { netease: '网易云音乐', qq: 'QQ 音乐', kugou: '酷狗音乐', kuwo: '酷我音乐', migu: '咪咕音乐', bilibili: '哔哩哔哩', qishui: '汽水音乐', bodian: '波点音乐' }
const sourceLabel = computed(() => playingFile.value ? '本地音乐' : currentStream.value ? platformNames[currentStream.value.platform] ?? currentStream.value.platform : sourceNames.value[currentTrack.value?.source] ?? '等待音源')
const sourceTitle = computed(() => playingFile.value ? '实际播放音源 · 本地文件' : currentStream.value ? `实际播放音源 · ${sourceLabel.value}` : `歌曲平台 · ${sourceLabel.value}，播放后显示实际音源`)
const qualityLabel = computed(() => playingFile.value ? '本地' : currentStream.value?.qualityLabel ?? (currentStream.value ? qualityLabels[currentStream.value.quality ?? currentStream.value.type] : preferredQuality.value === 'auto' ? '自动' : qualityLabels[preferredQuality.value]))
const artistNames = computed(() => [...new Set(String(musicInfo.singer || '').split(/\s*、\s*|\s+\/\s+/).map(name => name.trim()).filter(Boolean))])
const searchMetadata = (type, text) => {
  if (!String(text).trim()) return
  const preferred = currentTrack.value?.source
  setShowPlayerDetail(false)
  void router.push({ path: '/search', query: { text, type, source: getCatalogSources(type).includes(preferred) ? preferred : 'all', page: '1' } })
}
const collected = computed(() => isFavorite(currentTrack.value))
const toggleCollect = () => { if (currentTrack.value && !favoritePending.value.has(currentTrack.value.id)) requestFavorite(currentTrack.value, !collected.value) }
function openComments() {
  if (!currentTrack.value) return
  setShowPlayerDetail(false)
  void router.push({ path: '/comment', query: { id: playMusicInfo.musicInfo.id, listId: playMusicInfo.listId ?? undefined } })
}
const seeking = ref(null)
const displayedTime = computed(() => seeking.value ?? playProgress.nowPlayTime)
const timeMode = ref(false)
const formatTime = value => { const seconds = Math.max(0, Math.floor(value || 0)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
function seek(value) { window.app_event.setProgress(value); seeking.value = null }
const playModes = ['listLoop', 'random', 'singleLoop', 'list']
const playMode = computed(() => appSetting['player.togglePlayMethod'])
const playModeNames = { listLoop: '列表循环', random: '随机播放', singleLoop: '单曲循环', list: '顺序播放' }
const playModeIcon = computed(() => ({ listLoop: 'repeat', random: 'shuffle', singleLoop: 'repeatOne', list: 'listPlay' }[playMode.value]))
const playModeLabel = computed(() => `播放模式：${heartbeatActive.value ? '心动模式 · ' : ''}${playModeNames[playMode.value]}，点击切换`)
async function cyclePlayMode() {
  if (heartbeatActive.value) { const result = await toggleHeartbeat(); if (result) notify(result.message) }
  const mode = playModes[(playModes.indexOf(playMode.value) + 1) % playModes.length]
  // Random uses a full shuffled cycle; it must not inherit an earlier repeat-one setting.
  if (mode === 'random') repeatMode.value = 'listLoop'
  mergeSetting({ 'player.togglePlayMethod': mode })
  setTogglePlayMode(mode)
}
function toggleLyrics() { queueOpen.value = false; showLyrics.value = !showLyrics.value; wake() }
async function toggleFullscreen() { try { isFullscreen.value = await setFullScreen(!isFullscreen.value) } catch { notify('暂时无法切换全屏，请重试') } }
const notice = ref('')
let noticeTimer
function notify(message) { clearTimeout(noticeTimer); notice.value = message; noticeTimer = setTimeout(() => { notice.value = '' }, 3200); wake() }
const backgroundUrl = ref('')
const aura = ref('')
const auraStyle = computed(() => aura.value ? { '--ll-player-aura': aura.value } : {})
function readCover(image) {
  if (!image.naturalWidth || !isShowPlayerDetail.value) return
  backgroundUrl.value = image.currentSrc || image.src
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return
    context.drawImage(image, 0, 0, 32, 32)
    aura.value = extractWallpaperPalette(context.getImageData(0, 0, 32, 32).data).seed
  } catch { aura.value = '' }
}
const idle = ref(false)
const toolbarHover = ref(false)
let idleTimer
function wake() {
  idle.value = false
  clearTimeout(idleTimer)
  if (!isShowPlayerDetail.value || !playerPresentation.immersive) return
  idleTimer = setTimeout(() => {
    if (toolbarHover.value || player.value?.querySelector('.ll-full-toolbar:focus-within, .ll-full-header:focus-within, .fpl-actions:focus-within, .fpl-actions:hover') || document.querySelector('.ui-player-popover, .ui-dialog-backdrop, .ui-volume-panel, .ui-quality-panel, .fpl-menu')) { wake(); return }
    idle.value = true
  }, 3000)
}
watch(() => playerPresentation.immersive, wake)
watch(() => musicInfo.id, () => { seeking.value = null; backgroundUrl.value = ''; wake() })
watch(isShowPlayerDetail, show => { if (show) wake(); else { contentReady.value = false; queueOpen.value = false; idle.value = false; clearTimeout(idleTimer) } })
function onKey(event) {
  if (event.key !== 'Escape' || !isShowPlayerDetail.value || event.defaultPrevented || document.querySelector('.ui-player-popover, .ui-dialog-backdrop, .ui-volume-panel, .ui-quality-panel, .fpl-menu')) return
  if (queueOpen.value) queueOpen.value = false
  else setShowPlayerDetail(false)
}
onMounted(() => { window.addEventListener('keydown', onKey); if (isShowPlayerDetail.value) { contentReady.value = true; wake() } })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); clearTimeout(idleTimer); clearTimeout(noticeTimer); titleObserver?.disconnect() })
</script>
