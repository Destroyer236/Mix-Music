import type { PlatformPlaylist, PlatformProfile } from '@common/platformAccounts'
import type { PlatformQuality, PlatformStream } from '@common/platformPlayback'
import type { PlatformProvider, ProviderContext } from './types'
import { request, object, text, itemId, mediaUrl, getIdentity, getDevice, toTrack, type Json } from './bodianApi'

export type CatalogKind = 'track' | 'album' | 'artist' | 'playlist'
export interface CatalogEntity { id: string, name: string, cover: string, singer: string, description: string, count: number }
export interface CatalogResult { list: Array<LX.Music.MusicInfoOnline | CatalogEntity>, total: number, totalExact: boolean, page: number, limit: 30, limited: boolean }
export interface PlaylistResult { name: string, cover: string, list: LX.Music.MusicInfoOnline[] }
const tracks = (rows: unknown[]): LX.Music.MusicInfo_online_common[] => rows.map(toTrack).filter((track): track is LX.Music.MusicInfo_online_common => Boolean(track))
const validId = (value: unknown) => { const id = itemId(value); if (!id) throw new Error('无效的波点音乐条目编号'); return id }
const playlistRef = (input: string, fallback = 4) => {
  const match = /^([456]):([1-9]\d*)$/.exec(String(input))
  return { id: validId(match?.[2] ?? input), source: match ? Number(match[1]) : fallback }
}
const playlistKey = (item: Json, fallback: number) => `${[4, 5, 6].includes(Number(item.sourceType ?? item.source)) ? Number(item.sourceType ?? item.source) : fallback}:${validId(item.id)}`
async function allPages(context: ProviderContext, endpoint: string, field: string, query: Json, firstPage = 1): Promise<Json[]> {
  const result: Json[] = []
  const seen = new Set<string>()
  for (let index = 0; index < 5000; index++) {
    const data = await request(context, endpoint, { query: { ...query, pn: index + firstPage, rn: 100 } })
    // The collection endpoint represents a genuinely empty collection as {}.
    if (endpoint === '/api/service/collect/4/list' && !Object.keys(data).length) return result
    const rows = data[field]
    if (!Array.isArray(rows)) throw new Error('波点音乐未返回完整列表，请重新同步')
    const signature = rows.map(row => String(object(row).id ?? object(row).musicId ?? '')).join(',')
    if (rows.length && seen.has(signature)) throw new Error('波点音乐列表分页重复，请重新同步')
    seen.add(signature)
    result.push(...rows.map(object))
    const total = Number(data.total)
    const knownTotal = data.total != null && Number.isFinite(total) && total >= 0
    if (knownTotal ? (index + 1) * 100 >= total : !rows.length) return result
    if (!rows.length) throw new Error('波点音乐列表分页不完整，请重新同步')
  }
  throw new Error('波点音乐列表分页异常，请稍后重试')
}
export async function searchCatalog(context: ProviderContext, query: string, kind: CatalogKind, page = 1): Promise<CatalogResult> {
  const path = { track: 'music', album: 'album', artist: 'artist', playlist: 'playlist' }[kind]
  if (!path) throw new Error('不支持的波点音乐搜索类型')
  query = text(query).slice(0, 200)
  page = Math.max(1, Math.min(1000, Math.floor(Number(page) || 1)))
  if (!query) return { list: [], total: 0, totalExact: true, page, limit: 30, limited: false }
  const data = await request(context, `/api/search/${path}/list`, { query: { keyword: query, pn: page - 1, rn: 30, correct: 1 } })
  if (!Array.isArray(data.resultList)) throw new Error('波点音乐未返回搜索结果')
  const list = kind === 'track' ? tracks(data.resultList) : data.resultList.flatMap((value: unknown) => {
    const item = object(value)
    const id = itemId(item.id ?? item.albumId ?? item.artistId)
    if (!id) return []
    return [{ id: kind === 'playlist' ? playlistKey({ ...item, id }, 4) : id, name: text(item.name), cover: mediaUrl(item.pic), singer: text(item.artist ?? item.creator_name), description: text(item.info ?? item.description), count: Math.max(0, Number(item.musicnum ?? item.musicCount ?? item.songNum) || 0) }]
  })
  // Music search reports this page's size as `total`, even when later pages exist.
  const lowerBoundWithoutSentinel = (page - 1) * 30 + data.resultList.length
  const lowerBound = lowerBoundWithoutSentinel + (data.resultList.length === 30 ? 1 : 0)
  return { list, total: Math.max(lowerBound, Number(data.total) || 0), totalExact: Number(data.total) > lowerBoundWithoutSentinel, page, limit: 30, limited: false }
}
export async function publicPlaylist(context: ProviderContext, input: string): Promise<PlaylistResult> {
  const { id, source } = playlistRef(input)
  const detail = await request(context, `/api/service/playlist/info/${id}`, { query: { source } })
  if (itemId(detail.id) !== id) throw new Error('波点音乐歌单编号不一致')
  const rows = await allPages(context, `/api/service/playlist/${id}/musicList`, 'list', { source })
  return { name: text(detail.name) || '波点音乐歌单', cover: mediaUrl(detail.pic), list: tracks(rows) }
}
export async function getAlbumTracks(context: ProviderContext, input: string): Promise<PlaylistResult> {
  const id = validId(input)
  const detail = object((await request(context, `/api/service/album/${id}`)).albumInfo)
  if (itemId(detail.id ?? detail.albumId) !== id) throw new Error('波点音乐专辑编号不一致')
  return { name: text(detail.name) || '波点音乐专辑', cover: mediaUrl(detail.pic), list: tracks(await allPages(context, `/api/service/album/music/${id}`, 'resultList', {}, 0)) }
}
export async function getArtistTracks(context: ProviderContext, input: string): Promise<PlaylistResult> {
  const id = validId(input)
  const detail = object((await request(context, `/api/service/artist/${id}`)).artistInfo)
  if (itemId(detail.id ?? detail.artistId) !== id) throw new Error('波点音乐歌手编号不一致')
  return { name: text(detail.name) || '波点音乐歌手', cover: mediaUrl(detail.pic), list: tracks(await allPages(context, `/api/service/artist/music/${id}`, 'resultList', {}, 0)) }
}
export async function getLyrics(context: ProviderContext, input: string): Promise<LX.Music.LyricInfo> {
  const id = validId(input)
  const q = Buffer.from(`type=lyric&req=2&lrcx=1&rid=${id}&songname=&artist=&corp=kuwo&fromchannel=bodian`).toString('base64')
  const data = await request(context, '/mobi.s', { query: { f: 'bodian', q }, lyric: true })
  if (typeof data.content !== 'string' || data.content.length > 2_000_000) throw new Error('波点音乐暂无此歌曲歌词')
  const raw = Buffer.from(data.content, 'base64').toString('utf8')
  // Keep standard timed lyrics; proprietary word offsets must not appear in the lyric text.
  const lyric = raw.replace(/<-?\d+,-?\d+>/g, '').split(/\r?\n/).filter(line => !/^\[(?:kuwo|ml|ver):/.test(line)).join('\n')
  return { lyric, tlyric: '', rlyric: '', lxlyric: '' }
}
export async function resolveShare(_context: ProviderContext, input: string): Promise<{ kind: 'track' | 'playlist' | 'album', id: string }> {
  const raw = text(input)
  if (/^(?:[45]:)?[1-9]\d*$/.test(raw)) { const { id, source } = playlistRef(raw); return { kind: 'playlist', id: `${source}:${id}` } }
  const match = raw.match(/https?:\/\/[^\s<>"“”]+/i)
  let url: URL
  try { url = new URL(match?.[0].replace(/[，。；！）)]+$/, '') ?? '') } catch { throw new Error('请粘贴波点音乐官方歌单分享链接或歌单 ID') }
  if (!['https:', 'http:'].includes(url.protocol) || !['h5app.kuwo.cn', 'bodian-oia.kuwo.cn'].includes(url.hostname) || url.username || url.password || url.port || !url.pathname.includes('/bodian/')) throw new Error('仅支持波点音乐官方分享链接')
  const playlist = itemId(url.searchParams.get('playlistId'))
  if (playlist) {
    const source = Number(url.searchParams.get('source') ?? 4)
    if (![4, 5].includes(source)) throw new Error('不支持此波点音乐歌单类型')
    return { kind: 'playlist', id: `${source}:${playlist}` }
  }
  const track = itemId(url.searchParams.get('musicId'))
  if (track) return { kind: 'track', id: track }
  throw new Error('此波点音乐分享链接缺少歌单或歌曲编号')
}
async function verifyProfile(context: ProviderContext, profile: PlatformProfile) {
  const current = await getIdentity(context)
  if (current.id !== profile.id) throw new Error('波点音乐账号已变化，请重新同步后操作')
  return current
}
async function fond(context: ProviderContext, profile: PlatformProfile): Promise<Json> {
  await verifyProfile(context, profile)
  const result = await request(context, '/api/service/playlist/fond', { query: { userId: profile.id, fromUid: profile.id } })
  if (!itemId(result.id)) throw new Error('波点音乐未返回红心歌单，请在官方客户端确认后重新同步')
  return result
}
const qualityFormats = { '128k': { format: 'mp3', br: '128kmp3' }, '320k': { format: 'mp3', br: '320kmp3' }, flac: { format: 'flac', br: '2000kflac' } }
const rights = async(context: ProviderContext, id: string) => request(context, '/api/play/music/v2/checkRight', { query: { musicId: id, freeSign: '' }, body: { musicId: Number(id), freeSign: '' }, signed: true })
export const bodianProvider: PlatformProvider = {
  id: 'bodian',
  source: 'bo',
  name: '波点音乐',
  loginUrl: 'https://bodian.kuwo.cn/',
  cookieUrl: 'https://bd-api.kuwo.cn/',
  domains: ['kuwo.cn'],
  syncSupported: true,
  notice: '使用波点音乐 App 扫码登录，可同步红心与歌单。播放音质与完整歌曲权限以当前波点账号为准。',
  authenticated: cookies => Boolean(itemId(cookies.linkline_bodian_uid) && cookies.linkline_bodian_token),
  async profile(context) {
    const saved = await getIdentity(context)
    // Unlike users/pub and fond, userCreate rejects invalid credentials (-101).
    await request(context, '/api/service/playlist/userCreate', { query: { userId: saved.id }, expectedUser: saved.id })
    return { id: saved.id, nickname: saved.nickname, avatar: saved.avatar }
  },
  async likes(context, profile) {
    const liked = await fond(context, profile)
    return tracks(await allPages(context, `/api/service/playlist/${validId(liked.id)}/musicList`, 'list', { source: 5 }))
  },
  async playlists(context, profile) {
    await verifyProfile(context, profile)
    const query = { userId: profile.id, fromUid: profile.id }
    const owned = await request(context, '/api/service/playlist/userCreate', { query })
    if (!Array.isArray(owned.playLists) && Object.keys(owned).length) throw new Error('波点音乐未返回自建歌单，请重新同步')
    const collected = await allPages(context, '/api/service/collect/4/list', 'playLists', query)
    const result = new Map<string, PlatformPlaylist>()
    for (const [entries, fallback] of [[owned.playLists ?? [], 5], [collected, 4]] as const) {
      for (const value of entries) {
        const item = object(value)
        if (!itemId(item.id) || Number(item.sourceType) === 6 || Number(item.isFond) === 1) continue
        const remoteId = playlistKey(item, fallback)
        result.set(remoteId, { id: `bodian:${remoteId}`, platform: 'bodian', ownerId: profile.id, remoteId, name: text(item.name) || '波点音乐歌单', cover: mediaUrl(item.pic), count: Math.max(0, Number(item.musicCount) || 0), loaded: false, lastSync: null })
      }
    }
    return [...result.values()]
  },
  async playlistTracks(context, profile, playlist) {
    await verifyProfile(context, profile)
    if (playlist.platform !== 'bodian' || playlist.ownerId !== profile.id) throw new Error('歌单不属于当前波点音乐账号，请重新同步')
    return (await publicPlaylist(context, playlist.remoteId)).list
  },
  async search(context, track) { return (await searchCatalog(context, `${track.name} ${track.singer}`, 'track')).list as LX.Music.MusicInfoOnline[] },
  async available(context, track) {
    if (track.source !== 'bo') return false
    const info = await rights(context, validId(track.meta.songId))
    return [1, 3].includes(Number(info.status))
  },
  async musicQualitys(context, track) {
    const raw = await request(context, '/api/service/music/info', { query: { musicId: validId(track.meta.songId) } })
    const parsed = toTrack(raw)
    if (!parsed) throw new Error('波点音乐未返回歌曲音质信息')
    return parsed.meta.qualitys.map(item => item.type)
  },
  async musicUrl(context, track, quality): Promise<PlatformStream> {
    if (track.source !== 'bo') throw new Error('此记录不是波点音乐歌曲')
    const id = validId(track.meta.songId)
    const right = await rights(context, id)
    if (Number(right.status) === 3) {
      const preview = object(right.audition)
      const url = mediaUrl(preview.https ?? preview.url)
      if (!url || !(Number(preview.end) > Number(preview.start))) throw new Error('波点音乐当前账号暂无此歌曲的试听权限')
      return { url, type: '128k', quality: '128k', isTrial: true, expires: 300 }
    }
    if (Number(right.status) !== 1) throw new Error('波点音乐当前账号暂无此歌曲的完整播放权限')
    const ranks: Partial<Record<PlatformQuality, number>> = { '64k': 0, '128k': 1, '192k': 1, '320k': 2, flac: 3 }
    const maximum = quality === 'auto' ? 3 : ranks[quality] ?? 3
    const levels = (['flac', '320k', '128k'] as const).filter(level => (ranks[level] ?? 0) <= Math.max(1, maximum))
    for (const level of levels) {
      try {
        const body = { devId: await getDevice(context), musicId: Number(id), ...qualityFormats[level], freeSign: '' }
        const data = await request(context, '/api/play/music/v2/audioUrl', { query: { ...body, musicId: id }, body, signed: true })
        const url = mediaUrl(data.audioHttpsUrl ?? data.audioUrl)
        if (!url) continue
        const format = text(data.format).toLowerCase()
        const bitrate = Number(data.bitrate)
        // The platform can silently downgrade a FLAC request to MP3.
        const actual = format === 'flac' ? 'flac' : format === 'mp3' && bitrate > 0 ? bitrate >= 300 ? '320k' : '128k' : null
        if (!actual) throw new Error('波点音乐返回了暂不支持的音频格式')
        return { url, type: actual, quality: actual, bitrate: bitrate > 0 ? bitrate * 1000 : undefined, expires: 300 }
      } catch (error) {
        if (level === levels[levels.length - 1] || (error instanceof Error && /登录|大陆/.test(error.message))) throw error
      }
    }
    throw new Error('波点音乐未返回当前账号可用的播放地址')
  },
  async like(context, profile, track, liked) {
    if (track.source !== 'bo') throw new Error('此记录不是波点音乐歌曲')
    const id = validId(track.meta.songId)
    const target = await fond(context, profile)
    await verifyProfile(context, profile)
    await request(context, `/api/service/playlist/music${liked ? '' : '/delete'}`, { body: { playListId: Number(validId(target.id)), musicIdList: [Number(id)] }, signed: true, expectedUser: profile.id })
    await verifyProfile(context, profile)
    const confirmed = await allPages(context, `/api/service/playlist/${validId(target.id)}/musicList`, 'list', { source: 5 })
    if (confirmed.some(item => itemId(item.id ?? item.musicId) === id) !== liked) throw new Error('波点音乐尚未确认红心更改，请重新同步后重试')
  },
}
export default bodianProvider
