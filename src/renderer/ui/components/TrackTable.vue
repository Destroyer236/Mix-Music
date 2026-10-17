<template>
  <div class="track-table" :class="{ 'track-table--loading': loading, 'track-table--removable': removable, 'track-table--selectable': Boolean($slots.selection) }" @keyup.space.stop>
    <div v-if="loading" class="track-table__loading" role="status"><span /><span /><span />正在加载歌曲…</div>
    <UiEmpty v-else-if="error || !list.length" :title="error ? '加载失败' : emptyTitle" :description="error || '换个筛选条件，或稍后再来看看。'" :retry="Boolean(error)" @retry="$emit('retry')" />
    <template v-else>
      <div class="track-table__head" role="row">
        <span class="track-table__index">#</span><span>歌曲</span><span class="track-table__singer">歌手</span><span class="track-table__duration">时长</span><span v-if="$slots.selection" aria-hidden="true" />
      </div>
      <div ref="scrollContainer" class="track-table__rows" :style="virtualized ? { overflowAnchor: 'none' } : undefined">
        <div v-if="topPadding" class="track-table__spacer" :style="{ height: topPadding + 'px' }" aria-hidden="true" />
        <div v-for="row in rows" :key="row.key" class="track-table__row" :class="{ 'track-table__row--playing': currentTrack?.id === row.track.id && currentTrack?.source === row.track.source, 'track-table__row--selected': selectedIds?.has(row.track.id), 'track-table__row--even': row.index % 2 === 1, 'track-table__row--top-three': row.index < 3 }" :data-track-key="`${row.track.source}:${row.track.id}`" :data-track-index="row.index" role="row">
          <span class="track-table__index">{{ row.number }}</span>
          <div class="track-table__song">
            <div class="track-table__name">
              <button type="button" class="track-table__cover" tabindex="-1" :aria-label="`播放 ${row.track.name || '未命名歌曲'}`" @click="$emit('play', row.track, row.index)"><TrackArtwork :track="row.track" :list-id="listId" /></button>
              <span class="track-table__title"><button type="button" class="track-table__play" :aria-label="`播放 ${row.track.name || '未命名歌曲'}`" @click="$emit('play', row.track, row.index)"><strong><TrackTitle :track="row.track" :text="row.track.name || '未命名歌曲'" /></strong></button><span v-if="showAlbum(row.track)" class="track-table__details"><button type="button" class="track-table__metadata-link track-table__album-link" :aria-label="`搜索专辑 ${albumName(row.track)}`" @click="searchMetadata('album', albumName(row.track), row.track)">{{ albumName(row.track) }}</button></span></span>
            </div>
            <div class="track-table__actions">
              <button type="button" title="播放" aria-label="播放" @click="$emit('play', row.track, row.index)"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m9 6 10 6-10 6z" /></svg></button>
              <button type="button" title="添加到歌单" aria-label="添加到歌单" @click="$emit('add', row.track, row.index)"><svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg></button>
              <button type="button" title="下载" aria-label="下载" @click="$emit('download', row.track, row.index)"><svg viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
              <button v-if="removable" type="button" title="从歌单移除" aria-label="从歌单移除" @click="$emit('remove', row.track, row.index)"><svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12M10 4h4M8 7l1 13h6l1-13M11 10v7m2-7v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg></button>
              <slot name="actions" :track="row.track" :index="row.index" />
            </div>
          </div>
          <span class="track-table__singer" :title="row.track.singer"><template v-if="artistNames(row.track).length"><template v-for="(artist, artistIndex) in artistNames(row.track)" :key="`${row.track.id}-${artist}`"><span v-if="artistIndex" aria-hidden="true">、</span><button type="button" class="track-table__metadata-link track-table__artist-link" :aria-label="`搜索歌手 ${artist}`" @click="searchMetadata('artist', artist, row.track)">{{ artist }}</button></template></template><span v-else>未知歌手</span></span>
          <span class="track-table__duration">{{ row.track.interval || '--:--' }}</span>
          <span v-if="$slots.selection" class="track-table__selection"><slot name="selection" :track="row.track" :index="row.index" /></span>
        </div>
        <div v-if="bottomPadding" class="track-table__spacer" :style="{ height: bottomPadding + 'px' }" aria-hidden="true" />
        <template v-if="!virtualized"><LazyListEnd v-if="progressiveList.hasMore.value" @more="progressiveList.loadMore" /><div v-if="progressiveList.hasMore.value" class="ui-lazy-list-reserve" :style="{ height: progressiveList.reservedHeight.value + 'px' }" aria-hidden="true" /></template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { playMusicInfo } from '@renderer/store/player/state'
import LazyListEnd from './LazyListEnd.vue'
import { useProgressiveList } from '../useProgressiveList'
import { useVirtualTrackList } from '../useVirtualTrackList'
import { useRoute, useRouter } from 'vue-router'
import UiEmpty from './UiEmpty.vue'
import TrackArtwork from './TrackArtwork.vue'
import TrackTitle from './TrackTitle.vue'
import { getCatalogSources } from '../services/catalogSearch'

const props = withDefaults(defineProps<{ list: LX.Music.MusicInfo[], listId?: string | null, loading?: boolean, error?: string, emptyTitle?: string, offset?: number, removable?: boolean, selectedIds?: ReadonlySet<string>, virtualized?: boolean }>(), {
  listId: null,
  loading: false,
  error: '',
  emptyTitle: '没有找到歌曲',
  offset: 0,
  removable: false,
  virtualized: false,
  selectedIds: () => new Set<string>(),
})
const router = useRouter()
const route = useRoute()
const scrollContainer = ref<HTMLElement>()
const items = computed(() => props.list)
const progressiveList = useProgressiveList<LX.Music.MusicInfo>(items, 24, computed(() => props.virtualized ? undefined : scrollContainer.value), '.track-table__row')
const virtualList = useVirtualTrackList<LX.Music.MusicInfo>(items, computed(() => props.virtualized ? scrollContainer.value : undefined), '.track-table__row')
const visibleItems = computed(() => props.virtualized ? virtualList.visibleItems.value : progressiveList.visibleItems.value)
const startIndex = computed(() => props.virtualized ? virtualList.startIndex.value : 0)
const topPadding = computed(() => props.virtualized ? virtualList.topPadding.value : 0)
const bottomPadding = computed(() => props.virtualized ? virtualList.bottomPadding.value : 0)
const { scrollToIndex, scrollToTop } = virtualList
watch(() => [props.listId, route.fullPath, props.virtualized], () => { progressiveList.reset(); virtualList.reset() }, { flush: 'post' })
defineExpose({ scrollToIndex, scrollToTop })
const currentTrack = computed(() => { const track = playMusicInfo.musicInfo; return track && 'metadata' in track ? track.metadata.musicInfo : track })
interface TrackRow { track: LX.Music.MusicInfo, index: number, key: string, number: string }
const rows = computed<TrackRow[]>(() => visibleItems.value.map((track: LX.Music.MusicInfo, visibleIndex: number) => {
  const index = startIndex.value + visibleIndex
  return { track, index, key: `${track.source}-${track.id}-${index}`, number: String(index + 1 + props.offset).padStart(2, '0') }
}))
defineEmits<{
  play: [track: LX.Music.MusicInfo, index: number]
  add: [track: LX.Music.MusicInfo, index: number]
  download: [track: LX.Music.MusicInfo, index: number]
  remove: [track: LX.Music.MusicInfo, index: number]
  retry: []
}>()

const albumName = (track: LX.Music.MusicInfo) => String(track.meta?.albumName ?? '').trim()
const normalizeTitle = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, '')
const showAlbum = (track: LX.Music.MusicInfo) => albumName(track) && normalizeTitle(albumName(track)) !== normalizeTitle(track.name)
const artistNames = (track: LX.Music.MusicInfo) => String(track.singer ?? '').split(/\s*、\s*|\s+\/\s+/).map(name => name.trim()).filter(Boolean)
const searchMetadata = (type: 'album' | 'artist', text: string, track: LX.Music.MusicInfo) => {
  const source = getCatalogSources(type).includes(track.source as LX.OnlineSource) ? track.source : 'all'
  const query: Record<string, string> = { text, type, source, page: '1' }
  // Clicking the same metadata item from its own works page should return to
  // the search results. Vue Router ignores an identical navigation, so use a
  // transient refresh key that Search.vue intentionally ignores.
  if (route.path === '/search' && String(route.query.text ?? '') === text && String(route.query.type ?? '') === type && String(route.query.source ?? 'all') === source) query.refresh = String(Date.now())
  void router.push({ path: '/search', query })
}
</script>

<style lang="less">
.track-table { display: flex; flex-direction: column; min-width: 0; min-height: 0; color: var(--modern-text); container-type: inline-size; }
.track-table__head, .track-table__row { display: grid; grid-template-columns: 36px minmax(0, 1.7fr) minmax(80px, .65fr) 55px; align-items: center; column-gap: 12px; padding: 0 12px; border-block: 0; }
.track-table--selectable { .track-table__head, .track-table__row { grid-template-columns: 36px minmax(0, 1.7fr) minmax(80px, .65fr) 55px 24px; } }
.track-table__head { flex: none; }
.track-table__rows { flex: 1; min-height: 0; overflow: auto; }
.track-table__spacer { flex: none; pointer-events: none; overflow-anchor: none; }
.ui-library-results .track-table { height: 100%; }
.track-table__head { min-height: 38px; color: var(--modern-muted); font-size: 10px; letter-spacing: .3px; }
.track-table__row { min-height: calc(var(--modern-row-height) + 12px); font-size: 11px; transition: background .15s; &:hover { background: var(--modern-hover); } &:is(:hover, :focus-within), &--selected { .track-table__actions, .track-table__selection { opacity: 1; pointer-events: auto; } } }
.track-table__index { color: var(--modern-muted); font-size: 10px; font-variant-numeric: tabular-nums; text-align: center; }
.track-table__song { display: flex; align-items: center; gap: 10px; min-width: 0; }
.track-table__name { display: flex; flex: 1; align-items: center; min-width: 0; gap: 10px; color: inherit; }
.track-table__play { display: block; width: 100%; min-width: 0; padding: 0; border: 0; color: inherit; background: transparent; text-align: left; font: inherit; cursor: pointer; &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 3px; border-radius: 6px; } }
.track-table__cover { display: grid; place-items: center; width: 34px; height: 34px; flex: none; padding: 0; border: 0; overflow: hidden; border-radius: 9px; color: var(--modern-accent-ink); background: var(--modern-accent-soft); cursor: pointer; img { width: 100%; height: 100%; object-fit: cover; } svg { width: 19px; height: 19px; } }
.track-table__title { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 4px; strong, small, .track-table__metadata-link { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } strong { display: flex; min-width: 0; font-size: 11px; font-weight: 500; > .ui-track-title { flex: 1; } } small { color: var(--modern-muted); font-size: 9px; } }
.track-table__details { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 16px; }
.track-table__details > .track-table__album-link { min-width: 0; color: var(--modern-muted); font-size: 11px; }
.track-table__singer, .track-table__duration { min-width: 0; overflow: hidden; color: var(--modern-muted); white-space: nowrap; text-overflow: ellipsis; }
.track-table__metadata-link { display: inline-block; max-width: 100%; padding: 0; border: 0; color: inherit; background: transparent; font: inherit; text-align: left; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; cursor: pointer; &:hover { color: var(--modern-accent-ink); text-decoration-color: currentColor; } &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 2px; border-radius: 3px; } }
.track-table__artist-link { overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
.track-table__actions, .track-table__selection { opacity: 0; pointer-events: none; transition: opacity .15s; }
.track-table__actions { display: flex; flex: none; justify-content: flex-end; align-items: center; gap: 2px; button { display: grid; flex: none; place-items: center; width: 26px; height: 28px; padding: 0; border: 0; border-radius: 8px; color: var(--modern-muted); background: transparent; cursor: pointer; &:hover { color: var(--modern-accent-ink); background: var(--modern-accent-soft); } &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 2px; } svg { width: 15px; height: 15px; } } }
.track-table__selection { display: flex; align-items: center; justify-content: center; input { width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: var(--modern-accent); &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 3px; } } }
.track-table__loading { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 190px; color: var(--modern-muted); font-size: 11px; span { width: 5px; height: 5px; border-radius: 50%; background: var(--modern-accent); animation: track-table-pulse 1s infinite alternate; &:nth-child(2) { animation-delay: .15s; } &:nth-child(3) { animation-delay: .3s; } } }
@keyframes track-table-pulse { from { opacity: .25; transform: translateY(1px); } to { opacity: 1; transform: translateY(-1px); } }
@container (max-width: 700px) { .track-table__head, .track-table__row { grid-template-columns: 27px minmax(0, 1fr) 50px; padding: 0 10px; column-gap: 6px; } .track-table--selectable { .track-table__head, .track-table__row { grid-template-columns: 27px minmax(0, 1fr) 50px 24px; } } .track-table__singer { display: none; } .track-table__cover { width: 32px; height: 32px; } .track-table__actions { gap: 0; } .track-table__actions button { width: 24px; } }
@container (max-width: 470px) { .track-table__head, .track-table__row { grid-template-columns: 25px minmax(0, 1fr); } .track-table--selectable { .track-table__head, .track-table__row { grid-template-columns: 25px minmax(0, 1fr) 24px; } } .track-table__duration { display: none; } .track-table__song, .track-table__name { gap: 6px; } .track-table__actions button { width: 22px; } }
</style>

