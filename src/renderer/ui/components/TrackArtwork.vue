<template>
  <span ref="host" class="ui-track-artwork"><img v-if="visible && url && !failed" :src="url" :alt="alt" loading="lazy" decoding="async" @load="imageLoaded" @error="imageError"><span v-else class="ui-track-artwork-fallback" aria-hidden="true"><slot name="fallback"><UiIcon name="music" /></slot></span></span>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'
import { resolveArtwork } from '../services/artwork'
const props = withDefaults(defineProps<{ track?: LX.Music.MusicInfo | null, src?: string | null, listId?: string | null, alt?: string }>(), { track: null, src: null, listId: null, alt: '' })
const emit = defineEmits<{ loaded: [image: HTMLImageElement] }>()
function imageLoaded(event: Event) { emit('loaded', event.target as HTMLImageElement) }
const host = ref<HTMLElement | null>(null)
const url = ref('')
const failed = ref(false)
const visible = ref(false)
let observer: IntersectionObserver | null = null
let version = 0
let refreshed = false
async function load(refresh = false) {
  const request = ++version
  if (!visible.value) return
  const knownUrl = (props.src ? props.src : props.track?.meta.picUrl) ?? ''
  if (!refresh && knownUrl) { url.value = knownUrl; failed.value = false; return }
  if (!props.track) return
  const result = await resolveArtwork(props.track, props.listId, refresh)
  if (request !== version) return
  url.value = result
  failed.value = !result
}
function imageError() { failed.value = true; if (!refreshed && props.track) { refreshed = true; void load(true) } }
watch(() => [props.track?.source, props.track?.id, props.src, props.track?.meta.picUrl], () => { version++; url.value = ''; failed.value = false; refreshed = false; void load() })
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    const intersecting = entries.some(entry => entry.isIntersecting)
    if (visible.value === intersecting) return
    visible.value = intersecting
    // If the original URL had expired, reuse its refreshed cache entry when
    // the row returns instead of retrying the stale URL from track metadata.
    if (intersecting) void load(refreshed)
    else {
      // Remove the decoded image when its row leaves the visible region. The
      // artwork service retains only a small bounded cache for scrolling back.
      version++
      url.value = ''
      failed.value = false
    }
  }, { rootMargin: '100px' })
  if (host.value) observer.observe(host.value)
})
onBeforeUnmount(() => { version++; observer?.disconnect() })
</script>
<style lang="less">
.ui-track-artwork { display: grid; place-items: center; width: 100%; height: 100%; overflow: hidden; border-radius: inherit; background: var(--modern-accent-soft); color: var(--modern-accent-ink); img { display: block; width: 100%; height: 100%; object-fit: cover; } }
.ui-track-artwork-fallback { display: grid; place-items: center; width: 100%; height: 100%; background: radial-gradient(circle at 25% 25%, var(--modern-panel), transparent 70%), var(--modern-accent-soft); svg { width: 52%; height: 52%; opacity: .65; } }
</style>
