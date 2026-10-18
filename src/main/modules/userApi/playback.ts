import { legacyQuality, type PlaybackResolveOptions, type PlatformQuality, type ResolvedPlatformStream } from '@common/platformPlayback'
import { chooseMatch } from '@common/platformMatching'
import type { ImportedPlaybackSource, PlaybackState } from '../platformAccounts/playback'
import { getScript, getUserApis } from './utils'
import { createImportedScriptRuntime, ImportedScriptTimeoutError, type ImportedScriptRuntime } from './playbackRuntime'

const runtimes = new Map<string, Promise<ImportedScriptRuntime>>()
const controllers = new Map<string, AbortController>()
const cache = new Map<string, { stream: ResolvedPlatformStream, until: number }>()
const pending = new Map<string, Promise<{ url: string, type: LX.Quality }>>()
const failures = new Map<string, { error: Error, until: number }>()
const cooldowns = new Map<string, { error: Error, until: number }>()
const qualityOrder: LX.Quality[] = ['flac24bit', 'flac', 'ape', 'wav', '320k', '192k', '128k']
const clearSourceCache = (id: string) => {
  for (const entries of [cache, pending, failures]) for (const key of entries.keys()) if (key.startsWith(`${id}:`)) entries.delete(key)
}
// Preserve the exact cached Promise: resolveImported uses its identity to reject
// responses from a removed or replaced runtime.
// eslint-disable-next-line @typescript-eslint/promise-function-async
const runtimeFor = (api: LX.UserApi.UserApiInfo, refresh: boolean): Promise<ImportedScriptRuntime> => {
  const cooldown = cooldowns.get(api.id)
  if (!refresh && cooldown && cooldown.until > Date.now()) return Promise.reject(cooldown.error)
  cooldowns.delete(api.id)
  let runtime = runtimes.get(api.id)
  if (!runtime) {
    const controller = new AbortController()
    controllers.set(api.id, controller)
    runtime = getScript(api.id).then(async script => createImportedScriptRuntime(api, script, {
      signal: controller.signal,
      onClose(error) {
        if (runtimes.get(api.id) !== runtime) return
        runtimes.delete(api.id)
        controllers.delete(api.id)
        clearSourceCache(api.id)
        cooldowns.set(api.id, { error, until: Date.now() + 15000 })
      },
    }))
    runtimes.set(api.id, runtime)
    void runtime.catch((error: unknown) => {
      if (runtimes.get(api.id) !== runtime) return
      runtimes.delete(api.id)
      controllers.delete(api.id)
      cooldowns.set(api.id, { error: error instanceof Error ? error : new Error('导入音源初始化失败'), until: Date.now() + 15000 })
    })
  }
  return runtime
}
export const closeImportedPlayback = (ids = [...new Set([...runtimes.keys(), ...cooldowns.keys()])]) => {
  for (const id of ids) {
    const runtime = runtimes.get(id)
    runtimes.delete(id)
    controllers.get(id)?.abort()
    controllers.delete(id)
    cooldowns.delete(id)
    if (runtime) void runtime.then(runtime => { runtime.close() }).catch(() => {})
    clearSourceCache(id)
  }
}
const qualityFor = (declared: LX.Quality[], requested: PlatformQuality) => {
  const highest = requested === 'auto' ? 0 : qualityOrder.indexOf(legacyQuality(requested))
  return qualityOrder.slice(Math.max(0, highest)).filter(quality => declared.includes(quality))
}
const resolveImported = async(api: LX.UserApi.UserApiInfo, track: LX.Music.MusicInfoOnline, requested: PlatformQuality, states: PlaybackState[], refresh: boolean, allowToggleSource: boolean, options: PlaybackResolveOptions): Promise<ResolvedPlatformStream> => {
  if (!getUserApis().some(source => source.id === api.id)) throw new Error('导入音源已移除，请重新播放')
  const runtimePromise = runtimeFor(api, refresh)
  const runtime = await runtimePromise
  const rejected = new Set(options.rejectedUrls)
  const active = () => runtimes.get(api.id) === runtimePromise && getUserApis().some(source => source.id === api.id)
  if (!active()) throw new Error('导入音源已移除，请重新播放')
  const supported = Object.entries(runtime.sources).filter(([, info]) => info?.type === 'music' && info.actions.includes('musicUrl') && info.qualitys.length)
  const original = supported.find(([source]) => source === track.source)
  const ordered = original ? [original, ...supported.filter(item => item !== original)] : supported
  const errors: string[] = []
  for (const [source, capability] of ordered) {
    if (!capability || (!allowToggleSource && source !== track.source)) continue
    let candidate = track
    if (source !== track.source) {
      const state = states.find(state => state.provider.source === source)
      if (!state) continue
      const generation = state.generation
      let matched = chooseMatch(track, state.tracks)
      if (matched.status !== 'matched') {
        try { matched = chooseMatch(track, await state.provider.search(state.context, track)) } catch (error) { errors.push(`${source}：${error instanceof Error ? error.message : '搜索失败'}`); continue }
      }
      if (!active()) throw new Error('导入音源已移除，请重新播放')
      if (generation !== state.generation || matched.status !== 'matched') continue
      candidate = matched.track
    }
    for (const quality of qualityFor(capability.qualitys, requested)) {
      const key = `${api.id}:${runtime.revision}:${candidate.source}:${candidate.id}:${quality}`
      const cached = cache.get(key)
      if (!refresh && cached && cached.until > Date.now() && !rejected.has(cached.stream.url)) return cached.stream
      const failure = failures.get(key)
      if (!refresh && failure && failure.until > Date.now()) { errors.push(failure.error.message); continue }
      try {
        let request = pending.get(key)
        if (!request) { request = runtime.request(candidate, quality); pending.set(key, request) }
        let response: Awaited<typeof request>
        try { response = await request } finally { if (pending.get(key) === request) pending.delete(key) }
        if (!active()) throw new Error('导入音源已移除，请重新播放')
        if (rejected.has(response.url)) { errors.push(`${source}/${quality}：返回了已失效的播放地址`); continue }
        const stream: ResolvedPlatformStream = { ...response, quality: response.type, platform: api.name, musicInfo: candidate, expires: 300 }
        if (cache.size > 100) cache.clear()
        cache.set(key, { stream, until: Date.now() + 240000 })
        return stream
      } catch (error) {
        if (!active() || error instanceof ImportedScriptTimeoutError) throw error
        const cause = error instanceof Error ? error : new Error('请求失败')
        if (failures.size > 100) failures.clear()
        failures.set(key, { error: cause, until: Date.now() + 5000 })
        errors.push(`${source}/${quality}：${cause.message}`)
      }
    }
  }
  throw new Error(errors.length ? errors.join('；') : '导入音源未声明此歌曲平台的播放能力，或未找到同版本歌曲')
}
export const getImportedPlaybackSources = (): ImportedPlaybackSource[] => getUserApis().map(api => ({
  id: api.id,
  name: api.name,
  resolve: async(track, quality, states, refresh, allowToggleSource, options = {}) => resolveImported(api, track, quality, states, refresh, allowToggleSource, options),
}))
