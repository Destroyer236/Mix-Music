export interface SearchPreview { id: string, name: string, singer: string, image: string }
export interface SuggestionState { items: string[], songs: SearchPreview[], artists: SearchPreview[], loading: boolean, failed: boolean }
interface SuggestionProvider { search: (query: string) => Promise<unknown>, cancel: () => void }
const blank = () => ({ items: [] as string[], songs: [] as SearchPreview[], artists: [] as SearchPreview[] })
const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 200) : ''
export function normalizeSearchSuggestions(value: unknown) {
  const result = blank()
  if (Array.isArray(value)) {
    const seen = new Set<string>()
    for (const raw of value) {
      if (typeof raw !== 'string' || raw.length > 200) continue
      const word = raw.trim()
      const key = word.toLocaleLowerCase()
      if (!word || seen.has(key)) continue
      seen.add(key)
      result.items.push(word)
      if (result.items.length === 8) break
    }
    return result
  }
  if (!value || typeof value !== 'object') return result
  const data = value as Record<string, { itemlist?: unknown[] }>
  for (const [key, target, limit] of [['song', result.songs, 4], ['singer', result.artists, 2]] as const) {
    const seen = new Set<string>()
    const list = data[key]?.itemlist
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      const name = text(row.name)
      const singer = key === 'song' ? text(row.singer) : ''
      const identity = `${name}:${singer}`.toLocaleLowerCase()
      if (!name || seen.has(identity)) continue
      seen.add(identity)
      const image = typeof row.pic === 'string' && /^https?:\/\//i.test(row.pic) && row.pic.length < 2048 ? row.pic.replace(/^http:/i, 'https:') : ''
      target.push({ id: text(row.mid) || text(row.id) || identity, name, singer, image })
      if (target.length === limit) break
    }
  }
  return result
}

/** Each input owns its request; only a complete result for the current text is published. */
export function createSearchSuggestions(provider: SuggestionProvider, publish: (state: SuggestionState) => void) {
  const cache = new Map<string, ReturnType<typeof blank>>()
  let generation = 0
  let debounce: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const cancel = () => { try { provider.cancel() } catch {} }
  function stop() {
    generation++
    clearTimeout(debounce)
    clearTimeout(deadline)
    debounce = deadline = undefined
    cancel()
  }
  function update(text: string) {
    if (disposed) return
    stop()
    const query = text.trim().slice(0, 200)
    const current = generation
    if (!query) { publish({ ...blank(), loading: false, failed: false }); return }
    const saved = cache.get(query)
    if (saved) {
      cache.delete(query)
      cache.set(query, saved)
      publish({ ...saved, loading: false, failed: false })
      return
    }
    publish({ ...blank(), loading: true, failed: false })
    debounce = setTimeout(() => {
      debounce = undefined
      let settled = false
      const finish = (value: unknown, failed: boolean) => {
        if (settled || disposed || current !== generation) return
        settled = true
        clearTimeout(deadline)
        deadline = undefined
        const result = normalizeSearchSuggestions(value)
        if (!failed) {
          cache.set(query, result)
          if (cache.size > 20) cache.delete(cache.keys().next().value!)
        }
        publish({ ...result, loading: false, failed })
      }
      deadline = setTimeout(() => { finish([], true); cancel() }, 3000)
      Promise.resolve().then(async() => provider.search(query)).then(value => { finish(value, false) }, () => { finish([], true) })
    }, 220)
  }
  return {
    update,
    close: () => { stop(); publish({ ...blank(), loading: false, failed: false }) },
    dispose: () => { disposed = true; stop(); cache.clear() },
  }
}
