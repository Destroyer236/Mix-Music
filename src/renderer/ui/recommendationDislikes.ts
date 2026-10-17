import { computed } from 'vue'
import { SPLIT_CHAR } from '@common/constants'
import { dislikeInfo, dislikeRulesVersion } from '@renderer/store/dislikeList'
import { normalizeRecommendationArtist, recommendationArtists, recommendationKey } from './recommendationMix'

type Track = Pick<LX.Music.MusicInfo, 'name' | 'singer'>

/** Share song identities across platforms without blocking an entire artist. */
export function createRecommendationDislikeFilter(rules: string) {
  const songs = new Set<string>()
  const titles = new Set<string>()
  const artists = new Set<string>()
  for (const rule of rules.split('\n')) {
    const [name, singer] = rule.split(SPLIT_CHAR.DISLIKE_NAME).map(value => value.trim())
    if (name && singer) songs.add(recommendationKey({ name, singer }))
    else if (name) titles.add(recommendationKey({ name, singer: '' }))
    else if (singer) artists.add(normalizeRecommendationArtist(singer))
  }
  return (track: Track) => songs.has(recommendationKey(track)) || titles.has(recommendationKey({ name: track.name, singer: '' })) || artists.has(normalizeRecommendationArtist(track.singer)) || recommendationArtists(track).some(artist => artists.has(artist))
}

const filter = computed(() => {
  void dislikeRulesVersion.value
  return createRecommendationDislikeFilter(dislikeInfo.rules)
})
export const isRecommendationDisliked = (track: Track) => filter.value(track)
