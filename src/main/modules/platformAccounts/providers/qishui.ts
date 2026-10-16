import { randomUUID } from 'node:crypto'
import type { PlatformPlaylist, PlatformProfile } from '@common/platformAccounts'
import type { PlatformProvider, ProviderContext } from './types'
import { request, object, itemId, text, imageUrl, toTrack, officialHosts, shareAudio, sharePage, trueFlag, toLyrics, probeAudio, type Json } from './qishuiApi'

export type CatalogKind = 'track' | 'album' | 'artist' | 'playlist'
export interface CatalogEntity { id: string, name: string, cover: string, singer: string, description: string, count: number }
export interface CatalogResult { list: Array<LX.Music.MusicInfoOnline | CatalogEntity>, total: number, page: number, limit: 30, limited: boolean }
export interface PlaylistResult { name: string, cover: string, list: LX.Music.MusicInfoOnline[] }

async function myPlaylists(context: ProviderContext): Promise<Json[]> {
  const result = new Map<string, Json>()
  const seen = new Set<string>()
  let cursor = ''
  for (let page = 0; page < 5000; page++) {
    const body = await request(context, '/luna/pc/me/playlist', { cursor, count: 100 })
    if (!Array.isArray(body.playlists)) {
      if (Number(body.total_num) === 0 && !body.has_more) return []
      throw new Error('汽水音乐未返回账号歌单，请重新登录后同步')
    }
    for (const entry of body.playlists) {
      const item = object(entry)
      const id = itemId(item.id)
      if (id) result.set(id, item)
    }
    if (!body.has_more) return [...result.values()]
    const next = String(body.next_cursor ?? '')
    if (!next || next === cursor || seen.has(next) || !body.playlists.length) throw new Error('汽水音乐歌单分页不完整，请重新同步')
    seen.add(next)
    cursor = next
  }
  throw new Error('汽水音乐歌单分页异常，请稍后重试')
}

export async function publicPlaylist(context: ProviderContext, id: string): Promise<PlaylistResult> {
  if (!itemId(id)) throw new Error('无效的汽水音乐歌单编号')
  const result = new Map<string, LX.Music.MusicInfoOnline>()
  const seen = new Set<string>()
  let cursor = ''
  let session = ''
  let name = ''
  let cover = ''
  for (let page = 0; page < 5000; page++) {
    const body = await request(context, '/luna/pc/playlist/detail', { playlist_id: id, cursor, count: 100, session_id: session, reverse: false, ab_param: '' })
    const playlist = object(body.playlist)
    if (playlist.id != null && itemId(playlist.id) !== id) throw new Error('汽水音乐歌单编号不一致')
    name = text(playlist.title ?? playlist.name) || name
    cover = imageUrl(playlist.url_cover) || cover
    const entries = Array.isArray(body.media_resources) ? body.media_resources : body.tracks
    if (!Array.isArray(entries)) {
      if (Number(playlist.count_tracks) === 0 && !body.has_more) return { name: name || '汽水音乐歌单', cover, list: [] }
      throw new Error('汽水音乐未返回歌单歌曲')
    }
    for (const entry of entries) {
      const track = toTrack(entry)
      if (track) result.set(track.id, track)
    }
    if (!body.has_more) return { name: name || '汽水音乐歌单', cover, list: [...result.values()] }
    const next = String(body.next_cursor ?? '')
    if (!next || next === cursor || seen.has(next) || !entries.length) throw new Error('汽水音乐歌单内容分页不完整，请重试')
    seen.add(next)
    cursor = next
    session = String(body.session_id ?? session)
  }
  throw new Error('汽水音乐歌单内容分页异常，请稍后重试')
}

export async function getAlbumTracks(context: ProviderContext, id: string): Promise<PlaylistResult> {
  if (!itemId(id)) throw new Error('无效的汽水音乐专辑编号')
  const body = await request(context, `/luna/pc/albums/${id}`, { ignore_tracks: false })
  const album = object(body.album_info ?? body.album)
  if (itemId(album.id) !== id || !Array.isArray(body.tracks)) throw new Error('汽水音乐未返回可用的专辑歌曲')
  return { name: text(album.name) || '汽水音乐专辑', cover: imageUrl(album.url_cover), list: body.tracks.map((entry: unknown) => toTrack(entry)).filter((track: LX.Music.MusicInfo_online_common | null): track is LX.Music.MusicInfo_online_common => Boolean(track)) }
}

export async function getArtistTracks(context: ProviderContext, id: string): Promise<PlaylistResult> {
  if (!itemId(id)) throw new Error('无效的汽水音乐歌手编号')
  const detail = await request(context, `/luna/pc/artists/${id}`, { locate_item_id: '' })
  const artist = object(detail.artist_info ?? detail.artist)
  if (itemId(artist.id) !== id) throw new Error('汽水音乐暂未提供此歌手的作品列表')
  const list = new Map<string, LX.Music.MusicInfoOnline>()
  const seen = new Set<string>()
  let cursor = ''
  for (let page = 0; page < 5000; page++) {
    const body = await request(context, `/luna/pc/artists/${id}/tracks`, { cursor, count: '100' })
    if (!Array.isArray(body.tracks)) throw new Error('汽水音乐暂未提供此歌手的作品列表')
    for (const entry of body.tracks) {
      const track = toTrack(entry)
      if (track) list.set(track.id, track)
    }
    if (!body.has_more) return { name: text(artist.name) || '汽水音乐歌手', cover: imageUrl(artist.url_avatar), list: [...list.values()] }
    const next = String(body.next_cursor ?? '')
    if (!next || next === cursor || seen.has(next) || !body.tracks.length) throw new Error('汽水音乐歌手作品分页不完整，请重试')
    seen.add(next)
    cursor = next
  }
  throw new Error('汽水音乐歌手作品分页异常，请稍后重试')
}

export async function getShareTrack(context: ProviderContext, id: string): Promise<LX.Music.MusicInfo_online_common> {
  const result = await sharePage(context, id)
  const track = toTrack(result.info)
  if (!track) throw new Error('汽水音乐未返回歌曲信息')
  return track
}

function catalogEntity(value: unknown, kind: Exclude<CatalogKind, 'track'>, fallbackName = ''): CatalogEntity | null {
  const item = object(value)
  const entity = object(item.entity)
  const raw = object(entity[kind] ?? item[kind] ?? item)
  const id = itemId(raw.id)
  if (!id) return null
  const artists: Json[] = Array.isArray(raw.artists) ? raw.artists.map(object) : []
  return {
    id,
    name: text(raw.name ?? raw.title) || text(fallbackName) || '未命名条目',
    cover: imageUrl(raw.url_cover) || imageUrl(raw.url_avatar),
    singer: artists.map(artist => text(artist.name)).filter(Boolean).join('、') || text(object(raw.owner).nickname),
    description: text(raw.desc ?? raw.description),
    count: Math.max(0, Number(raw.count_tracks ?? object(raw.resource_cnt).track_cnt) || 0),
  }
}

async function enrichSuggestions(context: ProviderContext, tracks: LX.Music.MusicInfoOnline[]): Promise<LX.Music.MusicInfoOnline[]> {
  let next = 0
  const workers = Array.from({ length: Math.min(3, tracks.length) }, async() => {
    while (next < tracks.length) {
      const index = next++
      const track = tracks[index]
      if (track.singer !== '未知歌手' && track.interval && track.meta.picUrl) continue
      try {
        const detail = await getShareTrack(context, String(track.meta.songId))
        tracks[index] = {
          ...detail,
          singer: detail.singer === '未知歌手' ? track.singer : detail.singer,
          interval: detail.interval ?? track.interval,
          meta: {
            ...detail.meta,
            albumName: detail.meta.albumName || track.meta.albumName,
            albumId: text(detail.meta.albumId) || track.meta.albumId,
            picUrl: text(detail.meta.picUrl) || track.meta.picUrl,
          },
        }
      } catch { /* A public metadata failure must not discard a valid suggestion. */ }
    }
  })
  await Promise.all(workers)
  return tracks
}

export async function searchCatalog(context: ProviderContext, query: string, kind: CatalogKind, page = 1): Promise<CatalogResult> {
  if (!['track', 'album', 'artist', 'playlist'].includes(kind)) throw new Error('不支持的汽水音乐搜索类型')
  query = text(query).slice(0, 200)
  if (!query) return { list: [], total: 0, page: 1, limit: 30, limited: false }
  page = Math.max(1, Math.min(1000, Math.floor(Number(page) || 1)))
  try {
    const params = { q: query, cursor: String((page - 1) * 30), search_id: randomUUID(), search_method: kind, debug_params: '', from_search_id: '', search_scene: '' }
    const body = await request(context, `/luna/h5/search/${kind}`, params, {})
    if (!Array.isArray(body.result_groups)) throw new Error('汽水音乐未返回完整搜索结果')
    const result = new Map<string, LX.Music.MusicInfoOnline | CatalogEntity>()
    let more = false
    for (const rawGroup of body.result_groups) {
      const group = object(rawGroup)
      if (group.id !== `${kind}s` && group.id !== 'top_results') continue
      if (group.has_more) more = true
      for (const entry of Array.isArray(group.data) ? group.data : []) {
        const entity = object(object(entry).entity)
        const correct = kind === 'track' ? entity.track ?? object(entity.track_wrapper).track : entity[kind]
        if (!correct) continue
        const item = kind === 'track' ? toTrack(entry) : catalogEntity(entry, kind)
        if (item) result.set(item.id, item)
      }
    }
    const list = [...result.values()]
    return { list, total: (page - 1) * 30 + list.length + (more ? 1 : 0), page, limit: 30, limited: false }
  } catch (error) {
    if (error instanceof Error && error.message.includes('安全验证')) throw error
    if (page > 1) return { list: [], total: 0, page, limit: 30, limited: true }
    const body = await request(context, '/luna/pc/sug', { q: query, sug_scene: 'main', sug_search_id: randomUUID() })
    if (!Array.isArray(body.sugs)) throw new Error('汽水音乐搜索暂不可用，请先登录后重试')
    const result = new Map<string, LX.Music.MusicInfoOnline | CatalogEntity>()
    for (const raw of body.sugs) {
      const entry = object(raw)
      if (entry.content_type !== kind || !object(entry.entity)[kind]) continue
      const item = kind === 'track' ? toTrack(entry, text(entry.suggestion)) : catalogEntity(entry, kind, text(entry.suggestion))
      if (item) result.set(item.id, item)
    }
    let list = [...result.values()].slice(0, 30)
    if (kind === 'track') list = await enrichSuggestions(context, list as LX.Music.MusicInfoOnline[])
    return { list, total: list.length, page, limit: 30, limited: true }
  }
}

export async function resolveShare(context: ProviderContext, input: string): Promise<{ kind: 'track' | 'playlist' | 'album', id: string }> {
  const plain = text(input)
  if (itemId(plain)) return { kind: 'playlist', id: plain }
  const found = plain.match(/https:\/\/[^\s<>"“”]+/i)
  if (!found) throw new Error('请粘贴汽水音乐的官方歌曲、专辑或歌单分享链接')
  let url: URL
  try { url = new URL(found[0].replace(/[，。；！）)]+$/, '')) } catch { throw new Error('汽水音乐分享链接格式错误') }
  const seen = new Set<string>()
  for (let attempt = 0; attempt < 5; attempt++) {
    if (url.protocol !== 'https:' || !officialHosts.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new Error('仅支持汽水音乐官方 HTTPS 分享链接')
    if (seen.has(url.toString())) throw new Error('汽水音乐分享链接发生循环跳转')
    seen.add(url.toString())
    const match = url.pathname.match(/\/(?:qishui\/)?share\/(track|playlist|album)\/?$/)
    if (match) {
      const kind = match[1] as 'track' | 'playlist' | 'album'
      const id = itemId(url.searchParams.get(`${kind}_id`))
      if (!id) throw new Error('汽水音乐分享链接缺少条目编号')
      return { kind, id }
    }
    if (url.hostname !== 'qishui.douyin.com' || !/^\/s\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new Error('不支持此汽水音乐链接，请使用“分享”复制的链接')
    const response = await context.session.fetch(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) throw new Error('汽水音乐短链接已失效，请重新复制')
    url = new URL(location, url)
  }
  throw new Error('汽水音乐分享链接跳转次数过多')
}

export async function getLyrics(context: ProviderContext, id: string) {
  return toLyrics((await sharePage(context, id)).option)
}

export const qishuiProvider: PlatformProvider = {
  id: 'qishui',
  source: 'qs',
  name: '汽水音乐',
  loginUrl: 'https://www.qishui.com/',
  cookieUrl: 'https://api.qishui.com/',
  domains: ['qishui.com', 'douyin.com'],
  syncSupported: true,
  notice: '使用抖音 APP 扫码登录。完整搜索需要登录；分享音频仅提供平台允许的音质，加密、会员或版权受限歌曲会尝试其他平台。',
  authenticated: cookies => Boolean(cookies.sessionid || cookies.sessionid_ss || cookies.sid_tt),
  async profile(context) {
    const body = await request(context, '/luna/pc/me')
    const info = object(body.my_info)
    const id = itemId(info.id)
    if (!id) throw new Error('汽水音乐未确认登录，请重新扫码')
    return { id, nickname: text(info.nickname ?? info.public_name) || '汽水音乐用户', avatar: imageUrl(info.url_avatar), extra: { secUid: text(info.sec_uid) } }
  },
  async likes(context) {
    const playlists = await myPlaylists(context)
    const likes = playlists.find(item => Number(item.type) === 1)
    return likes ? (await publicPlaylist(context, itemId(likes.id))).list : []
  },
  async playlists(context, profile) {
    const entries = await myPlaylists(context)
    return entries.filter(item => Number(item.type) !== 1).map(item => {
      const playlist: PlatformPlaylist = { id: `qishui:${itemId(item.id)}`, platform: 'qishui', ownerId: profile.id, remoteId: itemId(item.id), name: text(item.title ?? item.name) || '汽水音乐歌单', cover: imageUrl(item.url_cover), count: Math.max(0, Number(item.count_tracks) || 0), lastSync: null, loaded: false }
      return playlist
    })
  },
  async playlistTracks(context, profile, playlist) {
    if (playlist.platform !== 'qishui' || playlist.ownerId !== profile.id) throw new Error('歌单不属于当前汽水音乐账号，请重新同步')
    return (await publicPlaylist(context, playlist.remoteId)).list
  },
  async search(context, track) {
    return (await searchCatalog(context, `${track.name} ${track.singer}`, 'track')).list as LX.Music.MusicInfoOnline[]
  },
  async available(context, track) {
    if (track.source !== 'qs') return false
    try { return trueFlag((await sharePage(context, String(track.meta.songId))).option.hasCopyright) } catch (error) {
      if (error instanceof Error && /不可用|已下架|版权/.test(error.message)) return false
      throw error
    }
  },
  async musicQualitys(context, track) {
    await shareAudio(context, String(track.meta.songId))
    return ['auto']
  },
  async musicUrl(context, track) {
    if (track.source !== 'qs') throw new Error('此记录不是汽水音乐歌曲')
    const audio = await shareAudio(context, String(track.meta.songId))
    await probeAudio(context, audio.url)
    return { url: audio.url, type: '128k', quality: 'auto', qualityLabel: '分享音频（平台提供）', expires: Math.max(0, (audio.expires - Date.now()) / 1000) }
  },
  async like(context, profile: PlatformProfile, track, liked) {
    const id = itemId(track.meta.songId)
    if (track.source !== 'qs' || !id) throw new Error('此记录不是汽水音乐歌曲')
    const current = await this.profile(context)
    if (current.id !== profile.id) throw new Error('汽水音乐账号已变化，请重新同步后操作')
    const result = await request(context, liked ? '/luna/me/collection/track' : '/luna/me/collection/track/delete', {}, { track_ids: [id] })
    const receipt = liked ? result.track_ids : result.deleted_tracks
    if (!Array.isArray(receipt) || !receipt.some(value => itemId(typeof value === 'object' ? object(value).id ?? object(value).track_id : value) === id)) throw new Error('汽水音乐未确认收藏操作，请刷新后重试')
  },
}

export default qishuiProvider
