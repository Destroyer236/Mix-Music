<template>
  <div class="local-track-table" role="table" aria-label="本地音乐歌曲列表" :aria-busy="loading">
    <div v-if="loading" class="local-track-table__loading" role="status"><UiIcon name="refresh" />正在加载本地音乐…</div>
    <UiEmpty v-else-if="error || !list.length" :title="error ? '加载失败' : emptyTitle" :description="error || emptyDescription" :retry="Boolean(error)" @retry="$emit('retry')" />
    <div v-else ref="scrollContainer" class="local-track-table__scroll scroll">
      <div class="local-track-table__head" role="row">
        <span class="local-track-table__index" role="columnheader">#</span>
        <span role="columnheader">歌曲 / 歌手</span>
        <span class="local-track-table__album" role="columnheader">专辑</span>
        <span class="local-track-table__format" role="columnheader">格式</span>
        <span class="local-track-table__duration" role="columnheader">时长</span>
        <span class="local-track-table__actions" role="columnheader">操作</span>
      </div>
      <div role="rowgroup">
        <div v-for="(track, index) in visibleItems" :key="track.id" class="local-track-table__row" :class="{ 'local-track-table__row--active': currentTrack?.source === 'local' && currentTrack.id === track.id, 'local-track-table__row--selected': selectedIds?.has(track.id) }" role="row" :data-track-id="track.id" :aria-selected="Boolean(selectedIds?.has(track.id))" :title="track.meta.filePath">
          <span class="local-track-table__index" role="cell"><UiIcon v-if="currentTrack?.source === 'local' && currentTrack.id === track.id && isPlay" name="quality" /><template v-else>{{ String(Number(index) + 1 + offset).padStart(2, '0') }}</template></span>
          <div class="local-track-table__song" role="cell">
            <button type="button" class="local-track-table__cover" tabindex="-1" :aria-label="`播放 ${track.name || '未命名歌曲'}`" @click="$emit('play', track)"><TrackArtwork :track="track" :list-id="listId" /><span class="local-track-table__cover-play" aria-hidden="true"><UiIcon name="play" filled /></span></button>
            <div class="local-track-table__metadata">
              <button type="button" class="local-track-table__title" :aria-label="`播放 ${track.name || '未命名歌曲'}`" :title="track.name" @click="$emit('play', track)">{{ track.name || '未命名歌曲' }}</button>
              <span class="local-track-table__artists"><template v-if="artistNames(track).length"><template v-for="(artist, artistIndex) in artistNames(track)" :key="artist"><span v-if="artistIndex" aria-hidden="true">、</span><button type="button" class="local-track-table__link" :aria-label="`查看本地歌手 ${artist}`" @click="$emit('artist', artist, track)">{{ artist }}</button></template></template><span v-else>未知歌手</span></span>
            </div>
          </div>
          <span class="local-track-table__album" role="cell"><button v-if="albumName(track)" type="button" class="local-track-table__link" :title="albumName(track)" :aria-label="`查看本地专辑 ${albumName(track)}`" @click="$emit('album', albumName(track), track)">{{ albumName(track) }}</button><span v-else>未知专辑</span></span>
          <span class="local-track-table__format" role="cell"><span>{{ track.meta.ext.replace(/^\./, '').toUpperCase() || '—' }}</span></span>
          <span class="local-track-table__duration" role="cell">{{ track.interval || '--:--' }}</span>
          <div class="local-track-table__actions" role="cell">
            <button type="button" :title="`加入歌单 ${track.name}`" :aria-label="`加入歌单 ${track.name}`" @click="$emit('add', track)"><UiIcon name="plus" /></button>
            <button type="button" :title="`编辑 ${track.name}`" :aria-label="`编辑 ${track.name}`" @click="$emit('edit', track)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15z" /></svg></button>
            <button type="button" :title="`从本地音乐库移除 ${track.name}`" :aria-label="`移除 ${track.name}`" @click="$emit('remove', track)"><UiIcon name="trash" /></button>
            <input type="checkbox" :checked="Boolean(selectedIds?.has(track.id))" :aria-label="`选择 ${track.name}`" @change="$emit('select', track.id)">
          </div>
        </div>
      </div>
      <LazyListEnd v-if="hasMore" @more="loadMore" /><div v-if="hasMore" class="ui-lazy-list-reserve" :style="{ height: reservedHeight + 'px' }" aria-hidden="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import LazyListEnd from './LazyListEnd.vue'
import { useProgressiveList } from '../useProgressiveList'
import { isPlay, playMusicInfo } from '@renderer/store/player/state'
import TrackArtwork from './TrackArtwork.vue'
import UiEmpty from './UiEmpty.vue'
import UiIcon from './UiIcon.vue'

const props = withDefaults(defineProps<{
  list: LX.Music.MusicInfoLocal[]
  listId: string
  loading?: boolean
  error?: string
  emptyTitle?: string
  emptyDescription?: string
  offset?: number
  selectedIds?: Set<string>
}>(), {
  loading: false,
  error: '',
  emptyTitle: '这里还没有本地音乐',
  emptyDescription: '导入音乐文件或文件夹，开始整理你的音乐收藏。',
  offset: 0,
  selectedIds: () => new Set<string>(),
})

defineEmits<{
  play: [track: LX.Music.MusicInfoLocal]
  add: [track: LX.Music.MusicInfoLocal]
  remove: [track: LX.Music.MusicInfoLocal]
  edit: [track: LX.Music.MusicInfoLocal]
  select: [id: string]
  retry: []
  artist: [text: string, track: LX.Music.MusicInfoLocal]
  album: [text: string, track: LX.Music.MusicInfoLocal]
}>()

const scrollContainer = ref<HTMLElement>()
const { visibleItems, hasMore, reservedHeight, loadMore, reset } = useProgressiveList<LX.Music.MusicInfoLocal>(computed(() => props.list), 24, scrollContainer, '.local-track-table__row')
watch(() => props.listId, reset, { flush: 'post' })
const currentTrack = computed(() => {
  const track = playMusicInfo.musicInfo
  return track && 'metadata' in track ? track.metadata.musicInfo : track
})
const artistNames = (track: LX.Music.MusicInfoLocal) => track.singer.split(/[、,，;；]|\s+\/\s+/).map(name => name.normalize('NFKC').trim().replace(/\s+/g, ' ')).filter(Boolean)
const albumName = (track: LX.Music.MusicInfoLocal) => track.meta.albumName.trim()
</script>

<style lang="less">
.local-track-table { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; color: var(--modern-text); container-type: inline-size; > .ui-empty { flex: 1; } }
.local-track-table__scroll { flex: 1; min-height: 0; overflow: auto; }
.local-track-table__head, .local-track-table__row { display: grid; grid-template-columns: 30px minmax(140px, 1.7fr) minmax(90px, 1fr) 62px 50px 125px; align-items: center; column-gap: 12px; padding: 0 14px; border-block: 0; }
.local-track-table__head { position: sticky; top: 0; z-index: 1; min-height: 40px; background: var(--modern-panel); color: var(--modern-muted); font-size: 10px; }
.local-track-table__row { min-height: max(66px, calc(var(--modern-row-height) + 20px)); font-size: 11px; transition: background .15s; &:hover, &:focus-within { background: var(--modern-hover); } &--active { .local-track-table__title, .local-track-table__index { color: var(--modern-accent-ink); } } &--selected { background: var(--modern-accent-soft); } }
.local-track-table__index { display: flex; align-items: center; justify-content: center; color: var(--modern-muted); font-size: 10px; font-variant-numeric: tabular-nums; svg { width: 16px; height: 16px; } }
.local-track-table__song { display: flex; align-items: center; gap: 12px; min-width: 0; }
.local-track-table button { font: inherit; cursor: pointer; &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 2px; border-radius: 5px; } }
.local-track-table__cover { position: relative; display: grid; place-items: center; flex: none; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 11px; overflow: hidden; background: var(--modern-accent-soft); }
.local-track-table__cover-play { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; background: rgba(0, 0, 0, .35); color: white; transition: opacity .15s; svg { width: 17px; height: 17px; } }
.local-track-table__cover:hover .local-track-table__cover-play { opacity: 1; }
.local-track-table__metadata { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.local-track-table__title { display: block; max-width: 100%; padding: 0; border: 0; overflow: hidden; background: transparent; color: var(--modern-text); text-align: left; text-overflow: ellipsis; white-space: nowrap; font-weight: 500 !important; &:hover { color: var(--modern-accent-ink); } }
.local-track-table__artists, .local-track-table__album { min-width: 0; overflow: hidden; color: var(--modern-muted); text-overflow: ellipsis; white-space: nowrap; }
.local-track-table__artists { font-size: 10px; }
.local-track-table__link { display: inline; max-width: 100%; padding: 0; border: 0; color: inherit; background: transparent; text-align: left; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; &:hover { color: var(--modern-accent-ink); text-decoration-color: currentColor; } }
.local-track-table__album .local-track-table__link { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.local-track-table__format, .local-track-table__duration { color: var(--modern-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.local-track-table__format > span { display: inline-block; max-width: 100%; padding: 3px 5px; overflow: hidden; border: 1px solid var(--modern-border); border-radius: 5px; line-height: 1; text-overflow: ellipsis; white-space: nowrap; }
.local-track-table__actions { display: flex; align-items: center; justify-content: flex-end; gap: 3px; button { display: grid; place-items: center; width: 29px; height: 29px; flex: none; padding: 0; border: 0; border-radius: 8px; color: var(--modern-muted); background: transparent; &:hover { background: var(--modern-accent-soft); color: var(--modern-accent-ink); } svg { width: 16px; height: 16px; } } input { width: 14px; height: 14px; flex: none; margin: 0 0 0 6px; accent-color: var(--modern-accent); cursor: pointer; &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 2px; } } }
.local-track-table__loading { display: flex; flex: 1; align-items: center; justify-content: center; gap: 9px; min-height: 190px; color: var(--modern-muted); font-size: 11px; svg { width: 17px; height: 17px; } }
@container (max-width: 820px) { .local-track-table__head, .local-track-table__row { grid-template-columns: 26px minmax(130px, 1.4fr) minmax(85px, 1fr) 46px 116px; column-gap: 8px; padding: 0 10px; } .local-track-table__format { display: none; } .local-track-table__actions { gap: 1px; button { width: 27px; } input { margin-left: 5px; } } }
@container (max-width: 630px) { .local-track-table__head, .local-track-table__row { grid-template-columns: 24px minmax(100px, 1fr) 43px 116px; column-gap: 6px; padding: 0 6px; } .local-track-table__album { display: none; } }
@container (max-width: 560px) { .local-track-table__head, .local-track-table__row { grid-template-columns: 24px minmax(100px, 1fr) 43px 116px; column-gap: 6px; padding: 0 6px; } .local-track-table__format { display: none; } .local-track-table__cover { width: 34px; height: 34px; border-radius: 9px; } .local-track-table__song { gap: 8px; } .local-track-table__actions { gap: 1px; button { width: 27px; } input { margin-left: 5px; } } }
</style>
