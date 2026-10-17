import { ref, watch } from 'vue'
import { LIST_IDS } from '@common/constants'
import { samePlayTrack } from '@common/platformMatching'
import { allMusicList } from '@renderer/store/list/state'
import { getListMusics } from '@renderer/store/list/action'
import { getDownloadList } from '@renderer/store/download/action'
import { playInfo, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { addPlayedList, clearPlayedList, clearTempPlayeList, getList, removeTempPlayList, setPlayListId } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { detachCurrentQueueTrack, playList, playNext, resetRandomNextMusicInfo } from '@renderer/core/player/action'
import { notifyPlaybackIntent, SESSION_PLAYBACK_QUEUE_PREFIX } from '@renderer/core/player/playbackIntent'
import { setQueueContinuation } from '@renderer/core/player/queueContinuation'

export type PlaybackQueueTrack = LX.Music.MusicInfo | LX.Download.ListItem
export const playbackQueueRevision = ref(0)

// The player already accepts both music and downloaded-file entries from its cache.
const queueCache = allMusicList as Map<string, PlaybackQueueTrack[]>
let editableQueueId: string | null = null
let queueSequence = 0

watch(() => playInfo.playerListId, listId => {
  if (!editableQueueId || listId === editableQueueId) return
  queueCache.delete(editableQueueId)
  editableQueueId = null
}, { flush: 'sync' })

export function queueTrackInfo(track: PlaybackQueueTrack): LX.Music.MusicInfo {
  return 'progress' in track ? track.metadata.musicInfo : track
}

export async function readPlaybackQueue(): Promise<{ listId: string | null, tracks: PlaybackQueueTrack[] }> {
  const listId = playInfo.playerListId
  const tracks = !listId ? [] : listId === LIST_IDS.DOWNLOAD ? await getDownloadList() : await getListMusics(listId)
  return { listId, tracks: [...tracks] }
}

/** Edit only a private session copy; never mutate the original library or reload audio. */
function commitQueueEdit(tracks: PlaybackQueueTrack[], anchor: number): void {
  const current = playMusicInfo.musicInfo
  const wasTemporary = playMusicInfo.isTempPlay
  const currentIndex = current && !wasTemporary ? tracks.findIndex(track => samePlayTrack(track, current)) : -1
  const targetId = editableQueueId ?? `${SESSION_PLAYBACK_QUEUE_PREFIX}editor_${++queueSequence}`
  queueCache.set(targetId, tracks)
  editableQueueId = targetId
  notifyPlaybackIntent()
  setQueueContinuation(null)
  resetRandomNextMusicInfo()
  clearPlayedList()
  setPlayListId(targetId)
  if (current && !wasTemporary) {
    playMusicInfo.listId = targetId
    // A removed playing song finishes as detached playback, just like Play Later.
    playMusicInfo.isTempPlay = currentIndex < 0
    if (currentIndex < 0) detachCurrentQueueTrack()
  }
  playInfo.playIndex = currentIndex
  playInfo.playerPlayIndex = currentIndex >= 0 ? currentIndex : Math.min(anchor, tracks.length - 1)
  if (currentIndex >= 0 && appSetting['player.togglePlayMethod'] === 'random') addPlayedList({ ...(playMusicInfo as LX.Player.PlayMusicInfo) })
  playbackQueueRevision.value++
  // Notify existing queue views only when their list watcher can keep this song.
  // Removed current songs must finish naturally instead of triggering auto-next.
  if (currentIndex >= 0) window.app_event.myListUpdate([targetId])
}

export function removePlaybackQueueTrack(expectedListId: string | null, track: PlaybackQueueTrack): boolean {
  if (!expectedListId || playInfo.playerListId !== expectedListId) return false
  const tracks = [...getList(expectedListId)]
  const index = tracks.findIndex(item => samePlayTrack(item, track))
  if (index < 0) return false
  const previousAnchor = playInfo.playerPlayIndex
  tracks.splice(index, 1)
  commitQueueEdit(tracks, previousAnchor - (index <= previousAnchor ? 1 : 0))
  return true
}

export function clearPlaybackQueue(expectedListId: string | null): boolean {
  if (playInfo.playerListId !== expectedListId) return false
  if (expectedListId) commitQueueEdit([], -1)
  clearTempPlayeList()
  playbackQueueRevision.value++
  return true
}

export function playPlaybackQueueTrack(expectedListId: string | null, track: PlaybackQueueTrack): boolean {
  if (!expectedListId || playInfo.playerListId !== expectedListId) return false
  const index = getList(expectedListId).findIndex(item => samePlayTrack(item, track))
  if (index < 0) return false
  // Core playList intentionally clears Play Later for a new list. A queue click
  // stays in this list, so retain those scheduled tracks around that operation.
  const later = [...tempPlayList]
  playList(expectedListId, index)
  tempPlayList.push(...later)
  return true
}

export function playLaterQueueTrack(index: number): boolean {
  const item = tempPlayList[index]
  if (!item) return false
  notifyPlaybackIntent()
  resetRandomNextMusicInfo()
  removeTempPlayList(index)
  tempPlayList.unshift(item)
  void playNext()
  return true
}
