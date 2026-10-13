import { recommendationKey } from './recommendationMix'

export interface RecommendationBatch { tracks: LX.Music.MusicInfo[], round: number }
interface BufferOptions {
  history: () => string[]
  prepare: (excluded: string[], valid: () => boolean, background: boolean) => Promise<RecommendationBatch | null>
  commit: (batch: RecommendationBatch) => Promise<unknown>
  usable?: (batch: RecommendationBatch) => boolean
}

/** Keep three batches ready; reserve their songs without recording unseen songs. */
export class RecommendationBuffer {
  private batches: RecommendationBatch[] = []
  private claimed: RecommendationBatch | null = null
  private version = 0
  private preparing: Promise<RecommendationBatch | null> | null = null
  private warming: Promise<void> | null = null
  private advancing: Promise<RecommendationBatch | null> | null = null
  constructor(private readonly options: BufferOptions) {}

  private prune() { this.batches = this.batches.filter(batch => this.options.usable?.(batch) ?? true) }

  private async prepare(background: boolean) {
    if (this.preparing) return this.preparing
    const version = this.version
    const valid = () => version === this.version
    const excluded = [...this.options.history(), ...this.batches.flatMap(batch => batch.tracks.map(recommendationKey)), ...(this.claimed?.tracks.map(recommendationKey) ?? [])]
    const task = this.options.prepare(excluded, valid, background).then(batch => {
      if (!valid()) return null
      if (!batch?.tracks.length) return null
      this.batches.push(batch)
      return batch
    }).finally(() => { if (this.preparing === task) this.preparing = null })
    this.preparing = task
    return task
  }

  async next() {
    if (this.advancing) return this.advancing
    const version = this.version
    const task = (async() => {
      this.prune()
      if (!this.batches.length) await this.prepare(false)
      if (version !== this.version) return null
      const batch = this.batches.shift()
      if (!batch) return null
      this.claimed = batch
      try {
        await this.options.commit(batch)
        return version === this.version ? batch : null
      } finally { if (this.claimed === batch) this.claimed = null }
    })().finally(() => { if (this.advancing === task) this.advancing = null })
    this.advancing = task
    return task
  }

  async warm() {
    if (this.warming) return this.warming
    const version = this.version
    const task = (async() => {
      try {
        this.prune()
        while (version === this.version && this.batches.length < 3) {
          this.prune()
          if (!await this.prepare(true)) break
        }
      } catch { /* A background failure leaves displayed and ready batches intact. */ }
    })().finally(() => { if (this.warming === task) this.warming = null })
    this.warming = task
    return task
  }

  reset() { this.version++; this.batches = []; this.preparing = null; this.warming = null; this.advancing = null }
  get size() { return this.batches.length }
}
