import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { pathToFileURL } from 'node:url'
import musicSdk from '@renderer/utils/musicSdk'
import { toOldMusicInfo } from '@renderer/utils'
import { getListMusics } from '@renderer/store/list/action'
import { loveList } from '@renderer/store/list/state'
import { favoriteTracks, initializePlatformAccounts } from './services/platformAccounts'
import { MusicLinksFile, musicLinksFilename } from './musicLinksFile'

export const musicLinksError = ref('')
export const musicLinksFile = new MusicLinksFile(musicLinksFilename())
const failed = () => { musicLinksError.value = '音乐链接文件暂时无法读写，请检查项目 data 文件夹的权限。原有音乐库仍可使用。' }
void musicLinksFile.ready.catch(failed)
export function trackPageUrl(track: LX.Music.MusicInfo): string {
  if (track.source === 'local') return track.meta.filePath ? pathToFileURL(track.meta.filePath).href : ''
  try {
    const url: unknown = musicSdk[track.source]?.getMusicDetailPageUrl?.(toOldMusicInfo(track))
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : ''
  } catch { return '' }
}
export function useFavoriteLinks() {
  let initialized = false
  let disposed = false
  let lastLinks = ''
  const save = (links: string[]) => { void musicLinksFile.setFavorites(links).then(() => { musicLinksError.value = '' }, failed) }
  watch(favoriteTracks, tracks => {
    if (!initialized) return
    const links = tracks.map(trackPageUrl).filter(Boolean)
    const signature = JSON.stringify(links)
    if (signature === lastLinks) return
    lastLinks = signature
    save(links)
  })
  onBeforeUnmount(() => { disposed = true })
  onMounted(async() => {
    try {
      await initializePlatformAccounts()
      // Initialization absorbs DB failures; an independent successful read is
      // required before a startup mirror is allowed to replace a user's file.
      const [tracks, saved] = await Promise.all([getListMusics(loveList.id), musicLinksFile.ready])
      if (disposed) return
      const links = tracks.map(trackPageUrl).filter(Boolean)
      lastLinks = JSON.stringify(links)
      initialized = true
      // An empty or newly created library must not erase a previous backup.
      // A subsequent actual favorite change (including removing the last one)
      // is still mirrored normally.
      if (links.length || !saved.favorites.length) save(links)
    } catch { failed() }
  })
}
