// Shuffle each bounded platform pool, then deal one item from each platform.
// This prevents a fast platform or a large result set from crowding out others.
export function randomMix<T extends { source: string }>(items: T[], limit: number, same: (a: T, b: T) => boolean): T[] {
  const shuffle = <V>(values: V[]) => {
    const result = [...values]
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]] }
    return result
  }
  const groups = new Map<string, T[]>()
  for (const item of items) { const group = groups.get(item.source) ?? []; group.push(item); groups.set(item.source, group) }
  const pools = shuffle([...groups.values()].map(shuffle))
  const result: T[] = []
  while (pools.some(pool => pool.length) && result.length < limit) {
    for (const pool of pools) {
      let item: T | undefined
      while ((item = pool.pop()) && result.some(saved => same(item!, saved))) { /* Skip duplicate recordings. */ }
      if (item) result.push(item)
      if (result.length === limit) break
    }
  }
  return result
}


const normalizeRecommendation = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
const normalizeArtist = (value: string) => {
  const name = /[a-z]/i.test(value) && /\p{Script=Han}/u.test(value) ? value.match(/\p{Script=Han}+/gu)!.join('') : value
  return normalizeRecommendation(name)
}
export const recommendationArtists = (track: LX.Music.MusicInfo) => track.singer.split(/[、&,，;；/|]/).map(normalizeArtist).filter(name => name && !['未知歌手', '群星', '华语群星', 'variousartists'].includes(name))
export const recommendationKey = (track: LX.Music.MusicInfo) => `${normalizeRecommendation(track.name)}::${recommendationArtists(track).sort().join('|')}`

/** Exclude recent recordings, keep artists distinct, and reserve 20% unfamiliar artists. */
export function freshRecommendations(items: LX.Music.MusicInfo[], favorites: LX.Music.MusicInfo[], history: string[], size = 9) {
  const blocked = new Set([...history, ...favorites.map(recommendationKey)])
  const familiar = new Set(favorites.flatMap(recommendationArtists))
  const seen = new Set<string>()
  const pool = randomMix(items.filter(track => {
    const key = recommendationKey(track)
    if (!track.name || blocked.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  }), items.length, (a, b) => a === b)
  const candidates = pool.map(track => {
    const names = [...new Set(recommendationArtists(track))]
    return { track, names, unfamiliar: names.every(name => !familiar.has(name)) }
  }).filter(candidate => candidate.names.length).sort((a, b) => a.names.length - b.names.length)
  const outside = candidates.filter(candidate => candidate.unfamiliar)
  const personalized = [...candidates.filter(candidate => !candidate.unfamiliar), ...outside]
  // Try smaller batches if artist overlap makes a full batch impossible. Prefer
  // solo recordings so one collaboration does not consume several artist slots.
  for (let count = Math.min(size, candidates.length, outside.length * 5); count > 0; count--) {
    const selected: LX.Music.MusicInfo[] = []
    const usedArtists = new Set<string>()
    const add = (candidate: typeof candidates[number]) => {
      if (candidate.names.some(name => usedArtists.has(name))) return false
      selected.push(candidate.track)
      for (const name of candidate.names) usedArtists.add(name)
      return true
    }
    const required = Math.ceil(count * 0.2)
    for (const candidate of outside) { add(candidate); if (selected.length === required) break }
    if (selected.length < required) continue
    for (const candidate of personalized) { if (selected.length === count) break; add(candidate) }
    if (selected.length === count) return randomMix(selected, count, (a, b) => a === b)
  }
  return []
}
