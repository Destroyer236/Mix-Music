import { recommendationKey } from './recommendationMix'

export interface RecommendationBatch { tracks: LX.Music.MusicInfo[], round: number }
interface BufferOptions {
  history: () => string[]
  prepare: (excluded: string[], valid: () => boolean, background: boolean) => Promise<RecommendationBatch | null>
  commit: (batch: RecommendationBatch) => Promise<unknown>
  usable?: (batch: RecommendationBatch) => boolean
  repair?: (batch: RecommendationBatch, excluded: string[]) => RecommendationBatch | null
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

  private exclusions(omit?: RecommendationBatch) {
    return [...this.options.history(), ...this.batches.filter(batch => batch !== omit).flatMap(batch => batch.tracks.map(recommendationKey)), ...(this.claimed?.tracks.map(recommendationKey) ?? [])]
  }

  private prune() {
    for (let index = 0; index < this.batches.length;) {
      const batch = this.batches[index]
      if (this.options.usable?.(batch) ?? true) { index++; continue }
      const repaired = this.options.repair?.(batch, this.exclusions(batch))
      if (repaired?.tracks.length) { this.batches[index] = repaired; index++ } else this.batches.splice(index, 1)
    }
  }

  private async prepare(background: boolean) {
    if (this.preparing) return this.preparing
    const version = this.version
    const valid = () => version === this.version
    const excluded = this.exclusions()
    const task = this.options.prepare(excluded, valid, background).then(batch => {
      if (!valid()) return null
      if (!batch?.tracks.length) return null
      // History, other buffers or favorites may have changed during the request.
      if (!(this.options.usable?.(batch) ?? true)) batch = this.options.repair?.(batch, this.exclusions()) ?? null
      if (!batch?.tracks.length) return null
      this.batches.push(batch)
      return batch
    }).finally(() => { if (this.preparing === task) this.preparing = null })
    this.preparing = task
    return task
  }

  async next(commit = this.options.commit) {
    const previous = this.advancing
    const version = this.version
    const task = (async() => {
      // Display refreshes and playback consume different batches. Sharing one
      // result would let one consumer silently skip the other's commit.
      await previous?.catch(() => {})
      if (version !== this.version) return null
      for (let attempt = 0; attempt < 2; attempt++) {
        this.prune()
        if (!this.batches.length) await this.prepare(false)
        if (version !== this.version) return null
        this.prune()
        const batch = this.batches.shift()
        if (!batch) continue
        this.claimed = batch
        try {
          await commit(batch)
          return version === this.version ? batch : null
        } catch (error) {
          if (version === this.version) this.batches.unshift(batch)
          // Retry a stale selection once. Disk and source-switch errors must
          // retain their original meaning instead of advancing another batch.
          if (attempt === 0 && version === this.version && !(error as NodeJS.ErrnoException).code && this.options.usable && !this.options.usable(batch)) continue
          throw error
        } finally { if (this.claimed === batch) this.claimed = null }
      }
      return null
    })().finally(() => { if (this.advancing === task) this.advancing = null })
    this.advancing = task
    return task
  }

  async warm(target = 3) {
    if (this.warming) return this.warming
    const version = this.version
    const task = (async() => {
      try {
        this.prune()
        while (version === this.version && this.batches.length < Math.min(3, target)) {
          this.prune()
          if (!await this.prepare(true)) break
        }
      } catch { /* A background failure leaves displayed and ready batches intact. */ }
    })().finally(() => { if (this.warming === task) this.warming = null })
    this.warming = task
    return task
  }

  reset() { this.version++; this.batches = []; this.preparing = null; this.warming = null; this.advancing = null }
  cancel() {
    this.version++
    if (this.claimed) this.batches.unshift(this.claimed)
    this.claimed = null; this.preparing = null; this.warming = null; this.advancing = null
  }

  refresh() { this.prune() }
  get size() { return this.batches.length }
  get reserved() { return [...this.batches, ...(this.claimed ? [this.claimed] : [])].flatMap(batch => batch.tracks.map(recommendationKey)) }
}
