import { chooseMatch } from '@common/platformMatching'
import { setTimeout as scheduleTimeout, clearTimeout as cancelTimeout } from 'node:timers'
import type { PlatformAccount } from '@common/platformAccounts'
import type { PlaybackResolveOptions, PlatformQuality, PlatformStream, ResolvedPlatformStream } from '@common/platformPlayback'
import { getImportedSourceId, isPreferredPlatformSource } from '@common/platformSources'
import type { PlatformProvider, ProviderContext } from './providers/types'

// A provider resolves `auto` to the best stream it can return. When the user
// leaves the source preference on automatic, compare those returned tiers so a
// low-quality stream from one platform does not win over a better stream from
// another platform. Ties keep the resolver's existing source order.
const qualityRank: Partial<Record<PlatformQuality, number>> = {
  '64k': 1,
  '128k': 2,
  '192k': 3,
  '320k': 4,
  dolby: 5,
  sky: 5,
  flac: 6,
  ape: 6,
  wav: 6,
  jyeffect: 7,
  flac24bit: 7,
  jymaster: 7,
}
const streamQualityRank = (stream: PlatformStream): number => {
  const quality = stream.quality && stream.quality !== 'auto' ? stream.quality : stream.type
  return qualityRank[quality] ?? 0
}
const maxQualityRank = Math.max(...Object.values(qualityRank))
const sourceTimeoutMs = 6000
const qualityWaitMs = 700

// Keep an unresponsive search, native API, or imported script from holding up
// every other playable source. The underlying request can still fill its cache.
const bounded = async<T>(request: Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = scheduleTimeout(() => { reject(new Error('音源响应超时')) }, sourceTimeoutMs)
  void request.then(resolve, reject).finally(() => { cancelTimeout(timer) })
})

export interface PlaybackState {
  provider: PlatformProvider
  context: ProviderContext
  account: PlatformAccount
  tracks: LX.Music.MusicInfoOnline[]
  generation: number
}
export interface ImportedPlaybackSource {
  id: string
  name: string
  resolve: (track: LX.Music.MusicInfoOnline, quality: PlatformQuality, states: PlaybackState[], refresh: boolean, allowToggleSource: boolean, options?: PlaybackResolveOptions) => Promise<ResolvedPlatformStream>
}

export const createPlaybackResolver = (getStates: () => PlaybackState[], getPreferredSource: () => unknown = () => 'auto', getImportedSources: () => ImportedPlaybackSource[] = () => []) => {
  const cache = new Map<string, { stream: ResolvedPlatformStream, until: number }>()
  const pending = new Map<string, Promise<PlatformStream>>()
  const failures = new Map<string, { error: Error, until: number }>()
  const searches = new WeakMap<PlaybackState, Map<string, { request: Promise<LX.Music.MusicInfoOnline | null>, pending: boolean, until: number }>>()
  const matchFor = async(state: PlaybackState, track: LX.Music.MusicInfoOnline, refresh: boolean): Promise<LX.Music.MusicInfoOnline | null> => {
    const cached = chooseMatch(track, state.tracks)
    if (cached.status === 'matched') return cached.track
    // Preloading and foreground playback often ask for the same recording at
    // once. Share that search and its exact match, including version/duration.
    const key = JSON.stringify([state.generation, track.source, track.id, track.name, track.singer, track.interval, track.meta.albumName, track.meta.recordingVersion])
    let entries = searches.get(state)
    if (!entries) { entries = new Map(); searches.set(state, entries) }
    const saved = entries.get(key)
    if (saved && (saved.pending || (!refresh && saved.until > Date.now()))) return saved.request
    if (entries.size > 100) for (const [key, entry] of entries) if (!entry.pending) entries.delete(key)
    const entry = { request: Promise.resolve<LX.Music.MusicInfoOnline | null>(null), pending: true, until: 0 }
    entry.request = state.provider.search(state.context, track).then(candidates => {
      const matched = chooseMatch(track, candidates)
      entry.until = Date.now() + (matched.status === 'matched' ? 240000 : 15000)
      return matched.status === 'matched' ? matched.track : null
    }, error => {
      entry.until = Date.now() + 3000
      throw error
    }).finally(() => { entry.pending = false })
    entries.set(key, entry)
    return entry.request
  }
  const streamFor = async(state: PlaybackState, track: LX.Music.MusicInfoOnline, quality: PlatformQuality, refresh: boolean): Promise<ResolvedPlatformStream> => {
    const generation = state.generation
    const key = `${state.provider.id}:${generation}:${state.account.profile?.id ?? ''}:${track.id}:${quality}`
    const saved = cache.get(key)
    if (!refresh && saved && saved.until > Date.now()) return saved.stream
    if (!state.provider.musicUrl) throw new Error('平台未提供播放接口')
    let request = pending.get(key)
    if (!request) {
      request = state.provider.musicUrl(state.context, track, quality)
      pending.set(key, request)
    }
    let stream: PlatformStream
    try { stream = await request } finally { if (pending.get(key) === request) pending.delete(key) }
    if (state.generation !== generation) throw new Error('平台账号已更改，请重新播放')
    if (!/^https?:\/\//.test(stream.url)) throw new Error('平台未返回有效播放地址')
    const resolved = { ...stream, platform: state.provider.name, musicInfo: track }
    if (cache.size > 100) cache.clear()
    cache.set(key, { stream: resolved, until: Date.now() + Math.max(0, Math.min(300, (stream.expires ?? 300) - 30)) * 1000 })
    return resolved
  }
  const validate = (track: LX.Music.MusicInfoOnline) => {
    if (!track || typeof track.id !== 'string' || typeof track.name !== 'string' || typeof track.singer !== 'string' || track.meta?.songId == null) throw new Error('无效的歌曲信息')
  }
  const resolve = async(track: LX.Music.MusicInfoOnline, quality: PlatformQuality = 'auto', refresh = false, allowToggleSource = true, options: PlaybackResolveOptions = {}): Promise<ResolvedPlatformStream> => {
    validate(track)
    const rejected = new Set(options.rejectedUrls)
    const accept = (stream: ResolvedPlatformStream) => {
      if (rejected.has(stream.url)) throw new Error('返回了已失效的播放地址')
      return stream
    }
    const states = getStates().filter(state => state.provider.musicUrl)
    const original = states.find(state => state.provider.source === track.source)
    const errors: string[] = []
    const requestedSource = getPreferredSource()
    const imports = getImportedSources()
    const preferredImport = allowToggleSource ? imports.find(source => source.id === getImportedSourceId(requestedSource)) : undefined
    if (preferredImport) {
      try { return accept(await preferredImport.resolve(track, quality, states, refresh, allowToggleSource, options)) } catch (error) { errors.push(`${preferredImport.name}：${error instanceof Error ? error.message : '无法播放'}`) }
    }
    const preferred = allowToggleSource && isPreferredPlatformSource(requestedSource) && requestedSource !== 'auto'
      ? states.find(state => state.provider.source === requestedSource)
      : undefined
    const automaticSource = allowToggleSource && requestedSource === 'auto'
    // A logged-in source owns the current track, so give it the first attempt
    // in automatic mode. Imported scripts intentionally do not get this
    // privilege; they remain explicit preferences or fallbacks.
    const prioritizeOriginal = automaticSource && original?.account.connected === true
    const alternatives = allowToggleSource
      ? states.filter(state => state !== original && state !== preferred).sort((a, b) => Number(b.account.connected) - Number(a.account.connected))
      : []
    const ordered = [...new Set([preferred, original, ...alternatives].filter((state): state is PlaybackState => Boolean(state)))]
    const trials: Array<{ state: PlaybackState, generation: number, stream: ResolvedPlatformStream }> = []
    const signature = JSON.stringify([track.source, track.id, track.name, track.singer, track.interval, track.meta.albumName, track.meta.recordingVersion, quality, [...rejected]])
    const requestCandidate = async(id: string, request: () => Promise<ResolvedPlatformStream | null>): Promise<ResolvedPlatformStream | null> => {
      const key = `${id}:${signature}`
      const failed = failures.get(key)
      if (!refresh && failed && failed.until > Date.now()) throw failed.error
      try {
        const stream = await bounded(request())
        failures.delete(key)
        return stream
      } catch (error) {
        const cause = error instanceof Error ? error : new Error('无法播放')
        if (failures.size > 100) failures.clear()
        // The player can retry after a resolver error. Cache even an outer
        // timeout so that retry does not wait on the same slow request again.
        failures.set(key, { error: cause, until: Date.now() + 5000 })
        throw cause
      }
    }
    const resolveNative = async(state: PlaybackState): Promise<ResolvedPlatformStream | null> => {
      const generation = state.generation
      let candidate = track
      if (state !== original) {
        const matched = await matchFor(state, track, refresh)
        if (state.generation !== generation || !matched) return null
        candidate = matched
      }
      const stream = await streamFor(state, candidate, quality, refresh)
      if (!rejected.has(stream.url) || quality === '128k') return accept(stream)
      // A full URL can pass the platform API but fail in the audio element.
      // Ask the standard endpoint before giving up on this platform so its
      // official preview can remain the final fallback. Keep the saved quality
      // preference and reject any URL that has already failed playback.
      return accept(await streamFor(state, candidate, '128k', refresh))
    }
    if (automaticSource) {
      // An authenticated original retains its direct-play fast path. Only a
      // failed or preview response needs cross-platform quality comparison.
      if (prioritizeOriginal && original) {
        const generation = original.generation
        try {
          const stream = await requestCandidate(`native:${original.provider.id}:${generation}`, async() => resolveNative(original))
          if (stream && !stream.isTrial) return stream
          if (stream) trials.push({ state: original, generation, stream })
        } catch (error) { errors.push(`${original.provider.name}：${error instanceof Error ? error.message : '无法播放'}`) }
      }
      const candidates = [
        ...ordered.filter(state => !prioritizeOriginal || state !== original).map(state => {
          const generation = state.generation
          return { name: state.provider.name, active: () => state.generation === generation, request: requestCandidate(`native:${state.provider.id}:${generation}`, async() => resolveNative(state)) }
        }),
        ...imports.map(source => ({ name: source.name, active: () => getImportedSources().some(active => active.id === source.id), request: requestCandidate(`imported:${source.id}`, async() => source.resolve(track, quality, states, refresh, allowToggleSource, options).then(accept)) })),
      ]
      // Resolve all sources together. Once complete audio is available, allow a
      // short window for higher quality instead of serially waiting on every
      // unavailable platform and every imported script.
      return new Promise<ResolvedPlatformStream>((resolve, reject) => {
        const results: Array<ResolvedPlatformStream | null> = candidates.map(() => null)
        let remaining = candidates.length
        let finished = false
        let qualityTimer: ReturnType<typeof scheduleTimeout> | undefined
        const finish = () => {
          if (finished) return
          finished = true
          if (qualityTimer) cancelTimeout(qualityTimer)
          let best: ResolvedPlatformStream | null = null
          let bestRank = -1
          for (let index = 0; index < results.length; index++) {
            const stream = results[index]
            if (!stream || stream.isTrial || !candidates[index].active()) continue
            const rank = streamQualityRank(stream)
            if (rank > bestRank) { best = stream; bestRank = rank }
          }
          if (best) { resolve(best); return }
          // Complete streams always beat previews, including imported streams.
          const trial = trials.find(candidate => candidate.state.generation === candidate.generation)?.stream ??
            results.find((stream, index) => stream?.isTrial && candidates[index].active())
          if (trial) resolve(trial)
          else reject(new Error(errors.length ? errors.join('；') : '没有找到有播放权限的同版本歌曲，请登录平台或检查播放权限'))
        }
        if (!remaining) { finish(); return }
        candidates.forEach((candidate, index) => {
          void candidate.request.then(stream => {
            if (finished || !stream || !candidate.active()) return
            results[index] = stream
            if (stream.isTrial) return
            if (streamQualityRank(stream) >= maxQualityRank) { finish(); return }
            qualityTimer ??= scheduleTimeout(finish, qualityWaitMs)
          }, error => { if (!finished) errors.push(`${candidate.name}：${error instanceof Error ? error.message : '无法播放'}`) }).finally(() => {
            if (--remaining === 0) finish()
          })
        })
      })
    }
    for (const state of ordered) {
      const generation = state.generation
      try {
        const stream = await resolveNative(state)
        if (!stream) continue
        // A preferred platform's official preview must not shadow another
        // platform's complete recording. Keep it only as a final fallback.
        if (stream.isTrial) trials.push({ state, generation, stream })
        else return stream
      } catch (error) { errors.push(`${state.provider.name}：${error instanceof Error ? error.message : '无法播放'}`) }
    }
    // Explicit source preferences keep their original ordered fallback path;
    // automatic playback already compared imported and native sources above.
    const importedTrials: ResolvedPlatformStream[] = []
    for (const source of imports) {
      if (source === preferredImport) continue
      try {
        const stream = accept(await source.resolve(track, quality, states, refresh, allowToggleSource, options))
        if (stream.isTrial) importedTrials.push(stream)
        else return stream
      } catch (error) { errors.push(`${source.name}：${error instanceof Error ? error.message : '无法播放'}`) }
    }
    if (importedTrials.length) return importedTrials[0]
    const trial = trials.find(candidate => candidate.state.generation === candidate.generation)
    if (trial) return trial.stream
    throw new Error(errors.length ? errors.join('；') : '没有找到有播放权限的同版本歌曲，请登录平台或检查播放权限')
  }
  const qualitys = async(track: LX.Music.MusicInfoOnline): Promise<PlatformQuality[]> => {
    validate(track)
    const state = getStates().find(state => state.provider.source === track.source)
    if (state?.provider.musicQualitys) return state.provider.musicQualitys(state.context, track)
    return Object.keys(track.meta._qualitys ?? {}) as PlatformQuality[]
  }
  return { resolve, qualitys }
}
