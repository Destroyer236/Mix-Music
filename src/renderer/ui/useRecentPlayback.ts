import { shallowRef, watch } from 'vue'
import { isPlay, playMusicInfo } from '@renderer/store/player/state'
import { musicLinksFile, musicLinksError, trackPageUrl } from './useMusicLinks'
import { mergeRecent, type RecentTrack } from './musicLinksFile'
import { LIST_IDS } from '@common/constants'
import { addListMusics } from '@renderer/store/list/action'

export type { RecentTrack } from './musicLinksFile'

// A bounded persistent history; the player's playedList is a random-mode navigation
// stack that gets cleared when changing lists, so it cannot represent history.
export function useRecentPlayback() {
  const tracks = shallowRef<RecentTrack[]>([])
  void musicLinksFile.ready.then(data => { tracks.value = mergeRecent(tracks.value, data.recent) }, () => {})
  watch(() => [isPlay.value, playMusicInfo.musicInfo] as const, async([playing, original]) => {
    const id = original?.id
    if (!playing || !id || !original || !playMusicInfo.listId) return
    const track = 'metadata' in original ? original.metadata.musicInfo : original
    let listId = playMusicInfo.listId
    // Temporary queues can be replaced by the next recommendation or search.
    // Retain played tracks in the audition library for recent playback, while
    // the active queue keeps exactly the selected page's order.
    if (listId === LIST_IDS.TEMP) {
      try { await addListMusics(LIST_IDS.DEFAULT, [track]); listId = LIST_IDS.DEFAULT } catch {
        musicLinksError.value = '这首歌曲的最近播放信息未能保存，请稍后重试。'
        return
      }
    }
    const record = { id: original.id, listId, name: track.name, singer: track.singer, url: trackPageUrl(track) }
    tracks.value = mergeRecent([record], tracks.value)
    void musicLinksFile.recordRecent(record).catch(() => { musicLinksError.value = '最近播放未能保存，请检查项目 data 文件夹的权限。' })
  }, { flush: 'post' })
  return tracks
}
