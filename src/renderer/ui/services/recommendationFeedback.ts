import { ref } from 'vue'
import { addDislikeInfo } from '@renderer/core/dislikeList'
import { playNext } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { showPlayerNotice } from './playerNotice'

export const reducingRecommendations = ref(false)

export async function reduceTrackRecommendations(track: LX.Music.MusicInfo) {
  if (reducingRecommendations.value) return
  const playing = playMusicInfo.musicInfo
  const current = playing && ('metadata' in playing ? playing.metadata.musicInfo : playing)
  const skip = current?.source === track.source && current.id === track.id
  reducingRecommendations.value = true
  try {
    await addDislikeInfo([{ name: track.name, singer: track.singer }])
    showPlayerNotice('已减少推荐')
    // Saving may take time. A user who already changed songs keeps that song.
    if (skip && playMusicInfo.musicInfo === playing) {
      try { await playNext() } catch { showPlayerNotice('已减少推荐，暂时无法播放下一首') }
    }
  } finally { reducingRecommendations.value = false }
}
