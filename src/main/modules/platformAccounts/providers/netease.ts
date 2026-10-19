import type { PlatformProvider, ProviderContext } from './types'
import { getPlatformQualityLabel, legacyQuality, type PlatformQuality, type PlatformStream } from '@common/platformPlayback'
import type { PlatformHeartbeatRequest, PlatformHeartbeatResult, PlatformPlaylist, PlatformProfile } from '@common/platformAccounts'
import { songVip } from '@common/musicAccess'
import { songSubtitle } from '@common/musicSubtitle'

// Use the maintained SDK's protocol encryption with Electron's isolated cookie jar.
import encryption from 'NeteaseCloudMusicApi/util/crypto'

const request = async(context: ProviderContext, path: string, data: Record<string, unknown> = {}, signal?: AbortSignal): Promise<any> => {
  signal?.throwIfAborted()
  const cookies = await context.cookies()
  const response = await context.session.fetch(`https://music.163.com/weapi/${path}?csrf_token=${encodeURIComponent(cookies.__csrf ?? '')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
    body: new URLSearchParams(encryption.weapi({ ...data, csrf_token: cookies.__csrf ?? '' })).toString(),
    signal: signal ?? AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`网易云请求失败 (${response.status})`)
  const body = await response.json()
  if (body.code !== 200) throw new Error(body.code === 301 || body.code === 302 ? '登录已失效，请重新登录' : `网易云接口返回错误 (${String(body.code)})`)
  return body
}

const toTrack = (song: any, privilege?: unknown): LX.Music.MusicInfoOnline => {
  const duration = Math.round(Number(song.dt ?? song.duration ?? 0) / 1000)
  const album = song.al ?? song.album ?? {}
  // A liked song does not include bitrate fields in the playlist/detail
  // response.  LinkLine's source fallback only considers candidates that
  // advertise the requested quality, so expose the platform's standard
  // 128k stream as the baseline quality.  The playback source still checks
  // the actual availability before returning a URL.
  const qualitys: LX.Music.MusicQualityType[] = [{ type: '128k', size: null }]
  return {
    id: `wy_${song.id}`,
    source: 'wy',
    name: song.name ?? '',
    singer: (song.ar ?? song.artists ?? []).map((artist: any) => artist.name).join('、'),
    interval: `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`,
    meta: { songId: song.id, isVip: songVip('wy', song, privilege), subtitle: songSubtitle('wy', song), albumName: album.name ?? '', albumId: album.id, picUrl: album.picUrl ?? '', qualitys, _qualitys: { '128k': { size: null } } },
  }
}

const levels: Partial<Record<PlatformQuality, string>> = { '128k': 'standard', '192k': 'higher', '320k': 'exhigh', flac: 'lossless', flac24bit: 'hires', jyeffect: 'jyeffect', sky: 'sky', jymaster: 'jymaster', auto: 'jymaster' }
const qualitiesByLevel = Object.fromEntries(Object.entries(levels).filter(([key]) => key !== 'auto').map(([quality, level]) => [level, quality])) as Record<string, PlatformQuality>
const qualityOrder: PlatformQuality[] = ['jymaster', 'sky', 'jyeffect', 'flac24bit', 'flac', '320k', '192k', '128k']
const qualityRank = (quality: PlatformQuality): number => {
  const index = qualityOrder.indexOf(quality)
  return index < 0 ? 0 : qualityOrder.length - index
}

const trackId = (track: LX.Music.MusicInfoOnline): number => {
  const id = Number(track.meta.songId)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('网易云歌曲缺少有效 ID')
  return id
}
const hasAudio = (file: any): boolean => file != null && typeof file === 'object' && (Number(file.size) > 0 || Number(file.br) > 0)
const fileQualitys = (song: any): PlatformQuality[] => {
  const fields: Array<[PlatformQuality, unknown]> = [
    ['128k', song?.l], ['192k', song?.m], ['320k', song?.h], ['flac', song?.sq], ['flac24bit', song?.hr],
    ['jyeffect', song?.je], ['sky', song?.sk], ['jymaster', song?.jm], ['vivid', song?.vi],
  ]
  const result = fields.filter(([, file]) => hasAudio(file)).map(([quality]) => quality)
  if (!result.includes('sky') && Array.isArray(song?.sks) && song.sks.some(hasAudio)) result.push('sky')
  return result
}
async function musicQualitys(context: ProviderContext, track: LX.Music.MusicInfoOnline, signal?: AbortSignal): Promise<PlatformQuality[]> {
  const id = trackId(track)
  try {
    // Ordinary song/detail omits the enhanced formats. The dedicated endpoint
    // also uses `sk`/`sks`, not the player level name `sky`, for surround audio.
    const body = await request(context, 'song/music/detail/get', { songId: id }, signal)
    const song = body.data
    if (!song || Array.isArray(song) || (song.songId != null && String(song.songId) !== String(id)) || (song.id != null && String(song.id) !== String(id))) throw new Error('网易云音质详情不完整')
    const found = fileQualitys(song)
    if (!found.length) throw new Error('网易云暂未返回音质详情')
    return [...new Set<PlatformQuality>(['128k', ...found])]
  } catch {
    signal?.throwIfAborted()
    // Older servers may not expose music/detail. Preserve their known tiers
    // without interpreting a song's maximum tier as an account entitlement.
    const body = await request(context, 'v3/song/detail', { c: JSON.stringify([{ id }]) }, signal)
    const song = body.songs?.find((item: any) => String(item.id) === String(id))
    const privilege = body.privileges?.find((item: any) => String(item.id) === String(id))
    if (!song) throw new Error('网易云未返回这首歌的音质信息')
    const qualitys = new Set<PlatformQuality>(['128k', ...fileQualitys(song)])
    if (song.m || Number(privilege?.maxbr) >= 192000) qualitys.add('192k')
    if (song.h || Number(privilege?.maxbr) >= 320000) qualitys.add('320k')
    if (song.sq || Number(privilege?.maxbr) >= 999000) qualitys.add('flac')
    const highest = qualitiesByLevel[privilege?.maxBrLevel]
    if (highest) qualitys.add(highest)
    return [...qualitys]
  }
}

const streamFromItem = (item: any): PlatformStream | null => {
  if (typeof item?.url !== 'string' || !/^https?:\/\//i.test(item.url)) return null
  // Audio Vivid is delivered as AV3A, which the current media element cannot
  // decode. Never label that resource as playable FLAC or select it on auto.
  if (item.level === 'vivid' || /av3a/i.test(`${String(item.type ?? '')} ${String(item.encodeType ?? '')}`)) return null
  const bitrate = Number(item.br ?? 0)
  const byBitrate: LX.Quality = bitrate >= 1_999_000 ? 'flac24bit' : bitrate >= 999_000 ? 'flac' : bitrate >= 320_000 ? '320k' : bitrate >= 192_000 ? '192k' : '128k'
  const quality = qualitiesByLevel[item.level] ?? byBitrate
  return {
    url: item.url,
    type: legacyQuality(quality),
    quality,
    qualityLabel: getPlatformQualityLabel(quality, 'wy'),
    expires: Number(item.expi ?? 1200),
    bitrate,
    ...(Number(item.sr ?? item.sampleRate) > 0 ? { sampleRate: Number(item.sr ?? item.sampleRate) } : {}),
    ...(Number(item.bitDepth) > 0 ? { bitDepth: Number(item.bitDepth) } : {}),
    isTrial: Boolean(item.freeTrialInfo),
  }
}

const musicId = (value: unknown): string => {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  const id = String(value).trim()
  return /^[1-9]\d{0,24}$/.test(id) ? id : ''
}

/** Follow SPlayer Next's NetEase intelligence queue protocol. */
export async function getNeteaseHeartbeat(context: ProviderContext, profile: PlatformProfile, params: PlatformHeartbeatRequest = {}): Promise<PlatformHeartbeatResult> {
  if (!(await context.cookies()).MUSIC_U) throw new Error('登录网易云音乐后才能使用心动模式')
  let seedId = musicId(params.seedId)
  if (!seedId) {
    const liked = await request(context, 'song/like/get', { uid: profile.id })
    if (!Array.isArray(liked.ids)) throw new Error('无法读取网易云喜欢的歌曲，请稍后重试')
    const ids = liked.ids.map(musicId).filter(Boolean)
    if (!ids.length) throw new Error('请先在网易云音乐喜欢一些歌曲，再使用心动模式')
    seedId = ids[Math.floor(Math.random() * ids.length)]
  }

  // The ordinary playlist snapshot intentionally excludes this special list.
  let playlistId = ''
  let offset = 0
  for (let page = 0; page < 200; page++) {
    const body = await request(context, 'user/playlist', { uid: profile.id, limit: 100, offset, includeVideo: false })
    if (!Array.isArray(body.playlist)) throw new Error('无法读取网易云喜欢的音乐歌单，请稍后重试')
    const liked = body.playlist.find((item: any) => Number(item?.specialType) === 5 && String(item.creator?.userId ?? '') === profile.id && musicId(item.id))
    if (liked) { playlistId = musicId(liked.id); break }
    if (!body.more || !body.playlist.length) break
    offset += body.playlist.length
  }
  if (!playlistId) throw new Error('未找到网易云喜欢的音乐歌单，请先在网易云音乐喜欢一些歌曲')

  const body = await request(context, 'playmode/intelligence/list', {
    songId: seedId,
    type: 'fromPlayOne',
    playlistId,
    startMusicId: seedId,
    // NetEase returns the complete smart queue for one seed. Count is required.
    count: 1,
  })
  if (!Array.isArray(body.data)) throw new Error('网易云暂时无法生成心动歌单，请稍后重试')
  const tracks = new Map<string, LX.Music.MusicInfoOnline>()
  for (const item of body.data) {
    const song = item?.songInfo
    const id = musicId(song?.id)
    if (!id || typeof song?.name !== 'string' || !song.name.trim() || tracks.has(id)) continue
    tracks.set(id, toTrack(song, item.privilege ?? song.privilege))
  }
  if (!tracks.size) throw new Error('网易云暂时没有返回心动歌曲，请稍后重试')
  return { accountId: profile.id, playlistId, seedId, tracks: [...tracks.values()] }
}

async function playlists(context: ProviderContext, profile: PlatformProfile): Promise<PlatformPlaylist[]> {
  const result = new Map<string, PlatformPlaylist>()
  let offset = 0
  for (let page = 0; page < 200; page++) {
    const body = await request(context, 'user/playlist', { uid: profile.id, limit: 100, offset, includeVideo: false })
    if (!Array.isArray(body.playlist)) throw new Error('网易云未返回用户歌单列表')
    for (const item of body.playlist) {
      if (String(item?.creator?.userId ?? '') !== profile.id || Number(item.specialType) === 5) continue
      const remoteId = String(item.id ?? '')
      if (!/^\d+$/.test(remoteId) || Number(remoteId) <= 0) continue
      result.set(remoteId, {
        id: `netease:${remoteId}`,
        platform: 'netease',
        ownerId: profile.id,
        remoteId,
        name: String(item.name ?? '未命名歌单'),
        cover: String(item.coverImgUrl ?? ''),
        count: Math.max(0, Number(item.trackCount) || 0),
        lastSync: null,
        loaded: false,
      })
    }
    offset += body.playlist.length
    if (!body.more) return [...result.values()]
    if (!body.playlist.length) throw new Error('网易云用户歌单分页不完整')
  }
  throw new Error('网易云用户歌单超过同步上限')
}

async function playlistTracks(context: ProviderContext, profile: PlatformProfile, playlist: PlatformPlaylist): Promise<LX.Music.MusicInfoOnline[]> {
  const body = await request(context, 'v6/playlist/detail', { id: playlist.remoteId, n: 100000, s: 0 })
  const detail = body.playlist
  if (!detail || String(detail.creator?.userId ?? '') !== profile.id) throw new Error('歌单不属于当前网易云账号，请重新同步')
  if (!Array.isArray(detail.trackIds)) throw new Error('网易云未返回完整歌单曲目')
  const ids: number[] = detail.trackIds.map((item: any) => Number(item.id)).filter((id: number) => Number.isSafeInteger(id) && id > 0)
  if (ids.length !== detail.trackIds.length || (Number(detail.trackCount) > ids.length)) throw new Error('网易云歌单曲目响应不完整')
  const songs = new Map<number, LX.Music.MusicInfoOnline>()
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500)
    const details = await request(context, 'v3/song/detail', { c: JSON.stringify(batch.map(id => ({ id }))) })
    if (!Array.isArray(details.songs)) throw new Error('无法读取网易云歌单歌曲详情')
    for (const song of details.songs) if (batch.includes(Number(song.id))) songs.set(Number(song.id), toTrack(song, details.privileges?.find((item: any) => item.id === song.id)))
  }
  return ids.flatMap(id => { const song = songs.get(id); return song ? [song] : [] })
}

export const neteaseProvider: PlatformProvider = {
  id: 'netease',
  source: 'wy',
  authenticated: cookies => Boolean(cookies.MUSIC_U),
  name: '网易云音乐',
  loginUrl: 'https://music.163.com/#/my/',
  domains: ['music.163.com', '163.com', '126.com', 'netease.com'],
  playlists,
  playlistTracks,
  async profile(context) {
    if (!(await context.cookies()).MUSIC_U) throw new Error('请先登录网易云音乐')
    const body = await request(context, 'nuser/account/get')
    if (!body.profile?.userId) throw new Error('登录已失效，请重新登录')
    return { id: String(body.profile.userId), nickname: body.profile.nickname ?? '网易云用户', avatar: body.profile.avatarUrl ?? '' }
  },
  async likes(context, profile) {
    const body = await request(context, 'song/like/get', { uid: profile.id })
    if (!Array.isArray(body.ids)) throw new Error('网易云未返回红心列表')
    const tracks: LX.Music.MusicInfoOnline[] = []
    for (let offset = 0; offset < body.ids.length; offset += 500) {
      const ids = body.ids.slice(offset, offset + 500)
      const details = await request(context, 'v3/song/detail', { c: JSON.stringify(ids.map((id: number) => ({ id }))) })
      if (!Array.isArray(details.songs)) throw new Error('无法读取网易云歌曲详情')
      tracks.push(...details.songs.map((song: any) => toTrack(song, details.privileges?.find((item: any) => item.id === song.id))))
    }
    return tracks
  },
  async search(context, track) {
    const body = await request(context, 'cloudsearch/pc', { s: `${track.name} ${track.singer}`, type: 1, limit: 30, offset: 0, total: true })
    return (body.result?.songs ?? []).map((song: any) => toTrack(song))
  },
  async available(context, track) {
    const body = await request(context, 'v3/song/detail', { c: JSON.stringify([{ id: Number(track.meta.songId) }]) })
    const song = body.songs?.find((item: any) => String(item.id) === String(track.meta.songId))
    const privilege = body.privileges?.find((item: any) => String(item.id) === String(track.meta.songId))
    if (!song || !privilege) return false
    // Paid tracks can be liked; negative status and zero rights indicate withdrawn music.
    return privilege.st >= 0 && (privilege.maxbr > 0 || privilege.pl > 0 || privilege.dl > 0 || privilege.fee === 1 || privilege.fee === 4)
  },
  musicQualitys,
  async musicUrl(context, track, quality) {
    if (quality === 'vivid') throw new Error('当前播放器暂不支持 Audio Vivid 的 AV3A 编码，请选择其他音质')
    const songId = trackId(track)
    // Return any usable stream before the resolver's six-second source timeout,
    // even when a later enhanced-quality probe stops responding.
    const signal = quality === 'auto' ? AbortSignal.timeout(5000) : undefined
    const playerItem = async(level: string) => {
      const body = await request(context, 'song/enhance/player/url/v1', {
        ids: JSON.stringify([songId]),
        level,
        encodeType: ['standard', 'higher', 'exhigh'].includes(level) ? 'mp3' : 'flac',
        ...(level === 'sky' ? { immerseType: 'c51' } : {}),
      }, signal)
      return Array.isArray(body.data) ? body.data.find((entry: any) => String(entry.id) === String(songId)) ?? (body.data.length === 1 && body.data[0]?.id == null ? body.data[0] : null) : null
    }
    let candidates: string[]
    if (quality === 'auto') {
      const available = await musicQualitys(context, track, signal).catch(() => qualityOrder)
      candidates = qualityOrder.filter(quality => quality === '128k' || available.includes(quality)).map(quality => levels[quality]!)
    } else {
      const level = quality === '64k' ? 'standard' : quality === 'dolby' ? 'sky' : levels[quality] ?? 'lossless'
      candidates = level === 'standard' ? [level] : [level, 'standard']
    }
    let trial: PlatformStream | null = null
    let best: PlatformStream | null = null
    let failure: Error | undefined
    for (const level of candidates) {
      if (signal?.aborted) break
      const requested = qualitiesByLevel[level]
      if (quality === 'auto' && best && qualityRank(best.quality ?? best.type) >= qualityRank(requested)) break
      try {
        const stream = streamFromItem(await playerItem(level))
        if (!stream) continue
        // A denied master resource must not skip a VIP's entitled Spatial
        // Audio/Hi-Res/lossless resource, or make its preview win over a full song.
        if (quality !== 'auto') return stream
        if (stream.isTrial) trial ??= stream
        else {
          if (!best || qualityRank(stream.quality ?? stream.type) > qualityRank(best.quality ?? best.type)) best = stream
          // Some responses silently downgrade the requested master tier.
          // Keep that full stream while checking other higher advertised tiers.
          if (qualityRank(best.quality ?? best.type) >= qualityRank(requested)) return best
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('登录已失效')) throw error
        failure = error instanceof Error ? error : new Error('网易云音质请求失败')
      }
    }
    if (best) return best
    if (trial) return trial
    if (signal?.aborted) throw new Error('网易云音源响应超时')
    if (failure) throw failure
    throw new Error('网易云没有返回可播放音频，可能没有版权或登录已失效')
  },
  async like(context, profile, track, liked) {
    await request(context, 'radio/like', { alg: 'itembased', trackId: Number(track.meta.songId), like: liked, time: '3' })
  },
}
