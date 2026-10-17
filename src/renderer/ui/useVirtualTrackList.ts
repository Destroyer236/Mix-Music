import { computed, nextTick, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'

/** Keep only the visible song rows and a small buffer mounted. */
export function useVirtualTrackList<T>(items: ComputedRef<T[]>, container: Ref<HTMLElement | null | undefined>, rowSelector: string) {
  const rowHeight = ref(72)
  const viewportHeight = ref(0)
  const scrollTop = ref(0)
  const overscan = 8
  const windowSize = computed(() => Math.max(1, Math.ceil(viewportHeight.value / rowHeight.value)) + overscan * 2)
  const startIndex = computed(() => Math.max(0, Math.min(Math.floor(scrollTop.value / rowHeight.value) - overscan, items.value.length - windowSize.value)))
  const endIndex = computed(() => Math.min(items.value.length, startIndex.value + windowSize.value))
  const visibleItems = computed(() => items.value.slice(startIndex.value, endIndex.value))
  const topPadding = computed(() => startIndex.value * rowHeight.value)
  const bottomPadding = computed(() => Math.max(0, items.value.length - endIndex.value) * rowHeight.value)

  let root: HTMLElement | undefined
  let observedRow: HTMLElement | null = null
  let observer: ResizeObserver | undefined
  let frame = 0
  let navigationVersion = 0

  function syncPosition() {
    if (!root) return
    viewportHeight.value = root.clientHeight
    scrollTop.value = root.scrollTop
  }

  function moveTo(top: number) {
    root?.scrollTo({ top, behavior: 'instant' })
    syncPosition()
  }

  function measure(preservePosition = true) {
    const element = root
    if (!element) return
    const row = element.querySelector<HTMLElement>(rowSelector)
    if (row !== observedRow) {
      if (observedRow) observer?.unobserve(observedRow)
      observedRow = row
      if (row) observer?.observe(row)
    }
    const height = row?.getBoundingClientRect().height ?? 0
    if (height > 0 && Math.abs(height - rowHeight.value) > 0.1) {
      // Density and window size can change row height. Keep the same song at
      // the top when recalculating the two spacers.
      const adjustedTop = element.scrollTop / rowHeight.value * height
      const version = navigationVersion
      rowHeight.value = height
      if (preservePosition && element.scrollTop > 0) {
        scrollTop.value = adjustedTop
        void nextTick(() => {
          if (root === element && version === navigationVersion) moveTo(adjustedTop)
        })
        return
      }
    }
    syncPosition()
  }

  function onScroll() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      syncPosition()
    })
  }

  function scrollToTop() {
    navigationVersion++
    scrollTop.value = 0
    moveTo(0)
  }

  function scrollToIndex(index: number) {
    if (!root || !items.value.length || !Number.isFinite(index)) return
    const element = root
    const version = ++navigationVersion
    const target = Math.max(0, Math.min(items.value.length - 1, Math.trunc(index)))
    const center = () => Math.max(0, (target + 0.5) * rowHeight.value - element.clientHeight / 2)
    measure(false)
    // A distant jump must not mount or load artwork for every row on the way.
    moveTo(center())
    void nextTick(() => {
      if (root !== element || version !== navigationVersion) return
      measure(false)
      moveTo(center())
    })
  }

  watch(container, element => {
    navigationVersion++
    root?.removeEventListener('scroll', onScroll)
    observer?.disconnect()
    observedRow = null
    cancelAnimationFrame(frame)
    frame = 0
    root = element ?? undefined
    if (!root) return
    root.addEventListener('scroll', onScroll, { passive: true })
    observer = new ResizeObserver(() => { measure() })
    observer.observe(root)
    syncPosition()
    void nextTick(() => { measure() })
  }, { flush: 'post' })
  watch([startIndex, endIndex], () => { void nextTick(() => { measure() }) }, { flush: 'post' })
  watch(items, () => { scrollToTop(); void nextTick(() => { measure() }) }, { flush: 'post' })
  watch(() => items.value.length, () => { void nextTick(() => { measure() }) }, { flush: 'post' })
  onBeforeUnmount(() => {
    navigationVersion++
    root?.removeEventListener('scroll', onScroll)
    observer?.disconnect()
    root = undefined
    cancelAnimationFrame(frame)
  })

  return { visibleItems, startIndex, topPadding, bottomPadding, reset: scrollToTop, scrollToIndex, scrollToTop }
}
