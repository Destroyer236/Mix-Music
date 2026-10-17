<template>
  <section class="ui-full-queue" aria-label="播放队列">
    <header class="ui-full-queue-heading">
      <div><h2>播放队列</h2><p>{{ queue.length }} 首歌曲<template v-if="tempPlayList.length"> · 稍后播放 {{ tempPlayList.length }} 首</template></p></div>
      <div class="ui-full-queue-actions">
        <button type="button" class="ui-full-queue-icon" title="定位当前歌曲" aria-label="定位当前歌曲" :disabled="!playMusicInfo.musicInfo" @click="locateCurrent"><UiIcon name="focus" /></button>
        <button type="button" class="ui-full-queue-icon" title="清空播放队列" aria-label="清空播放队列" :disabled="!queue.length && !tempPlayList.length" @click="confirmClear"><UiIcon name="trash" /></button>
        <button type="button" class="ui-full-queue-icon" title="关闭播放队列" aria-label="关闭播放队列" @click="emit('close')"><UiIcon name="close" /></button>
      </div>
    </header>
    <label class="ui-full-queue-search"><UiIcon name="search" /><input v-model="search" type="search" aria-label="搜索队列" placeholder="搜索歌名、歌手"><button v-if="search" type="button" class="ui-full-queue-icon" aria-label="清除队列搜索" @click="search = ''"><UiIcon name="close" /></button></label>
    <div v-if="loading && !queue.length" class="ui-full-queue-empty" role="status"><UiIcon name="queue" /><p>正在读取播放队列…</p></div>
    <div v-else-if="!rows.length" class="ui-full-queue-empty"><UiIcon :name="search ? 'search' : 'queue'" /><p>{{ search ? '没有找到匹配的歌曲' : '播放队列为空' }}</p><small v-if="!search">选择一首歌曲，继续聆听</small></div>
    <div v-else ref="list" class="ui-full-queue-list scroll" @scroll="onScroll">
      <div :style="{ paddingTop: `${start * ROW_HEIGHT}px`, paddingBottom: `${Math.max(0, rows.length - end) * ROW_HEIGHT}px` }">
        <template v-for="row in visibleRows" :key="row.key">
          <h3 v-if="row.kind === 'heading'" class="ui-full-queue-section">稍后播放</h3>
          <div v-else class="ui-full-queue-row" :class="{ 'is-current': isCurrent(row.track) }">
            <button type="button" class="ui-full-queue-song" :aria-label="`播放 ${queueTrackInfo(row.track).name}，${queueTrackInfo(row.track).singer}`" :aria-current="isCurrent(row.track) ? 'true' : undefined" @click="playRow(row)">
              <span class="ui-full-queue-cover"><TrackArtwork :track="queueTrackInfo(row.track)" :list-id="row.later ? null : listId" /></span>
              <span class="ui-full-queue-info"><strong><TrackTitle :track="queueTrackInfo(row.track)" :show-badges="false" /></strong><small>{{ queueTrackInfo(row.track).singer || '未知歌手' }}</small></span>
              <span v-if="isCurrent(row.track)" class="ui-full-queue-playing" aria-label="当前播放"><i /><i /><i /></span>
            </button>
            <button type="button" class="ui-full-queue-remove ui-full-queue-icon" :aria-label="`从${row.later ? '稍后播放' : '队列'}移除 ${queueTrackInfo(row.track).name}`" title="从队列移除" @click="removeRow(row)"><UiIcon name="close" /></button>
          </div>
        </template>
      </div>
    </div>
    <UiModal :show="clearOpen" title="清空播放队列" subtitle="仅清空本次播放队列，歌单和本地文件会保留。" width="390px" @close="clearOpen = false">
      <p class="ui-dialog-note">正在播放的歌曲将继续播放，确认清空队列和稍后播放？</p>
      <template #footer><button type="button" class="ui-dialog-button" @click="clearOpen = false">取消</button><button type="button" class="ui-dialog-button ui-dialog-button-danger" @click="clearAll">清空队列</button></template>
    </UiModal>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { samePlayTrack } from '@common/platformMatching'
import { isPlay, playInfo, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { removeTempPlayList } from '@renderer/store/player/action'
import {
  clearPlaybackQueue,
  playbackQueueRevision,
  playLaterQueueTrack,
  playPlaybackQueueTrack,
  queueTrackInfo,
  readPlaybackQueue,
  removePlaybackQueueTrack,
  type PlaybackQueueTrack,
} from '../services/playbackQueue'
import TrackArtwork from './TrackArtwork.vue'
import TrackTitle from './TrackTitle.vue'
import UiIcon from './UiIcon.vue'
import UiModal from './UiModal.vue'

const emit = defineEmits<{ close: [], notice: [message: string] }>()
interface TrackRow { kind: 'track', key: string, track: PlaybackQueueTrack, index: number, later: boolean }
interface HeadingRow { kind: 'heading', key: string }
const ROW_HEIGHT = 72
const queue = shallowRef<PlaybackQueueTrack[]>([])
const listId = ref<string | null>(null)
const loading = ref(false)
const search = ref('')
const list = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(600)
const clearOpen = ref(false)
let clearListId: string | null = null
let request = 0
let locateOnLoad = true
let resizeObserver: ResizeObserver | null = null

const rows = computed<Array<TrackRow | HeadingRow>>(() => {
  const query = search.value.trim().toLocaleLowerCase()
  const matching = (track: PlaybackQueueTrack) => { const info = queueTrackInfo(track); return !query || `${info.name} ${info.singer}`.toLocaleLowerCase().includes(query) }
  const result: Array<TrackRow | HeadingRow> = queue.value.flatMap((track, index) => matching(track) ? [{ kind: 'track' as const, key: `queue:${index}:${track.id}`, track, index, later: false }] : [])
  const later = tempPlayList.flatMap((entry, index) => matching(entry.musicInfo) ? [{ kind: 'track' as const, key: `later:${index}:${entry.musicInfo.id}`, track: entry.musicInfo, index, later: true }] : [])
  if (later.length) result.push({ kind: 'heading', key: 'later-heading' }, ...later)
  return result
})
const start = computed(() => Math.max(0, Math.min(rows.value.length - 1, Math.floor(scrollTop.value / ROW_HEIGHT) - 4)))
const end = computed(() => Math.min(rows.value.length, start.value + Math.ceil(viewportHeight.value / ROW_HEIGHT) + 9))
const visibleRows = computed(() => rows.value.slice(start.value, end.value))

function isCurrent(track: PlaybackQueueTrack): boolean { return Boolean(playMusicInfo.musicInfo && samePlayTrack(track, playMusicInfo.musicInfo)) }
function onScroll() { scrollTop.value = list.value?.scrollTop ?? 0 }
async function refresh() {
  const generation = ++request
  loading.value = true
  try {
    const snapshot = await readPlaybackQueue()
    if (generation !== request || snapshot.listId !== playInfo.playerListId) return
    listId.value = snapshot.listId
    queue.value = snapshot.tracks
    if (locateOnLoad) { locateOnLoad = false; await locateCurrent(false) }
  } catch (error) {
    if (generation === request) emit('notice', error instanceof Error ? error.message : '读取播放队列失败，请重试')
  } finally { if (generation === request) loading.value = false }
}
async function locateCurrent(notify = true) {
  search.value = ''
  await nextTick()
  const index = rows.value.findIndex(row => row.kind === 'track' && isCurrent(row.track))
  if (index < 0) { if (notify) emit('notice', '当前歌曲不在播放队列中'); return }
  const element = list.value
  if (!element) return
  const top = Math.max(0, index * ROW_HEIGHT - element.clientHeight / 2 + ROW_HEIGHT / 2)
  scrollTop.value = top
  element.scrollTo({ top, behavior: 'auto' })
}
function playRow(row: TrackRow) {
  const played = row.later ? playLaterQueueTrack(row.index) : playPlaybackQueueTrack(listId.value, row.track)
  if (!played) { emit('notice', '播放队列已变化，请重新选择'); void refresh() }
}
function removeRow(row: TrackRow) {
  if (row.later) {
    const entry = tempPlayList[row.index]
    if (!entry || !samePlayTrack(entry.musicInfo, row.track)) return
    removeTempPlayList(row.index)
  } else if (!removePlaybackQueueTrack(listId.value, row.track)) { emit('notice', '播放队列已变化，请重试'); void refresh() }
}
function confirmClear() { clearListId = listId.value; clearOpen.value = true }
function clearAll() {
  const cleared = clearPlaybackQueue(clearListId)
  clearOpen.value = false
  emit('notice', cleared ? '播放队列已清空' : '播放队列已变化，请重新确认')
}
function onListUpdate(ids: string[]) { if (playInfo.playerListId && ids.includes(playInfo.playerListId)) void refresh() }
function onDownloadUpdate() { if (playInfo.playerListId === 'download') void refresh() }
watch(() => [playInfo.playerListId, playbackQueueRevision.value], () => { void refresh() }, { immediate: true })
watch(search, () => { scrollTop.value = 0; if (list.value) list.value.scrollTop = 0 })
watch(list, element => {
  resizeObserver?.disconnect()
  if (!element) return
  viewportHeight.value = element.clientHeight
  resizeObserver = new ResizeObserver(() => { viewportHeight.value = element.clientHeight })
  resizeObserver.observe(element)
})
onMounted(() => { window.app_event.on('myListUpdate', onListUpdate); window.app_event.on('downloadListUpdate', onDownloadUpdate) })
onBeforeUnmount(() => { request++; resizeObserver?.disconnect(); window.app_event.off('myListUpdate', onListUpdate); window.app_event.off('downloadListUpdate', onDownloadUpdate) })
</script>

<style lang="less">
.ui-full-queue { height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; color: var(--modern-text); -webkit-app-region: no-drag; }
.ui-full-queue-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 4px 6px 20px; flex: none; h2 { margin: 0; font-size: 23px; font-weight: 600; line-height: 1.3; } p { margin: 7px 0 0; color: var(--modern-muted); font-size: 12px; } }
.ui-full-queue-actions { display: flex; align-items: center; gap: 7px; }
.ui-full-queue-icon { display: grid; place-items: center; flex: none; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%; color: var(--modern-muted); background: var(--modern-hover); cursor: pointer; transition: color .15s, background .15s; svg { width: 17px; height: 17px; } &:hover { color: var(--modern-text); background: var(--modern-accent-soft); } &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 2px; } &:disabled { opacity: .35; cursor: default; } }
.ui-full-queue-search { display: flex; align-items: center; gap: 10px; min-height: 38px; margin: 0 6px 12px; padding: 0 12px; border: 1px solid var(--modern-border); border-radius: 10px; background: var(--modern-hover); color: var(--modern-muted); flex: none; > svg { width: 16px; height: 16px; } input { flex: 1; width: 0; padding: 9px 0; border: 0; background: transparent; color: var(--modern-text); font: inherit; font-size: 12px; outline: none; &::placeholder { color: var(--modern-muted); } &::-webkit-search-cancel-button { display: none; } } &:focus-within { border-color: var(--modern-accent); } button { width: 24px; height: 24px; background: transparent; } }
.ui-full-queue-list { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 6px; scrollbar-gutter: stable; }
.ui-full-queue-row { position: relative; display: flex; align-items: center; height: 72px; padding: 4px 0; box-sizing: border-box; border-radius: 12px; &::before { content: ''; position: absolute; inset: 4px 0; border-radius: 12px; pointer-events: none; transition: background .15s; } &:hover::before, &:focus-within::before { background: var(--modern-hover); } &.is-current::before { background: var(--modern-accent-soft); } &.is-current::after { content: ''; position: absolute; left: 0; top: 23px; bottom: 23px; width: 3px; border-radius: 3px; background: var(--modern-accent-ink); } }
.ui-full-queue-song { position: relative; display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; height: 100%; padding: 8px 6px 8px 12px; border: 0; border-radius: 12px; color: inherit; background: transparent; text-align: left; cursor: pointer; font: inherit; &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: -2px; } }
.ui-full-queue-cover { display: block; flex: none; width: 46px; height: 46px; border-radius: 9px; overflow: hidden; }
.ui-full-queue-info { min-width: 0; flex: 1; strong { display: block; overflow: hidden; font-size: 14px; font-weight: 550; line-height: 1.4; } small { display: block; margin-top: 5px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--modern-muted); font-size: 12px; } }
.ui-full-queue-remove { position: relative; width: 28px; height: 28px; margin-right: 8px; background: transparent; opacity: 0; .ui-full-queue-row:hover &, &:focus-visible { opacity: 1; } }
.ui-full-queue-playing { display: flex; align-items: center; justify-content: center; gap: 2px; width: 18px; height: 20px; color: var(--modern-accent-ink); i { width: 2px; height: 9px; background: currentColor; border-radius: 2px; animation: ui-full-queue-level .85s ease-in-out infinite alternate; animation-play-state: v-bind("isPlay ? 'running' : 'paused'"); } i:nth-child(2) { height: 15px; animation-delay: -.25s; } i:nth-child(3) { height: 6px; animation-delay: -.5s; } }
.ui-full-queue-section { display: flex; align-items: center; box-sizing: border-box; height: 72px; margin: 0; padding: 20px 12px 10px; font-size: 13px; font-weight: 500; color: var(--modern-muted); }
.ui-full-queue-empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--modern-muted); > svg { width: 36px; height: 36px; opacity: .55; } p { font-size: 14px; } small { font-size: 12px; opacity: .7; } }
@keyframes ui-full-queue-level { from { transform: scaleY(.5); } to { transform: scaleY(1); } }
@media (max-width: 800px) { .ui-full-queue-heading { gap: 10px; h2 { font-size: 20px; } } .ui-full-queue-actions { gap: 4px; } .ui-full-queue-icon { width: 30px; height: 30px; } .ui-full-queue-remove { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ui-full-queue-playing i { animation: none; } .ui-full-queue-row::before, .ui-full-queue-icon { transition: none; } }
</style>
