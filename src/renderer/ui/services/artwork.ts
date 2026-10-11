import { getPicUrl } from '@renderer/core/music/online'

// Local tags can supply data URLs, so an entry count alone can retain hundreds
// of megabytes while browsing a large music library. Bound both the number of
// URLs and their UTF-16 string storage; visible covers remain owned by the UI.
const MAX_CACHE_ENTRIES = 128
const MAX_CACHE_BYTES = 8 * 1024 * 1024
interface ArtworkCacheEntry { request: Promise<string>, bytes: number }
const cache = new Map<string, ArtworkCacheEntry>()
// Keep in-flight work separate from the settled LRU. A scrolling burst can
// briefly queue thousands of covers; evicting a pending entry from the LRU
// must not allow the same cover to be scheduled a second time.
const pending = new Map<string, Promise<string>>()
let cachedBytes = 0
function trimCache() {
  while (cache.size > MAX_CACHE_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value
    if (oldest == null) return
    cachedBytes -= cache.get(oldest)!.bytes
    cache.delete(oldest)
  }
}
const queue: Array<() => void> = []
let active = 0
function drain() {
  const available = Math.min(4 - active, queue.length)
  for (let index = 0; index < available; index++) queue.shift()?.()
}
export async function resolveArtwork(track: LX.Music.MusicInfo, listId?: string | null, refresh = false): Promise<string> {
  if (track.meta.picUrl && !refresh) return Promise.resolve(track.meta.picUrl)
  const key = `${track.source}:${track.id}:${refresh ? 'refresh' : 'normal'}`
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached.request
  }
  const pendingRequest = pending.get(key)
  if (pendingRequest) return pendingRequest
  const request = new Promise<string>(resolve => {
    queue.push(() => {
      active++
      void (async() => {
        try {
          const url = await (track.source === 'local'
            ? window.lx.worker.main.getMusicFilePic(track.meta.filePath)
            : getPicUrl({ musicInfo: track, listId, isRefresh: refresh, allowToggleSource: false }))
          resolve(typeof url === 'string' ? url : '')
        } catch { resolve('') } finally { active--; drain() }
      })()
    })
    drain()
  })
  pending.set(key, request)
  void request.then(url => {
    if (pending.get(key) !== request) return
    pending.delete(key)
    // Failed artwork is intentionally not retained. A later visible row can
    // retry after its source or local file becomes available.
    if (!url) return
    const entry: ArtworkCacheEntry = { request, bytes: url.length * 2 }
    cache.set(key, entry)
    cachedBytes += entry.bytes
    trimCache()
  }, () => {
    if (pending.get(key) === request) pending.delete(key)
  })
  return request
}
