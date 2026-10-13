/** Name matching only: a platform's broad artist search may include unrelated profiles. */
export interface ArtistResult { source: string, id: string, name: string, img?: string, count?: number }
export interface ArtistGroup<T> { key: string, name: string, entries: T[] }
const normalize = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export function matchArtists<T extends ArtistResult>(entries: T[], query: string): { exact: boolean, groups: Array<ArtistGroup<T>> } {
  const word = normalize(query)
  if (!word) return { exact: false, groups: [] }
  const seen = new Set<string>()
  const valid = entries.filter(item => {
    const key = `${item.source}:${item.id}`
    if (!item.id || !item.name.trim() || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const exact = valid.some(item => normalize(item.name) === word)
  const matching = valid.filter(item => {
    const name = normalize(item.name)
    if (exact) return name === word
    // Match whole query, never individual characters. Latin queries begin at a word boundary.
    if (/^[a-z\d ]+$/.test(word)) return name.split(/[^a-z\d]+/).some((_, index, tokens) => tokens.slice(index).join(' ').startsWith(word))
    return name.includes(word)
  })
  const groups = new Map<string, ArtistGroup<T>>()
  for (const item of matching) {
    const key = normalize(item.name)
    const group = groups.get(key)
    if (group) group.entries.push(item)
    else groups.set(key, { key, name: item.name.trim(), entries: [item] })
  }
  // Prefer a populated catalogue for the initial works preview. Retain every source/ID.
  for (const group of groups.values()) group.entries.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || Number(Boolean(b.img)) - Number(Boolean(a.img)))
  return { exact, groups: [...groups.values()] }
}
