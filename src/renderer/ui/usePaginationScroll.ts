import { ref, watch, type WatchSource } from 'vue'

/** Reset the page's own scroll area after Vue renders the new page state. */
export function usePaginationScroll(pages: Array<WatchSource<unknown>>, selector?: string) {
  const container = ref<HTMLElement | null>(null)
  watch(pages, () => {
    const target = selector ? container.value?.querySelector<HTMLElement>(selector) : container.value
    if (target) target.scrollTop = 0
  }, { flush: 'post' })
  return container
}
