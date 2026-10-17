import { ipcRenderer } from 'electron'
import { computed, ref, shallowRef, watch } from 'vue'
import { isPlatformQuality, type PlatformQuality, type ResolvedPlatformStream } from '@common/platformPlayback'
import { isPreferredPlatformSource, type PreferredPlatformSource } from '@common/platformSources'
import { playMusicInfo } from '@renderer/store/player/state'
import { appSetting, mergeSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'

export const preferredQuality = computed(() => appSetting['player.playQuality'])
export const preferredSource = computed(() => appSetting['player.preferredSource'])
export const activeStream = shallowRef<(ResolvedPlatformStream & { requested: PlatformQuality, trackId: string }) | null>(null)
export const activePlaybackResource = shallowRef<{ trackId: string, local: boolean } | null>(null)
export const qualityChanging = ref(false)
export const qualityChangeError = ref('')
let qualityReloadHandler: (() => Promise<void>) | null = null
let pendingQualityReload = Promise.resolve()
let qualityChangeGeneration = 0
let reloadQueued = false

async function reloadPreference(): Promise<void> {
  if (!qualityReloadHandler) return Promise.resolve()
  // Backup imports can patch source and quality together. Coalesce the patch
  // into one player resource transaction using the final saved preferences.
  if (reloadQueued) return pendingQualityReload
  const reload = qualityReloadHandler
  const generation = ++qualityChangeGeneration
  reloadQueued = true
  qualityChanging.value = true
  qualityChangeError.value = ''
  pendingQualityReload = Promise.resolve().then(async() => {
    reloadQueued = false
    if (qualityReloadHandler === reload) await reload()
  })
  void pendingQualityReload.then(() => {
    if (generation === qualityChangeGeneration) qualityChanging.value = false
  }, (error: unknown) => {
    if (generation !== qualityChangeGeneration) return
    qualityChanging.value = false
    qualityChangeError.value = error instanceof Error ? error.message : '切换音质或音源失败，请重试。'
  })
  return pendingQualityReload
}

// The player owns this watcher, so settings, backup imports and the playback bar
// all perform exactly one resource transaction without importing player actions.
export const bindQualityReload = (reload: () => Promise<void>): (() => void) => {
  qualityReloadHandler = reload
  const stop = watch([preferredQuality, preferredSource], () => { void reloadPreference().catch(() => {}) }, { flush: 'sync' })
  return () => {
    stop()
    if (qualityReloadHandler === reload) {
      qualityReloadHandler = null
      qualityChangeGeneration++
      qualityChanging.value = false
    }
  }
}

export const setPreferredQuality = async(quality: PlatformQuality): Promise<void> => {
  if (!isPlatformQuality(quality)) throw new Error('请选择有效的播放音质。')
  if (preferredQuality.value === quality) {
    if (qualityChangeError.value) await reloadPreference()
    return
  }
  const setting = { 'player.playQuality': quality }
  await updateSetting(setting)
  mergeSetting(setting)
  await pendingQualityReload
}
export const setPreferredSource = async(source: PreferredPlatformSource): Promise<void> => {
  if (!isPreferredPlatformSource(source)) throw new Error('请选择有效的首选音源。')
  if (preferredSource.value === source) {
    if (qualityChangeError.value) await reloadPreference()
    return
  }
  const setting = { 'player.preferredSource': source }
  await updateSetting(setting)
  mergeSetting(setting)
  await pendingQualityReload
}
export const getPlatformQualitys = async(track: LX.Music.MusicInfoOnline): Promise<PlatformQuality[]> => {
  return ipcRenderer.invoke('platform_playback_qualitys', JSON.parse(JSON.stringify(track)))
}
export const resolvePlatformStream = async(track: LX.Music.MusicInfoOnline, refresh: boolean, allowToggleSource: boolean, quality = preferredQuality.value): Promise<ResolvedPlatformStream> => {
  return ipcRenderer.invoke('platform_playback_resolve', { track: JSON.parse(JSON.stringify(track)), quality, isRefresh: refresh, allowToggleSource })
}
const resolvedStreams = new Map<string, ResolvedPlatformStream>()
const streamKey = (id: string, url: string, quality: PlatformQuality) => `${id}:${quality}:${url}`
export const acceptStream = (track: LX.Music.MusicInfoOnline, stream: ResolvedPlatformStream, requested: PlatformQuality) => {
  if (resolvedStreams.size > 100) resolvedStreams.clear()
  resolvedStreams.set(streamKey(track.id, stream.url, requested), stream)
}
// Only the player resource transaction commits display state. Preloading only caches.
export const commitStream = (track: LX.Music.MusicInfo | LX.Download.ListItem, url: string, requested: PlatformQuality) => {
  if (playMusicInfo.musicInfo?.id !== track.id || preferredQuality.value !== requested) return
  const original = 'metadata' in track ? track.metadata.musicInfo : track
  const local = !/^https?:\/\//i.test(url)
  const stream = local ? null : resolvedStreams.get(streamKey(track.id, url, requested)) ?? resolvedStreams.get(streamKey(original.id, url, requested))
  activePlaybackResource.value = { trackId: track.id, local }
  activeStream.value = stream ? { ...stream, requested, trackId: track.id } : null
}
