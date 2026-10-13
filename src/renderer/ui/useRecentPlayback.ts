import { shallowRef, watch } from 'vue'
import { isPlay, musicInfo, playMusicInfo } from '@renderer/store/player/state'
import { musicLinksFile, musicLinksError, trackPageUrl } from './useMusicLinks'
import { mergeRecent, type RecentTrack } from './musicLinksFile'

export type { RecentTrack } from './musicLinksFile'

// A bounded persistent history; the player's playedList is a random-mode navigation
// stack that gets cleared when changing lists, so it cannot represent history.
export function useRecentPlayback() {
  const tracks = shallowRef<RecentTrack[]>([])
  void musicLinksFile.ready.then(data => { tracks.value = mergeRecent(tracks.value, data.recent) }, () => {})
  watch(() => [isPlay.value, musicInfo.id] as const, ([playing, id]) => {
    const original = playMusicInfo.musicInfo
    if (!playing || !id || !original || !playMusicInfo.listId) return
    const track = 'metadata' in original ? original.metadata.musicInfo : original
    const record = { id: original.id, listId: playMusicInfo.listId, name: musicInfo.name, singer: musicInfo.singer, url: trackPageUrl(track) }
    tracks.value = mergeRecent([record], tracks.value)
    void musicLinksFile.recordRecent(record).catch(() => { musicLinksError.value = '最近播放未能保存，请检查项目 data 文件夹的权限。' })
  }, { flush: 'post' })
  return tracks
}
