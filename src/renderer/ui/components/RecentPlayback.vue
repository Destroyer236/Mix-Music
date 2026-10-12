<template>
  <section class="ui-page ui-recent-page" aria-label="最近播放">
    <header class="ui-recent-page-heading"><div><h1>最近播放<span>{{ tracks.length }} 首</span></h1><p>再听一次，刚刚喜欢的声音</p></div><label><UiIcon name="search" /><input v-model="query" type="search" placeholder="搜索播放记录" aria-label="搜索最近播放"></label></header>
    <p v-if="error || persistenceError" class="ui-dialog-error" role="alert">{{ error || persistenceError }}</p>
    <div v-if="!filteredTracks.length" class="ui-recent-empty"><span class="ui-listening-empty-glyph"><UiIcon name="clock" /></span><h3>{{ tracks.length ? '没有匹配的播放记录' : '从一首好音乐开始' }}</h3><p>{{ tracks.length ? '试试其他歌名或歌手。' : '听过的音乐会留在这里，随时回来继续听。' }}</p><router-link v-if="!tracks.length" to="/discover">发现好音乐<UiIcon name="chevronRight" /></router-link></div>
    <div v-else class="ui-recent-table">
      <TrackTable :list="displayTracks" empty-title="暂无播放记录" @play="playRow" @add="addRow" @download="downloadRow">
        <template #actions="{ track, index }: { track: LX.Music.MusicInfo, index: number }"><button type="button" class="ui-library-row-btn" :class="{ loved: isFavorite(track) }" :aria-pressed="isFavorite(track)" :disabled="!isAvailable(index) || favoritePending.has(track.id)" :aria-label="isFavorite(track) ? '取消收藏' : '收藏歌曲'" @click="toggleFavorite(track)"><UiIcon name="heart" :filled="isFavorite(track)" /></button></template>
      </TrackTable>
    </div>
    <TrackActionModal :show="actionOpen" :action="action" :tracks="actionTracks" @close="actionOpen = false" />
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { LIST_IDS } from '@common/constants'
import { getListMusics } from '@renderer/store/list/action'
import { getDownloadList } from '@renderer/store/download/action'
import { playList } from '@renderer/core/player'
import type { RecentTrack } from '../useRecentPlayback'
import UiIcon from './UiIcon.vue'
import TrackTable from './TrackTable.vue'
import TrackActionModal from './TrackActionModal.vue'
import { favoritePending, isFavorite, refreshFavorites, setFavorite } from '../services/platformAccounts'
const props: { tracks: RecentTrack[], persistenceError?: string } = defineProps<{ tracks: RecentTrack[], persistenceError?: string }>()
const query = ref('')
const filteredTracks = computed(() => { const text = query.value.trim().toLocaleLowerCase(); return text ? props.tracks.filter(track => `${track.name} ${track.singer}`.toLocaleLowerCase().includes(text)) : props.tracks })
const error = ref('')
const busy = ref(false)
const artworkTracks = shallowRef(new Map<string, LX.Music.MusicInfo>())
const trackKey = (track: RecentTrack) => `${track.listId}:${track.id}`
const actionOpen = ref(false)
const action = ref<'add' | 'download'>('add')
const actionTracks = shallowRef<LX.Music.MusicInfo[]>([])
const displayTracks = computed<LX.Music.MusicInfo[]>(() => filteredTracks.value.map(record => artworkTracks.value.get(trackKey(record)) ?? {
  id: record.id,
  name: record.name,
  singer: record.singer,
  interval: null,
  source: 'local',
  meta: { songId: record.id, albumName: '', filePath: '', ext: '' },
}))
const isAvailable = (index: number) => Boolean(artworkTracks.value.get(trackKey(filteredTracks.value[index])))
function openAction(next: 'add' | 'download', track: LX.Music.MusicInfo, index: number) {
  if (!isAvailable(index)) { error.value = '这首音乐已从原歌单中移除，请在音乐库中重新选择。'; return }
  action.value = next; actionTracks.value = [track]; actionOpen.value = true
}
function playRow(_: LX.Music.MusicInfo, index: number) { void play(filteredTracks.value[index]) }
function addRow(track: LX.Music.MusicInfo, index: number) { openAction('add', track, index) }
function downloadRow(track: LX.Music.MusicInfo, index: number) { openAction('download', track, index) }
async function toggleFavorite(track: LX.Music.MusicInfo) {
  try { await setFavorite(track, !isFavorite(track)); error.value = '' } catch (err) { error.value = err instanceof Error ? err.message : '收藏更新失败，请重试。' }
}
let artworkRequest = 0
let disposed = false
async function loadArtworkTracks() {
  const request = ++artworkRequest
  const records = props.tracks
  const groups = new Map<string, RecentTrack[]>()
  for (const record of records) {
    const group = groups.get(record.listId) ?? []
    group.push(record)
    groups.set(record.listId, group)
  }
  const entries = await Promise.all(Array.from(groups, async([listId, history]) => {
    try {
      const list = listId === LIST_IDS.DOWNLOAD ? await getDownloadList() : await getListMusics(listId)
      const originals = new Map(list.map(track => [track.id, 'metadata' in track ? track.metadata.musicInfo : track]))
      return history.flatMap(record => {
        const original = originals.get(record.id)
        return original ? [[trackKey(record), original] as const] : []
      })
    } catch {
      return history.flatMap(record => {
        const original = artworkTracks.value.get(trackKey(record))
        return original ? [[trackKey(record), original] as const] : []
      })
    }
  }))
  if (!disposed && request === artworkRequest) artworkTracks.value = new Map(entries.flat())
}
function onListUpdate(ids: string[]) { if (props.tracks.some(track => ids.includes(track.listId))) void loadArtworkTracks() }
function onDownloadUpdate() { if (props.tracks.some(track => track.listId === LIST_IDS.DOWNLOAD)) void loadArtworkTracks() }
watch(() => props.tracks, loadArtworkTracks, { immediate: true })
onMounted(() => { void refreshFavorites().catch(() => {}); window.app_event.on('myListUpdate', onListUpdate); window.app_event.on('downloadListUpdate', onDownloadUpdate) })
onBeforeUnmount(() => { disposed = true; artworkRequest++; window.app_event.off('myListUpdate', onListUpdate); window.app_event.off('downloadListUpdate', onDownloadUpdate) })
async function play(track: RecentTrack) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const list = track.listId === LIST_IDS.DOWNLOAD ? await getDownloadList() : await getListMusics(track.listId)
    const index = list.findIndex(item => item.id === track.id)
    if (index < 0) throw new Error('这首音乐已从原歌单中移除，请在音乐库中重新选择。')
    playList(track.listId, index)
  } catch (err) { error.value = err instanceof Error ? err.message : '暂时无法播放，请稍后重试。' } finally { busy.value = false }
}
</script>
