interface CacheEntry { list: LX.Music.MusicInfo[], count: number, bytes: number }

// This is a retention budget, not a limit on music library size. Large lists
// are still returned in full, but are read again instead of staying in the DB
// worker together with every previously opened playlist.
export class MusicListCache {
  private readonly entries = new Map<string, CacheEntry>()
  private count = 0
  private bytes = 0

  constructor(
    private readonly maxTracks = 10_000,
    private readonly maxBytes = 16 * 1024 * 1024,
    private readonly maxLists = 32,
  ) {}

  get(id: string): LX.Music.MusicInfo[] | undefined {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    this.entries.delete(id)
    this.entries.set(id, entry)
    return entry.list
  }

  set(id: string, list: LX.Music.MusicInfo[]) {
    this.delete(id)
    if (list.length > this.maxTracks) return
    let bytes = 64 + id.length * 2
    for (const track of list) {
      // Include a conservative allowance for parsed objects and properties,
      // in addition to UTF-16 strings. Stop estimating once it is too large.
      bytes += 256 + 4 * JSON.stringify(track).length
      if (bytes > this.maxBytes) return
    }
    this.entries.set(id, { list, count: list.length, bytes })
    this.count += list.length
    this.bytes += bytes
    while (this.count > this.maxTracks || this.bytes > this.maxBytes || this.entries.size > this.maxLists) {
      const oldest = this.entries.keys().next().value
      if (oldest == null) return
      this.delete(oldest)
    }
  }

  delete(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.count -= entry.count
    this.bytes -= entry.bytes
    this.entries.delete(id)
  }

  clear() {
    this.entries.clear()
    this.count = 0
    this.bytes = 0
  }
}
