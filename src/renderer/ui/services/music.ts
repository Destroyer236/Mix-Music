import { LIST_IDS } from '@common/constants'
import { getListMusics, setTempList } from '@renderer/store/list/action'
import { tempListMeta } from '@renderer/store/list/state'
import { isPlay, playInfo, playMusicInfo } from '@renderer/store/player/state'
import { playList, togglePlay } from '@renderer/core/player/action'
import { hasQueueContinuation, setQueueContinuation } from '@renderer/core/player/queueContinuation'
import { startRecommendationPlayback } from './recommendationPlayback'
import type { RecommendationSource } from '../useRecommendations'

let playbackRequest = 0
let pendingQueue: Promise<unknown> = Promise.resolve()
export const sameTrack = (first: LX.Music.MusicInfo | null | undefined, second: LX.Music.MusicInfo | null | undefined) => Boolean(first && second && first.source === second.source && first.id === second.id)

export const playTracks = async(tracks: LX.Music.MusicInfo[], index = 0, listId?: string, recommendationSource?: RecommendationSource) => {
  const track = tracks[index]
  if (!track) throw new Error('没有可播放的歌曲。')
  const request = ++playbackRequest
  setQueueContinuation(null)
  // Serialize queue writes so a slow earlier click cannot replace a newer queue.
  const task = pendingQueue.then(async() => {
    if (request !== playbackRequest) return
    const targetId = listId ?? LIST_IDS.TEMP
    const queueId = recommendationSource ? `recommendations_${request}` : 'ui_playback'
    if (!listId) {
      const unique = [...new Map(tracks.map(item => [`${item.source}:${item.id}`, item])).values()]
      await setTempList(queueId, unique)
    }
    const ready = await getListMusics(targetId)
    if (request !== playbackRequest) return
    const position = ready.findIndex(item => sameTrack(item, track))
    if (position < 0) throw new Error('这首歌曲已不在播放列表中，请重新选择。')
    if (recommendationSource && !listId) startRecommendationPlayback(recommendationSource, queueId)
    playList(targetId, position)
  })
  pendingQueue = task.catch(() => {})
  await task
}

export const playTrack = async(track: LX.Music.MusicInfo, listId?: string) => {
  await playTracks([track], 0, listId)
}

/** The featured card can resume a queue restored before recommendations mounted. */
export const toggleRecommendationPlayback = async(tracks: LX.Music.MusicInfo[], source: RecommendationSource) => {
  if (!playMusicInfo.musicInfo) {
    await playTracks(tracks, 0, undefined, source)
    return
  }
  if (!isPlay.value && playInfo.playerListId === LIST_IDS.TEMP && !playMusicInfo.isTempPlay && !hasQueueContinuation()) {
    // Attach to the existing queue instead of rebuilding it: the card follows
    // the current song even when the visible recommendations have changed.
    startRecommendationPlayback(source, tempListMeta.id)
  }
  togglePlay()
}
