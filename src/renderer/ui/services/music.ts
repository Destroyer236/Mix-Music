import { LIST_IDS } from '@common/constants'
import { getListMusics, setTempList } from '@renderer/store/list/action'
import { playList } from '@renderer/core/player/action'

let playbackRequest = 0
let pendingQueue: Promise<unknown> = Promise.resolve()
export const sameTrack = (first: LX.Music.MusicInfo | null | undefined, second: LX.Music.MusicInfo | null | undefined) => Boolean(first && second && first.source === second.source && first.id === second.id)

export const playTracks = async(tracks: LX.Music.MusicInfo[], index = 0, listId?: string) => {
  const track = tracks[index]
  if (!track) throw new Error('没有可播放的歌曲。')
  const request = ++playbackRequest
  // Serialize queue writes so a slow earlier click cannot replace a newer queue.
  const task = pendingQueue.then(async() => {
    if (request !== playbackRequest) return
    const targetId = listId ?? LIST_IDS.TEMP
    if (!listId) {
      const unique = [...new Map(tracks.map(item => [`${item.source}:${item.id}`, item])).values()]
      await setTempList('ui_playback', unique)
    }
    const ready = await getListMusics(targetId)
    if (request !== playbackRequest) return
    const position = ready.findIndex(item => sameTrack(item, track))
    if (position < 0) throw new Error('这首歌曲已不在播放列表中，请重新选择。')
    playList(targetId, position)
  })
  pendingQueue = task.catch(() => {})
  await task
}

export const playTrack = async(track: LX.Music.MusicInfo, listId?: string) => {
  await playTracks([track], 0, listId)
}
