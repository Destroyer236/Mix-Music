import { ref } from 'vue'
import { SPLIT_CHAR } from '@common/constants'
import { addDislikeInfo } from '@renderer/core/dislikeList'
import { playNext } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { showPlayerNotice } from './playerNotice'

export const reducingRecommendations = ref(false)

export async function reduceTrackRecommendations(track: LX.Music.MusicInfo, notify = showPlayerNotice) {
  if (reducingRecommendations.value) return
  const playing = playMusicInfo.musicInfo
  const current = playing && ('metadata' in playing ? playing.metadata.musicInfo : playing)
  const skip = current?.source === track.source && current.id === track.id
  reducingRecommendations.value = true
  try {
    const escape = (text: string) => text.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS)
    await addDislikeInfo([{ name: escape(track.name), singer: escape(track.singer) }])
    notify('已减少推荐')
    // Keep a newer song selected by the user while persistence was pending.
    if (skip && playMusicInfo.musicInfo === playing) {
      try { await playNext() } catch { notify('已减少推荐，暂时无法播放下一首') }
    }
  } finally { reducingRecommendations.value = false }
}
