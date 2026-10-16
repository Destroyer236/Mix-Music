<template>
  <section ref="pageContainer" class="ui-page ui-comments-page" aria-label="歌曲评论">
    <div v-if="loading" class="ui-comments-resolving" role="status">正在读取歌曲…</div>
    <UiEmpty v-else-if="!track" title="暂时无法读取这首歌" :description="error || '请从播放器重新打开歌曲评论。'" :retry="Boolean(error)" @retry="loadTrack" />
    <template v-else>
      <header class="ui-comments-song">
        <div class="ui-comments-cover"><TrackArtwork :track="track" :list-id="listId" :alt="track.name" /></div>
        <div class="ui-comments-song-info">
          <span class="ui-comments-eyebrow">歌曲评论<span v-if="track.source === 'local'" class="ui-comments-local-source">本地音乐</span><TrackBadges v-else :track="track" /></span>
          <h1 :title="track.name">{{ track.name }}</h1>
          <p class="ui-comments-artists"><template v-for="(artist, index) in artists" :key="artist"><span v-if="index" aria-hidden="true"> / </span><router-link :to="artistLocation(artist)">{{ artist }}</router-link></template><span v-if="!artists.length">未知歌手</span></p>
          <p v-if="track.meta.albumName" class="ui-comments-album" :title="track.meta.albumName">专辑 · {{ track.meta.albumName }}</p>
        </div>
        <button type="button" class="ui-comments-play" :disabled="playing" @click="play"><UiIcon name="play" filled />{{ playing ? '正在准备…' : '播放歌曲' }}</button>
      </header>
      <p v-if="playError" class="ui-dialog-error" role="alert">{{ playError }}</p>
      <CommentsPanel :key="`${track.source}:${track.id}`" :track="track" @navigate="scrollToTop" />
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { LIST_IDS } from '@common/constants'
import { playMusicInfo } from '@renderer/store/player/state'
import { getListMusics } from '@renderer/store/list/action'
import { getDownloadList } from '@renderer/store/download/action'
import { getCatalogSources } from '../services/catalogSearch'
import { playTrack } from '../services/music'
import CommentsPanel from '../components/CommentsPanel.vue'
import TrackArtwork from '../components/TrackArtwork.vue'
import TrackBadges from '../components/TrackBadges.vue'
import UiEmpty from '../components/UiEmpty.vue'
import UiIcon from '../components/UiIcon.vue'

const route = useRoute()
const queryValue = (value: unknown) => typeof value === 'string' ? value : ''
const listId = computed(() => queryValue(route.query.listId))
const track = shallowRef<LX.Music.MusicInfo | null>(null)
const pageContainer = ref<HTMLElement | null>(null)
const loading = ref(false)
const error = ref('')
const playing = ref(false)
const playError = ref('')
const artists = computed(() => [...new Set((track.value?.singer ?? '').split(/\s*、\s*|\s+\/\s+/).map(name => name.trim()).filter(Boolean))])
const artistLocation = (text: string) => ({ path: '/search', query: { text, type: 'artist', source: getCatalogSources('artist').includes(track.value?.source as LX.OnlineSource) ? track.value?.source : 'all', page: '1' } })
let requestId = 0
function scrollToTop() { if (pageContainer.value) pageContainer.value.scrollTop = 0 }
async function loadTrack() {
  const request = ++requestId
  const id = queryValue(route.query.id)
  error.value = ''
  playError.value = ''
  track.value = null
  scrollToTop()
  const current = playMusicInfo.musicInfo
  if (current?.id === id && (playMusicInfo.listId ?? '') === listId.value) {
    track.value = 'metadata' in current ? current.metadata.musicInfo : current
    loading.value = false
    return
  }
  if (!id || !listId.value) { loading.value = false; return }
  loading.value = true
  try {
    const list = listId.value === LIST_IDS.DOWNLOAD ? await getDownloadList() : await getListMusics(listId.value)
    if (request !== requestId) return
    const original = list.find(item => item.id === id)
    track.value = original ? ('metadata' in original ? original.metadata.musicInfo : original) : null
  } catch { if (request === requestId) error.value = '歌曲资料暂时无法读取，请重试。' } finally { if (request === requestId) loading.value = false }
}
async function play() {
  if (!track.value || playing.value) return
  playing.value = true
  playError.value = ''
  try { await playTrack(track.value) } catch (err) { playError.value = err instanceof Error ? err.message : '暂时无法播放。' } finally { playing.value = false }
}
watch(() => [route.query.id, route.query.listId], () => { if (route.path === '/comment') void loadTrack() }, { immediate: true })
onBeforeUnmount(() => { requestId++ })
</script>
<style lang="less">
.ui-shell .ui-comments-page { padding: 26px 32px 24px; color: var(--modern-text); }
.ui-comments-resolving { padding: 48px 0; color: var(--modern-muted); font-size: 13px; }
.ui-comments-song { display: flex; align-items: center; gap: 22px; padding-bottom: 26px; border-bottom: 1px solid var(--modern-border); margin-bottom: 22px; }
.ui-comments-cover { flex: none; width: 108px; height: 108px; overflow: hidden; border-radius: 10px; }
.ui-comments-song-info { flex: 1; min-width: 0; h1 { margin: 7px 0 9px; font-size: clamp(20px, 2vw, 27px); font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } }
.ui-comments-eyebrow { display: flex; align-items: center; gap: 10px; color: var(--modern-muted); font-size: 11px; > .ui-comments-local-source { border-left: 1px solid var(--modern-border); padding-left: 10px; } }
.ui-comments-artists { font-size: 13px; line-height: 1.6; a { color: var(--modern-muted); text-decoration: none; &:hover { color: var(--modern-accent-ink); text-decoration: underline; } } }
.ui-comments-album { margin-top: 5px; font-size: 11px; color: var(--modern-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-comments-play { display: inline-flex; flex: none; align-items: center; justify-content: center; gap: 7px; padding: 10px 16px; border: 0; border-radius: 22px; background: var(--modern-accent); color: var(--modern-accent-contrast); font: inherit; font-size: 12px; cursor: pointer; svg { width: 16px; height: 16px; } &:disabled { opacity: .5; cursor: default; } }
.ui-comments-page :is(button, a):focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 3px; }
@media (max-width: 800px) { .ui-shell .ui-comments-page { padding: 20px; } .ui-comments-song { flex-wrap: wrap; gap: 14px; padding-bottom: 20px; } .ui-comments-cover { width: 80px; height: 80px; } .ui-comments-song-info h1 { font-size: 20px; margin: 5px 0; } .ui-comments-play { margin-left: 94px; padding: 8px 13px; } }
@media (max-height: 620px) { .ui-comments-cover { width: 80px; height: 80px; } .ui-comments-song { padding-bottom: 16px; margin-bottom: 16px; } }
</style>
