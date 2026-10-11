export type LocalLibraryCategory = 'all' | 'artist' | 'album' | 'folder'

export interface LocalLibraryGroup {
  id: string
  name: string
  subtitle?: string
  trackIds: string[]
}

export type LocalLibraryIndex = Record<Exclude<LocalLibraryCategory, 'all'>, LocalLibraryGroup[]>

const displayText = (text?: string | null) => (text ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
const normalizeText = (text?: string | null) => displayText(text).replace(/\s+/g, '').toLocaleLowerCase()
const compareNames = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

const artistNames = (text: string) => {
  const names = new Map<string, string>()
  // A slash inside a band name (AC/DC) is not a metadata separator.
  for (const value of text.split(/[、,，;；]|\s+\/\s+/)) {
    const name = displayText(value)
    if (name) names.set(normalizeText(name), name)
  }
  return [...names.values()]
}

/** Normalize directory separators and dot segments without merging distinct POSIX directories. */
const directoryInfo = (filePath?: string | null) => {
  const input = (filePath ?? '').trim()
  if (!input || !/[\\/]/.test(input)) return null
  const windows = /^[a-z]:/i.test(input) || input.includes('\\') || input.startsWith('//')
  const separator = windows ? '\\' : '/'
  const path = windows ? input.replace(/\//g, '\\') : input
  const splitAt = path.lastIndexOf(separator)
  const directory = path.slice(0, splitAt)
  const drive = windows ? directory.match(/^[a-z]:/i)?.[0] : undefined
  const unc = windows && directory.startsWith('\\\\')
  const rooted = path.startsWith(separator) || Boolean(drive && path[2] === separator)
  const prefix = drive ? `${drive}${rooted ? separator : ''}` : unc ? '\\\\' : rooted ? separator : ''
  const rawParts = (drive ? directory.slice(2) : directory).split(separator)
  const parts: string[] = []
  for (const part of rawParts) {
    if (!part || part === '.') continue
    // UNC server/share components are roots, so .. cannot remove them.
    if (part === '..' && parts.length > (unc ? 2 : 0) && parts[parts.length - 1] !== '..') parts.pop()
    else if (part !== '..' || !rooted) parts.push(part)
  }
  const fullPath = prefix + parts.join(separator)
  if (!fullPath) return null
  return { name: parts[parts.length - 1] || fullPath, path: fullPath, key: windows ? fullPath.toLocaleLowerCase() : fullPath }
}

/** The index stores IDs rather than additional copies of each track and its metadata. */
export const buildLocalLibraryIndex = (tracks: LX.Music.MusicInfoLocal[]): LocalLibraryIndex => {
  const groups = {
    artist: new Map<string, LocalLibraryGroup>(),
    album: new Map<string, LocalLibraryGroup>(),
    folder: new Map<string, LocalLibraryGroup>(),
  }
  const add = (category: Exclude<LocalLibraryCategory, 'all'>, key: string, name: string, trackId: string, subtitle?: string) => {
    const id = `${category}:${key}`
    let group = groups[category].get(id)
    if (!group) {
      group = { id, name, subtitle, trackIds: [] }
      groups[category].set(id, group)
    }
    group.trackIds.push(trackId)
  }
  const seen = new Set<string>()
  for (const track of tracks) {
    if (seen.has(track.id)) continue
    seen.add(track.id)
    const artists = artistNames(track.singer ?? '')
    if (artists.length) {
      for (const name of artists) add('artist', JSON.stringify(normalizeText(name)), name, track.id)
    } else add('artist', '""', '未知歌手', track.id)
    const album = displayText(track.meta?.albumName)
    const artistKey = artists.map(normalizeText).sort().join('\u0000')
    add('album', JSON.stringify([normalizeText(album), artistKey]), album || '未知专辑', track.id, artists.join(' / ') || '未知歌手')
    const directory = directoryInfo(track.meta?.filePath)
    if (directory) add('folder', JSON.stringify(directory.key), directory.name, track.id, directory.path)
    else add('folder', '""', '未知文件夹', track.id)
  }
  const sorted = (category: Exclude<LocalLibraryCategory, 'all'>) => [...groups[category].values()].sort((left, right) => compareNames.compare(left.name, right.name) || compareNames.compare(left.subtitle ?? '', right.subtitle ?? ''))
  return { artist: sorted('artist'), album: sorted('album'), folder: sorted('folder') }
}

/** Search remains local and matches every query term across tags, filenames and directories. */
export const filterLocalLibraryTracks = (
  tracks: LX.Music.MusicInfoLocal[],
  index: LocalLibraryIndex,
  category: LocalLibraryCategory,
  groupId: string | null | undefined,
  query: string,
): LX.Music.MusicInfoLocal[] => {
  let trackIds: Set<string> | undefined
  if (category !== 'all' && groupId) {
    const group = index[category].find(group => group.id === groupId)
    if (!group) return []
    trackIds = new Set(group.trackIds)
  }
  const terms = displayText(query).split(/\s+/).map(normalizeText).filter(Boolean)
  if (!trackIds && !terms.length) return tracks
  return tracks.filter(track => {
    if (trackIds && !trackIds.has(track.id)) return false
    if (!terms.length) return true
    const fields = [track.name, track.singer, track.meta?.albumName, track.meta?.filePath].map(normalizeText)
    return terms.every(term => fields.some(field => field.includes(term)))
  })
}
