import { computed, nextTick, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'

// Reserve the known list height without mounting offscreen rows or artwork.
export function useProgressiveList<T extends { id: string }>(items: ComputedRef<T[]>, batchSize = 24, container?: Ref<HTMLElement | null | undefined>, rowSelector = '') {
  const limit = ref(batchSize)
  const stride = ref(72)
  const visibleItems = computed(() => items.value.slice(0, limit.value))
  const hasMore = computed(() => limit.value < items.value.length)
  const reservedHeight = computed(() => container ? Math.max(0, items.value.length - visibleItems.value.length) * stride.value : 0)
  let root: HTMLElement | undefined
  let observer: ResizeObserver | undefined
  let frame = 0
  function measure() {
    const rows = root?.querySelectorAll<HTMLElement>(rowSelector)
    if (!rows?.length) return
    const height = rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : rows[0].getBoundingClientRect().height
    if (height > 0) stride.value = height
  }
  function loadMore() { limit.value = Math.min(items.value.length, limit.value + batchSize) }
  function reset() { limit.value = batchSize; if (root) root.scrollTop = 0 }
  function onScroll() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!root || !hasMore.value) return
      const first = root.querySelector<HTMLElement>(rowSelector)
      const start = first ? first.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop : 0
      const needed = Math.ceil((root.scrollTop + root.clientHeight + 120 - start) / stride.value)
      if (needed >= limit.value) limit.value = Math.min(items.value.length, Math.max(limit.value + batchSize, needed + batchSize))
    })
  }
  if (container) {
    watch(container, element => {
      root?.removeEventListener('scroll', onScroll)
      observer?.disconnect()
      root = element ?? undefined
      if (!root) return
      root.addEventListener('scroll', onScroll, { passive: true })
      void nextTick(measure)
      observer = new ResizeObserver(measure)
      observer.observe(root)
    }, { flush: 'post' })
  }
  watch(() => visibleItems.value.length, async() => { await nextTick(); measure() })
  onBeforeUnmount(() => { root?.removeEventListener('scroll', onScroll); observer?.disconnect(); root = undefined; cancelAnimationFrame(frame) })
  return { visibleItems, hasMore, reservedHeight, loadMore, reset }
}
