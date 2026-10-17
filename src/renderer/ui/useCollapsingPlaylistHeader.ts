import { onBeforeUnmount, onMounted, ref, watch, type Ref, type WatchSource } from 'vue'

/** Keep the playlist controls visible while its own song list scrolls. */
export function useCollapsingPlaylistHeader(container: Ref<HTMLElement | null>, sources: Array<WatchSource<unknown>>, selector: string) {
  const compact = ref(false)
  let previousTop = 0
  let settlingUntil = 0
  let touchY: number | undefined
  function changeCompact(value: boolean) {
    if (compact.value === value) return
    compact.value = value
    // Resizing the song viewport can clamp scrollTop near the final row.
    // Ignore that layout movement when detecting a downward scroll.
    settlingUntil = performance.now() + 360
  }
  function onScroll(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.matches(selector)) return
    const top = target.scrollTop
    const delta = top - previousTop
    previousTop = top
    if (performance.now() < settlingUntil) return
    if (delta > 0 && !compact.value) {
      // Short lists should retain their full header rather than bounce when
      // shrinking the cover makes every song fit without a scrollbar.
      if (top > 40 && target.scrollHeight - target.clientHeight > 160) changeCompact(true)
    }
  }
  function rowsAtTop(event: Event) {
    const rows = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null
    return rows && container.value?.contains(rows) && rows.scrollTop <= 1
  }
  function onWheel(event: WheelEvent) {
    // Reaching the top (including via a navigation button) only scrolls the
    // songs. A further upward gesture at the top restores the full cover.
    if (event.deltaY < 0 && rowsAtTop(event)) changeCompact(false)
  }
  function onTouchStart(event: TouchEvent) { touchY = event.touches[0]?.clientY }
  function onTouchMove(event: TouchEvent) {
    const nextY = event.touches[0]?.clientY
    if (touchY !== undefined && nextY !== undefined && nextY > touchY && rowsAtTop(event)) changeCompact(false)
    touchY = nextY
  }
  watch(sources, () => { compact.value = false; previousTop = 0; settlingUntil = 0; touchY = undefined }, { flush: 'post' })
  onMounted(() => {
    container.value?.addEventListener('scroll', onScroll, true)
    container.value?.addEventListener('wheel', onWheel, { passive: true })
    container.value?.addEventListener('touchstart', onTouchStart, { passive: true })
    container.value?.addEventListener('touchmove', onTouchMove, { passive: true })
  })
  onBeforeUnmount(() => {
    container.value?.removeEventListener('scroll', onScroll, true)
    container.value?.removeEventListener('wheel', onWheel)
    container.value?.removeEventListener('touchstart', onTouchStart)
    container.value?.removeEventListener('touchmove', onTouchMove)
  })
  return compact
}
