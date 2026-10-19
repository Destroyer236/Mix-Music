<template>
  <div ref="host" class="ui-sidebar-playlist-cover" aria-hidden="true">
    <TrackArtwork :track="coverTrack" :src="list.cover" :list-id="native ? list.id : null"><template #fallback><UiIcon name="list" /></template></TrackArtwork>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { getListMusics } from '@renderer/store/list/action'
import { playlistCoverTrack } from '../usePlaylistCover'
import TrackArtwork from './TrackArtwork.vue'
import UiIcon from './UiIcon.vue'
const props = defineProps<{ list: { id: string, cover?: string }, native: boolean }>()
const host = ref<HTMLElement | null>(null)
const tracks = shallowRef<LX.Music.MusicInfo[]>([])
const coverTrack = computed(() => props.native ? playlistCoverTrack(props.list.id, tracks.value) : null)
let visible = false
let version = 0
let observer: IntersectionObserver | undefined
async function refresh(): Promise<void> {
  const request = ++version
  if (!visible || !props.native || props.list.cover) return
  try {
    // Native playlists are local IPC/cache reads. Platform playlist covers
    // use their existing URL without fetching their remote song lists.
    const list = await getListMusics(props.list.id)
    if (request === version) tracks.value = [...list]
  } catch { if (request === version) tracks.value = [] }
}
const listUpdated = (ids: string[]) => { if (ids.includes(props.list.id)) void refresh() }
watch(() => [props.list.id, props.native, props.list.cover], () => { tracks.value = []; void refresh() })
onMounted(() => {
  window.app_event.on('myListUpdate', listUpdated)
  observer = new IntersectionObserver(entries => {
    if (visible || !entries.some(entry => entry.isIntersecting)) return
    visible = true
    observer?.disconnect()
    void refresh()
  }, { rootMargin: '100px' })
  if (host.value) observer.observe(host.value)
})
onBeforeUnmount(() => { version++; observer?.disconnect(); window.app_event.off('myListUpdate', listUpdated) })
</script>
<style lang="less">
.ui-shell .ui-sidebar-lists > a > .ui-sidebar-playlist-cover {
  display: grid; place-items: center; flex: none; width: 24px; height: 24px; overflow: hidden; border-radius: 4px;
  .ui-track-artwork, .ui-track-artwork-fallback { background: transparent; color: inherit; }
  .ui-track-artwork-fallback svg { width: 18px; height: 18px; opacity: .82; }
}
@media (max-width: 800px) { .ui-shell .ui-sidebar-lists > a > .ui-sidebar-playlist-cover .ui-track-artwork-fallback svg { width: 20px; height: 20px; } }
</style>
