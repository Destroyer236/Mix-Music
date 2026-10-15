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
// Only explicit aliases are merged. Keeping Latin suffixes avoids conflating
// distinct artists such as “阿鸣 A” and “阿鸣 B”.
const artistAliases: Record<string, string> = {
  easonchan: '陈奕迅',
  jaychou: '周杰伦',
  tanyachua: '蔡健雅',
  leehomwang: '王力宏',
  wangleehom: '王力宏',
  stefaniesun: '孙燕姿',
  jjlin: '林俊杰',
  jolintsai: '蔡依林',
}
export const normalizeRecommendationArtist = (value: string) => {
  const name = value.normalize('NFKC').trim()
  const bilingual = name.match(/^([\p{Script=Han}\s·]+)\s*\([a-z\s.]+\)$/iu)
  const key = normalizeRecommendation(bilingual?.[1] ?? name)
  return artistAliases[key] ?? key
}
export const recommendationArtistNames = (singer: string) => singer.split(/[、&,，;；/|]/).map(name => name.trim()).filter(name => name && !['未知歌手', '群星', '华语群星', 'variousartists'].includes(normalizeRecommendationArtist(name)))
export const recommendationArtists = (track: Pick<LX.Music.MusicInfo, 'singer'>) => [...new Set(recommendationArtistNames(track.singer).map(normalizeRecommendationArtist))]
const edition = /^(?:live(?:\s.*)?|remaster(?:ed)?(?:\s.*)?|\d{4}\s*remaster(?:ed)?|现场(?:版)?|演唱会(?:版)?|重制(?:版)?|重录(?:版)?|原唱(?:版)?|录音室(?:版)?)$/i
const workName = (name: string) => {
  const title = name.normalize('NFKC').replace(/\(([^()]*)\)|【([^【】]*)】|\[([^\]]*)\]/g, (full, a, b, c) => edition.test(String(a ?? b ?? c).trim()) ? '' : full).trim()
  return normalizeRecommendation(title || name)
}
export const recommendationKey = (track: Pick<LX.Music.MusicInfo, 'name' | 'singer'>) => `${workName(track.name)}::${recommendationArtists(track).sort().join('|')}`
export function canonicalHistoryKey(key: string) {
  const [name, artists] = key.split('::')
  if (artists === undefined) return key
  // Legacy keys lost their brackets; only migrate unmistakable edition suffixes.
  const title = /\p{Script=Han}/u.test(name) ? name.replace(/(?:live|remastered|现场版|演唱会版|重制版|重录版)$/, '') || name : name
  return `${title}::${[...new Set(artists.split('|').map(normalizeRecommendationArtist))].sort().join('|')}`
}

export function recommendationPreferences(favorites: LX.Music.MusicInfo[], recent: Array<Pick<LX.Music.MusicInfo, 'singer'>>) {
  const artists = new Map<string, { name: string, weight: number }>()
  const albums = new Set(favorites.map(track => normalizeRecommendation(track.meta.albumName ?? '')).filter(Boolean))
  const add = (singer: string, weight: number) => {
    for (const name of recommendationArtistNames(singer)) {
      const key = normalizeRecommendationArtist(name)
      const item = artists.get(key) ?? { name, weight: 0 }
      item.weight += weight
      artists.set(key, item)
    }
  }
  // Favorites are newest first. Include the whole library, with a small recency bonus.
  favorites.forEach((track, index) => { add(track.singer, 1 + 1 / (1 + index / 100)) })
  recent.slice(0, 100).forEach((track, index) => { add(track.singer, 2 / (1 + index / 20)) })
  const ranked = [...artists.entries()].sort((a, b) => b[1].weight - a[1].weight)
  const maximum = ranked[0]?.[1].weight || 1
  return {
    seeds: ranked.slice(0, 24).map(([, item]) => item.name),
    score: (track: LX.Music.MusicInfo) => Math.max(0, ...recommendationArtists(track).map(name => (artists.get(name)?.weight ?? 0) / maximum)) * 4 + (albums.has(normalizeRecommendation(track.meta.albumName ?? '')) ? 1 : 0),
  }
}

/** Exclude recent recordings, keep artists distinct, and reserve 20% unfamiliar artists. */
export function freshRecommendations(items: LX.Music.MusicInfo[], favorites: LX.Music.MusicInfo[], history: string[], size = 9, score: (track: LX.Music.MusicInfo) => number = () => 0) {
  const blocked = new Set([...history.map(canonicalHistoryKey), ...favorites.map(recommendationKey)])
  const familiar = new Set(favorites.flatMap(recommendationArtists))
  const seen = new Set<string>()
  const pool = randomMix(items, items.length, (a, b) => a === b).filter(track => {
    const key = recommendationKey(track)
    if (!track.name || blocked.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const candidates = pool.map(track => {
    const names = [...new Set(recommendationArtists(track))]
    return { track, names, unfamiliar: names.every(name => !familiar.has(name)), score: score(track) + Math.random() * 0.5 }
  }).filter(candidate => candidate.names.length).sort((a, b) => b.score - a.score || a.names.length - b.names.length)
  const outside = candidates.filter(candidate => candidate.unfamiliar)
  const personalized = candidates
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
