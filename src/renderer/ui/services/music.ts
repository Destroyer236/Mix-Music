import { LIST_IDS } from '@common/constants'
import { watch } from 'vue'
import { getListMusics, setTempList } from '@renderer/store/list/action'
import { allMusicList, tempListMeta } from '@renderer/store/list/state'
import { isPlay, playInfo, playMusicInfo } from '@renderer/store/player/state'
import { playList, togglePlay } from '@renderer/core/player/action'
import { hasQueueContinuation, setQueueContinuation } from '@renderer/core/player/queueContinuation'
import { commitPlaybackIntent, onPlaybackIntent, SESSION_PLAYBACK_QUEUE_PREFIX } from '@renderer/core/player/playbackIntent'
import { startRecommendationPlayback } from './recommendationPlayback'
import type { RecommendationSource } from '../useRecommendations'

let playbackRequest = 0
let pendingQueue: Promise<unknown> = Promise.resolve()
let invalidatePlayback: (() => void) | null = null
let memoryQueueId: string | null = null
let preserveQueueSelection: string | null = null

watch(() => playInfo.playerListId, listId => {
  if (memoryQueueId && listId !== memoryQueueId) {
    allMusicList.delete(memoryQueueId)
    memoryQueueId = null
  }
}, { flush: 'sync' })

onPlaybackIntent(listId => {
  if (listId && listId === preserveQueueSelection) return
  playbackRequest++
  preserveQueueSelection = null
  const invalidate = invalidatePlayback
  invalidatePlayback = null
  invalidate?.()
})

export interface PlaybackRequest {
  isCurrent: () => boolean
  cancel: () => void
}

/** Reserve intent before fetching a queue, so a later click can cancel delivery. */
export const reservePlaybackRequest = (onInvalidated?: () => void): PlaybackRequest => {
  const request = ++playbackRequest
  preserveQueueSelection = null
  const previous = invalidatePlayback
  invalidatePlayback = onInvalidated ?? null
  previous?.()
  return {
    isCurrent: () => request === playbackRequest,
    cancel: () => {
      if (request !== playbackRequest) return
      playbackRequest++
      preserveQueueSelection = null
      const invalidate = invalidatePlayback
      invalidatePlayback = null
      invalidate?.()
    },
  }
}

interface PlaybackOptions {
  request?: PlaybackRequest
  valid?: () => boolean
  queueId?: string
  memoryQueue?: boolean
  beforePlay?: () => void
}

export const sameTrack = (first: LX.Music.MusicInfo | null | undefined, second: LX.Music.MusicInfo | null | undefined) => Boolean(first && second && first.source === second.source && first.id === second.id)

export const playTracks = async(tracks: LX.Music.MusicInfo[], index = 0, listId?: string, recommendationSource?: RecommendationSource, options: PlaybackOptions = {}): Promise<boolean> => {
  const track = tracks[index]
  if (!track) throw new Error('没有可播放的歌曲。')
  const request = options.request ?? reservePlaybackRequest()
  const valid = () => request.isCurrent() && (options.valid?.() ?? true)
  if (!valid()) return false
  setQueueContinuation(null)
  // Serialize queue writes so a slow earlier click cannot replace a newer queue.
  const task = pendingQueue.then(async() => {
    if (!valid()) return false
    const queueId = options.queueId ?? (recommendationSource ? `recommendations_${playbackRequest}` : 'ui_playback')
    const targetId = options.memoryQueue ? queueId : listId ?? LIST_IDS.TEMP
    const unique = [...new Map(tracks.map(item => [`${item.source}:${item.id}`, item])).values()]
    if (!listId && !options.memoryQueue) {
      await commitPlaybackIntent(() => setTempList(queueId, unique))
    }
    const ready = options.memoryQueue ? unique : await getListMusics(targetId)
    if (!valid()) return false
    const position = ready.findIndex(item => sameTrack(item, track))
    if (position < 0) throw new Error('这首歌曲已不在播放列表中，请重新选择。')
    return commitPlaybackIntent(() => {
      options.beforePlay?.()
      if (!valid()) return false
      const previousMemoryQueue = memoryQueueId
      if (options.memoryQueue) {
        allMusicList.set(targetId, ready)
        memoryQueueId = targetId
        preserveQueueSelection = targetId
      }
      if (recommendationSource && !listId) startRecommendationPlayback(recommendationSource, queueId)
      playList(targetId, position)
      if (options.memoryQueue && previousMemoryQueue && previousMemoryQueue !== targetId) allMusicList.delete(previousMemoryQueue)
      return true
    })
  })
  pendingQueue = task.catch(() => {})
  return task
}

export const playTrack = async(track: LX.Music.MusicInfo, listId?: string) => {
  await playTracks([track], 0, listId)
}

/** The featured card can resume a queue restored before recommendations mounted. */
export const toggleRecommendationPlayback = async(tracks: LX.Music.MusicInfo[], source: RecommendationSource) => {
  if (!playMusicInfo.musicInfo || playInfo.playerListId?.startsWith(SESSION_PLAYBACK_QUEUE_PREFIX)) {
    await playTracks(tracks, 0, undefined, source)
    return
  }
  if (!isPlay.value && playInfo.playerListId === LIST_IDS.TEMP && !playMusicInfo.isTempPlay && !hasQueueContinuation()) {
    // Attach to the existing queue instead of rebuilding it: the card follows
    // the current song even when the visible recommendations have changed.
    reservePlaybackRequest()
    startRecommendationPlayback(source, tempListMeta.id)
  }
  togglePlay()
}
