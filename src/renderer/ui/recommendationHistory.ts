import fs from 'node:fs'
import path from 'node:path'
import { musicLinksFilename } from './musicLinksFile'
import { canonicalHistoryKey, recommendationKey } from './recommendationMix'

interface History { version: 1, keys: string[], round: number }
export class RecommendationHistory {
  private snapshot: History = { version: 1, keys: [], round: 0 }
  private queue: Promise<unknown> = Promise.resolve()
  readonly ready: Promise<History>
  constructor(readonly filename = path.join(path.dirname(musicLinksFilename()), 'recommendation-history.json')) {
    this.ready = this.read().then(data => { this.snapshot = data; return data })
  }

  private async read(): Promise<History> {
    try {
      const stat = await fs.promises.stat(this.filename)
      if (stat.size > 2 * 1024 * 1024) throw new Error('推荐记录过大，暂时无法读取。')
      const data: unknown = JSON.parse(await fs.promises.readFile(this.filename, 'utf8'))
      if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('keys' in data) || !Array.isArray(data.keys) || !data.keys.every(key => typeof key === 'string' && key.length < 16384)) throw new Error('推荐记录无法读取，原文件已保留。')
      return { version: 1, keys: [...new Set<string>(data.keys.map(canonicalHistoryKey))].slice(-500), round: 'round' in data && Number.isSafeInteger(data.round) && Number(data.round) >= 0 ? Number(data.round) : 0 }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, keys: [], round: 0 }
      throw error
    }
  }

  async record(tracks: LX.Music.MusicInfo[], round: number, allowRepeated = false, commit?: () => boolean) {
    const next = this.queue.then(async() => {
      await this.ready
      const keys = [...new Set(tracks.map(recommendationKey))]
      if (!allowRepeated && keys.some(key => this.snapshot.keys.includes(key))) throw new Error('推荐列表已经更新，请重新加载。')
      if (commit && !commit()) throw new Error('已切换推荐平台。')
      const added = new Set(keys)
      const updated: History = { version: 1, keys: [...this.snapshot.keys.filter(key => !added.has(key)), ...keys].slice(-500), round: Math.max(round, this.snapshot.round) }
      // Commit display and in-memory history in the same turn. An unseen batch
      // cannot enter history, and a disk failure cannot allow session duplicates.
      this.snapshot = updated
      await fs.promises.mkdir(path.dirname(this.filename), { recursive: true })
      await fs.promises.writeFile(this.filename + '.tmp', JSON.stringify(updated, null, 2) + '\n', 'utf8')
      await fs.promises.rename(this.filename + '.tmp', this.filename)
      return updated
    })
    this.queue = next.catch(() => {})
    return next
  }

  get current() { return this.snapshot }
}

let sharedHistory: RecommendationHistory | undefined
export function getRecommendationHistory() { return sharedHistory ??= new RecommendationHistory() }
