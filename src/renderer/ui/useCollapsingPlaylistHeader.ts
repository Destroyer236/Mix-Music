import { onBeforeUnmount, onMounted, ref, watch, type Ref, type WatchSource } from 'vue'

/** Keep the playlist controls visible while its own song list scrolls. */
export function useCollapsingPlaylistHeader(container: Ref<HTMLElement | null>, sources: Array<WatchSource<unknown>>, selector: string) {
  const compact = ref(false)
  let previousTop = 0
  let upwardDistance = 0
  let settlingUntil = 0
  function changeCompact(value: boolean) {
    if (compact.value === value) return
    compact.value = value
    // Resizing the song viewport can clamp scrollTop near the final row.
    // Ignore that layout movement when detecting an upward gesture.
    settlingUntil = performance.now() + 360
    upwardDistance = 0
  }
  function onScroll(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.matches(selector)) return
    const top = target.scrollTop
    const delta = top - previousTop
    previousTop = top
    if (top <= 4) { changeCompact(false); return }
    if (performance.now() < settlingUntil) return
    if (delta > 0) {
      upwardDistance = 0
      // Short lists should retain their full header rather than bounce when
      // shrinking the cover makes every song fit without a scrollbar.
      if (top > 40 && target.scrollHeight - target.clientHeight > 160) changeCompact(true)
    } else if (delta < 0) {
      upwardDistance -= delta
      if (upwardDistance >= 64) changeCompact(false)
    }
  }
  watch(sources, () => { compact.value = false; previousTop = 0; upwardDistance = 0; settlingUntil = 0 }, { flush: 'post' })
  onMounted(() => { container.value?.addEventListener('scroll', onScroll, true) })
  onBeforeUnmount(() => { container.value?.removeEventListener('scroll', onScroll, true) })
  return compact
}
