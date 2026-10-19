<template>
  <div ref="pageContainer" class="ui-song-detail ui-discovery-page" @keyup.space.stop>
    <button type="button" class="ui-song-detail__back" @click="router.push({ path: '/songList/list', query: { source } })"><UiIcon name="back" />精选歌单</button>
    <PlaylistHeader :title="name" :compact="headerCompact">
      <template #cover><TrackArtwork :src="cover" :alt="`${name} 封面`" /></template>
      <template #details><p>{{ detail?.info.author || '精选歌单' }}<span v-if="detail?.total"> · {{ detail.total.toLocaleString() }} 首歌曲</span><span v-if="detail?.info.play_count"> · {{ detail.info.play_count }} 次播放</span></p><p v-if="description" class="ui-song-detail__description">{{ description }}</p></template>
      <template #actions><button type="button" class="ui-playlist-header__primary" :disabled="loading || busy || !detail?.list.length" @click="playCollection()"><UiIcon name="play" filled />{{ busy === 'play' ? '正在准备…' : '播放歌单' }}</button><button type="button" :disabled="loading || busy || !detail?.list.length" @click="importCollection"><UiIcon name="plus" />{{ busy === 'import' ? '正在导入…' : '加入音乐库' }}</button></template>
    </PlaylistHeader>
    <div v-if="message" class="ui-inline-message" role="status"><span>{{ message }}</span><button type="button" aria-label="关闭提示" @click="message = ''"><UiIcon name="close" /></button></div>
    <div class="ui-section-heading"><h2>歌单里的声音</h2><button type="button" :disabled="loading" @click="load(true)"><UiIcon name="refresh" />刷新</button></div>
    <div class="ui-track-panel"><TrackTable ref="trackTable" virtualized :list="detail?.list || []" :loading="loading" :error="error" :offset="(page - 1) * (detail?.limit || 30)" empty-title="这份歌单暂时没有歌曲" @play="playCollection($event)" @add="openAction($event, 'add')" @download="openAction($event, 'download')" @retry="load(true)" /></div>
    <PlaylistFloatingButtons :tracks="detail?.list || []" @jump-current="trackTable?.scrollToIndex($event)" @scroll-to-top="trackTable?.scrollToTop()" />
    <UiPagination :page="page" :pages="pages" :loading="loading" @change="changePage" />
    <TrackActionModal :show="actionOpen" :tracks="actionTracks" :action="action" @close="actionOpen = false" @success="message = $event" />
  </div>
</template>

<script setup lang="ts">
import UiIcon from '@renderer/ui/components/UiIcon.vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getListDetail, getListDetailAll } from '@renderer/store/songList/action'
import { type ListDetailInfo } from '@renderer/store/songList/state'
import musicSdk from '@renderer/utils/musicSdk'
import { createUserList, getUserLists, setTempList } from '@renderer/store/list/action'
import { userLists } from '@renderer/store/list/state'
import { toMD5 } from '@renderer/utils'
import { LIST_IDS } from '@common/constants'
import { playTrack } from '../services/music'
import TrackTable from '../components/TrackTable.vue'
import TrackArtwork from '../components/TrackArtwork.vue'
import PlaylistHeader from '../components/PlaylistHeader.vue'
import PlaylistFloatingButtons from '../components/PlaylistFloatingButtons.vue'
import TrackActionModal from '../components/TrackActionModal.vue'
import UiPagination from '../components/UiPagination.vue'
import { usePaginationScroll } from '../usePaginationScroll'
import { useCollapsingPlaylistHeader } from '../useCollapsingPlaylistHeader'

const route = useRoute()
const router = useRouter()
const queryValue = (value: unknown) => typeof value === 'string' ? value : ''
const sources = musicSdk.sources.filter(item => musicSdk[item.id as LX.OnlineSource]?.songList?.getListDetail).map(item => item.id as LX.OnlineSource)
const source = computed(() => sources.includes(queryValue(route.query.source) as LX.OnlineSource) ? route.query.source as LX.OnlineSource : sources[0] || 'kw')
const playlistId = computed(() => queryValue(route.query.id))
const page = computed(() => Math.max(1, Number.parseInt(queryValue(route.query.page), 10) || 1))
const trackTable = ref<{ scrollToIndex: (index: number) => void, scrollToTop: () => void } | null>(null)
const pageContainer = usePaginationScroll([page, playlistId, source], '.track-table__rows')
const headerCompact = useCollapsingPlaylistHeader(pageContainer, [page, playlistId, source], '.track-table__rows')
const detail = ref<ListDetailInfo | null>(null)
const name = computed(() => detail.value?.info.name ?? (queryValue(route.query.name) || '歌单详情'))
const cover = computed(() => detail.value?.info.img ?? queryValue(route.query.picUrl))
const description = computed(() => detail.value?.info.desc ?? detail.value?.desc ?? '')
const pages = computed(() => Math.max(1, Math.ceil((detail.value?.total ?? 0) / (detail.value?.limit ?? 30))))
const loading = ref(false)
const busy = ref<'' | 'play' | 'import'>('')
const error = ref('')
const message = ref('')
const actionOpen = ref(false)
const action = ref<'add' | 'download'>('add')
const actionTracks = ref<LX.Music.MusicInfo[]>([])
let requestId = 0
let loadedKey = ''
let collectionRevision = 0
let active = true
let autoPlayedRoute = ''
const allTracks = ref<{ key: string, list: LX.Music.MusicInfoOnline[] } | null>(null)
watch(() => route.fullPath, () => {
  if (route.path !== '/songList/detail') return
  const key = `${source.value}__${playlistId.value}`
  if (key !== loadedKey) { detail.value = null; allTracks.value = null; message.value = ''; loadedKey = key; collectionRevision++ }
  void load(route.query.refresh === 'true')
}, { immediate: true })
onUnmounted(() => { requestId++; collectionRevision++; active = false })
async function load(refresh = false) {
  const id = ++requestId
  error.value = ''
  loading.value = true
  if (refresh) { allTracks.value = null; collectionRevision++ }
  try {
    if (!playlistId.value) throw new Error('缺少歌单链接或 ID，请返回精选歌单重新打开。')
    const result = await getListDetail(playlistId.value, source.value, page.value, refresh)
    if (id === requestId) {
      detail.value = result
      if (route.query.play === 'true' && result.list[0] && autoPlayedRoute !== route.fullPath) {
        autoPlayedRoute = route.fullPath
        void playCollection(result.list[0])
      }
    }
  } catch (err) { if (id === requestId) { detail.value = null; error.value = err instanceof Error ? err.message : '歌单读取失败，请重试。' } } finally { if (id === requestId) loading.value = false }
}
async function getCollection(sourceId: LX.OnlineSource, id: string) {
  const key = `${sourceId}__${id}`
  if (allTracks.value?.key === key) return allTracks.value.list
  const revision = collectionRevision
  const tracks = await getListDetailAll(id, sourceId)
  if (active && revision === collectionRevision && key === loadedKey) allTracks.value = { key, list: tracks }
  return tracks
}
async function playCollection(selected?: LX.Music.MusicInfo) {
  if (busy.value) return
  const sourceId = source.value
  const id = playlistId.value
  const key = `${sourceId}__${id}`
  busy.value = 'play'
  message.value = ''
  try {
    // A single track is already available on this page. Do not make its
    // playback wait for every remaining playlist page to finish downloading.
    let tracks: LX.Music.MusicInfoOnline[]
    if (selected) tracks = detail.value?.list ?? []
    else {
      try { tracks = await getCollection(sourceId, id) } catch (err) {
        if (!detail.value?.list.length) throw err
        tracks = detail.value.list
        message.value = '完整歌单暂时无法读取，已播放当前页的歌曲。'
      }
    }
    if (!active || key !== loadedKey) return
    const target = selected ? tracks.find(track => track.id === selected.id) : tracks[0]
    if (!target) throw new Error('歌单中没有可播放的歌曲。')
    await setTempList(`playlist__${key}`, tracks)
    await playTrack(target, LIST_IDS.TEMP)
  } catch (err) { message.value = err instanceof Error ? err.message : '无法播放这份歌单，请重试。' } finally { busy.value = '' }
}
async function importCollection() {
  if (busy.value) return
  const sourceId = source.value
  const id = playlistId.value
  const title = name.value
  busy.value = 'import'
  message.value = ''
  try {
    await getUserLists()
    if (userLists.some(item => item.source === sourceId && item.sourceListId === id)) { message.value = '这份歌单已经在你的音乐库里。'; return }
    const tracks = await getCollection(sourceId, id)
    if (!tracks.length) throw new Error('这份歌单暂无歌曲可导入。')
    await createUserList({ id: `${sourceId}_${toMD5(id)}`, name: title, list: tracks, source: sourceId, sourceListId: id })
    message.value = `已将「${title}」的 ${tracks.length} 首歌曲加入音乐库。`
  } catch (err) { message.value = err instanceof Error ? err.message : '导入失败，请重试。' } finally { busy.value = '' }
}
function changePage(value: number) { void router.push({ path: '/songList/detail', query: { ...route.query, page: String(value), refresh: undefined, play: undefined } }) }
function openAction(track: LX.Music.MusicInfo, value: 'add' | 'download') { actionTracks.value = [track]; action.value = value; actionOpen.value = true }
</script>

<style lang="less">
@import '../discovery.less';
.ui-shell .ui-song-detail { position: relative; display: flex; flex-direction: column; overflow: hidden; padding-bottom: 0; }
.ui-song-detail__back { flex: none; align-self: flex-start; margin: 0 0 18px; padding: 0; border: 0; color: var(--modern-muted); background: transparent; font: inherit; font-size: 10px; cursor: pointer; &:hover { color: var(--modern-accent-ink); } }
.ui-song-detail__back svg { width: 15px; height: 15px; }
.ui-song-detail__description { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-shell .ui-song-detail > .ui-track-panel { flex: 1; min-height: 0; }
.ui-song-detail > .ui-track-panel > .track-table { height: 100%; }
.ui-song-detail > :is(.ui-inline-message, .ui-section-heading, .ui-pagination) { flex: none; }
.ui-song-detail > .ui-pagination { margin-top: 0; }
</style>
