import { SPLIT_CHAR } from './constants'
import { recordingKey } from './platformMatching'

type Track = Pick<LX.Music.MusicInfo, 'name' | 'singer'>

/** Match saved rules across platform formatting, without blocking other songs by the artist. */
export function createDislikeFilter(rules: string) {
  const songs = new Set<string>()
  const titles = new Set<string>()
  const artists = new Set<string>()
  for (const rule of rules.split('\n')) {
    const [name, singer = ''] = rule.split(SPLIT_CHAR.DISLIKE_NAME).map(value => value.trim())
    if (name && singer) songs.add(recordingKey({ name, singer }))
    else if (name) titles.add(recordingKey({ name, singer: '' }))
    else if (singer) artists.add(recordingKey({ name: '', singer }))
  }
  return (track: Track) => songs.has(recordingKey(track)) ||
    titles.has(recordingKey({ name: track.name, singer: '' })) ||
    artists.has(recordingKey({ name: '', singer: track.singer })) ||
    track.singer.split(/\s*[、/&;,，]\s*/).some(singer => artists.has(recordingKey({ name: '', singer })))
}
