import fs from 'node:fs'
import path from 'node:path'
import runtimeProcess from 'node:process'

export interface RecentTrack { id: string, listId: string, name: string, singer: string, url: string }
export interface MusicLinks { version: 1, favorites: string[], recent: RecentTrack[] }
const RECENT_TRACK_LIMIT = 500
const validUrl = (url: unknown): url is string => typeof url === 'string' && url.length < 16384 && /^(https?:\/\/|file:\/\/\/)/i.test(url)
const empty = (): MusicLinks => ({ version: 1, favorites: [], recent: [] })
export function mergeRecent(first: RecentTrack[], previous: RecentTrack[]): RecentTrack[] {
  const seen = new Set<string>()
  return [...first, ...previous].filter(track => {
    const key = `${track.listId}:${track.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, RECENT_TRACK_LIMIT)
}
export function parseMusicLinks(text: string): MusicLinks {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('favorites' in value) || !Array.isArray(value.favorites) || !('recent' in value) || !Array.isArray(value.recent)) throw new Error('音乐链接文件格式无法识别，原文件已保留。')
  const recent = value.recent.filter((track): track is RecentTrack => Boolean(track && typeof track === 'object' && ['id', 'listId', 'name', 'singer'].every(key => typeof track[key] === 'string' && track[key].length < 4096) && track.id && track.listId && (track.url === '' || validUrl(track.url))))
  return { version: 1, favorites: [...new Set(value.favorites.filter(validUrl))], recent: mergeRecent(recent.map(({ id, listId, name, singer, url }) => ({ id, listId, name, singer, url })), []) }
}
/** One small reference file; audio, artwork, credentials and signed stream URLs never enter it. */
export class MusicLinksFile {
  readonly ready: Promise<MusicLinks>
  private snapshot: MusicLinks = empty()
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly filename: string) {
    this.ready = this.read().then(data => { this.snapshot = data; return data })
  }

  private async read(): Promise<MusicLinks> {
    try {
      const stat = await fs.promises.stat(this.filename)
      if (stat.size > 8 * 1024 * 1024) throw new Error('音乐链接文件过大，原文件已保留。')
      return parseMusicLinks(await fs.promises.readFile(this.filename, 'utf8'))
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw error }
  }

  private async update(change: (snapshot: MusicLinks) => void): Promise<void> {
    const next = this.queue.then(async() => {
      await this.ready
      change(this.snapshot)
      await fs.promises.mkdir(path.dirname(this.filename), { recursive: true })
      const temporary = `${this.filename}.tmp`
      await fs.promises.writeFile(temporary, JSON.stringify(this.snapshot, null, 2) + '\n', 'utf8')
      await fs.promises.rename(temporary, this.filename)
    })
    this.queue = next.catch(() => {})
    return next
  }

  async recordRecent(track: RecentTrack): Promise<void> { await this.update(data => { data.recent = mergeRecent([track], data.recent) }) }
  async setFavorites(urls: string[]): Promise<void> { const links = [...new Set(urls.filter(validUrl))]; await this.update(data => { data.favorites = links }) }
}
export function musicLinksFilename(): string {
  return runtimeProcess.env.LINKLINE_MUSIC_LINKS_FILE ?? path.join(runtimeProcess.cwd(), 'data', 'music-links.json')
}
