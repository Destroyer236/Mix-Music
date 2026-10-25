// 酷狗音乐概念版（KugouYoung）独立账号。
// 与酷狗音乐标准版是不同产品：概念版走 Android 协议，能同步歌单、红心与写入，
// 但两者的凭据体系互不兼容（标准版官网 cookie 的 appid 1014 无法用于 cloudlist）。
// 播放复用标准版 provider 的 kg 音源能力，因此 source 同样是 'kg'。
import type { PlatformPlaylist } from '@common/platformAccounts'
import type { PlatformProvider, ProviderContext } from './types'
import { kugouProvider } from './kugou'
import * as concept from './kugouConcept'

const notice = '酷狗概念版扫码登录后可同步歌单、红心与添加歌曲。播放复用酷狗音源，权限以当前账号为准。'

/** 概念版歌单曲目与标准版字段差异较大，这里直接按实测字段构造。 */
const toTrack = (song: any): LX.Music.MusicInfo_kg | null => {
  const hash = String(song?.hash ?? '')
  // name 带扩展名（如 ".mp3"），去掉后作为曲名。
  const rawName = String(song?.name ?? song?.filename ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').trim()
  if (!hash || !rawName) return null
  const singers: string[] = Array.isArray(song?.singerinfo)
    ? song.singerinfo.map((item: any) => String(item?.name ?? '')).filter(Boolean)
    : []
  // timelen 是毫秒。
  const seconds = Math.floor(Math.max(0, Number(song?.timelen) || 0) / 1000)
  const albumAudioId = String(song?.mixsongid ?? '')
  const meta: LX.Music.MusicInfoMeta_kg = {
    songId: String(song?.audio_id ?? hash),
    hash,
    albumName: String(song?.albuminfo?.name ?? ''),
    albumId: String(song?.album_id ?? ''),
    albumAudioId,
    picUrl: String(song?.cover ?? song?.trans_param?.union_cover ?? '').replace('{size}', '400'),
    qualitys: [{ type: '128k', size: null, hash }],
    _qualitys: { '128k': { size: null, hash } },
  }
  return {
    id: `kg_${song?.audio_id ?? hash}_${hash}`,
    source: 'kg',
    name: rawName,
    singer: singers.join(' / ') || '未知歌手',
    interval: seconds ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : null,
    meta,
  }
}

const hasLogin = async(context: ProviderContext) => {
  const saved = await concept.loadCredentials(context)
  return Boolean(saved?.token && saved.userid)
}

export const kugouConceptProvider: PlatformProvider = {
  id: 'kugouConcept',
  // 音源仍是酷狗（kg），播放链路直接复用标准版 provider 的实现。
  source: 'kg',
  name: '酷狗概念版',
  loginUrl: 'https://www.kugou.com/',
  cookieUrl: 'https://www.kugou.com/',
  domains: ['kugou.com', 'kugou.net', 'qq.com', 'gtimg.cn'],
  syncSupported: true,
  notice,
  authenticated: cookies => Boolean(cookies.linkline_kugou_token && cookies.linkline_kugou_userid),
  async profile(context) {
    if (!await hasLogin(context)) throw new Error('请扫码登录酷狗概念版')
    const detail = await concept.userDetail(context)
    return {
      id: detail.id,
      nickname: detail.nickname,
      avatar: /^https?:\/\//.test(detail.avatar) ? detail.avatar : '',
      ...(detail.vip ? { vip: detail.vip } : {}),
    }
  },
  async likes(context, profile): Promise<LX.Music.MusicInfoOnline[]> {
    const lists = await concept.playlists(context, profile.id)
    const favorite = lists.find(item => item.isDefault)
    if (!favorite) return []
    const songs = await concept.playlistTracks(context, favorite.id)
    return songs.map(toTrack).filter((song): song is LX.Music.MusicInfo_kg => song != null)
  },
  async playlists(context, profile): Promise<PlatformPlaylist[]> {
    const lists = await concept.playlists(context, profile.id)
    // 「我喜欢」作为红心来源单独使用；「默认收藏」是酷狗的空系统目录，不展示。
    return lists.filter(item => !item.isDefault && !/^默认收藏$/.test(item.name)).map(item => ({
      id: `kugouConcept:${item.id}`,
      platform: 'kugouConcept',
      ownerId: profile.id,
      remoteId: item.id,
      name: item.name,
      cover: item.cover,
      count: item.count,
      lastSync: null,
      loaded: false,
    }))
  },
  async playlistTracks(context, profile, playlist) {
    if (playlist.platform !== 'kugouConcept' || playlist.ownerId !== profile.id) throw new Error('歌单不属于当前酷狗概念版账号，请重新同步')
    const songs = await concept.playlistTracks(context, playlist.remoteId)
    return songs.map(toTrack).filter((song): song is LX.Music.MusicInfo_kg => song != null)
  },
  // 搜索走概念版自己的 complexsearch 网关：官网 web 搜索在概念版分区会 net::ERR_FAILED。
  async search(context, track) {
    const songs = await concept.searchSongs(context, `${track.name} ${track.singer}`.trim())
    return songs.map(fromSearch).filter((song): song is LX.Music.MusicInfo_kg => song != null)
  },
  async available(context, track) { return kugouProvider.available(context, track) },
  // 刻意不提供 musicQualitys / musicUrl：两者同为 kg 音源，若都参与播放解析会
  // 让同一个 source 命中两个 provider，可能用错账号取流。播放统一交给标准版处理。
  async like(context, profile, track, liked) {
    if (!liked) throw new Error('酷狗概念版暂不支持取消红心')
    const lists = await concept.playlists(context, profile.id)
    const favorite = lists.find(item => item.isDefault)
    if (!favorite) throw new Error('酷狗概念版未找到「我喜欢」歌单，请重新同步')
    await concept.addToPlaylist(context, favorite.id, resource(track))
  },
  async addToPlaylist(context, profile, playlist, track) {
    if (playlist.platform !== 'kugouConcept' || playlist.ownerId !== profile.id) throw new Error('歌单不属于当前酷狗概念版账号，请重新同步')
    await concept.addToPlaylist(context, playlist.remoteId, resource(track))
  },
}

/** 搜索接口返回标准版字段（FileHash/OriSongName/...），需单独映射。 */
function fromSearch(song: any): LX.Music.MusicInfo_kg | null {
  const hash = String(song?.FileHash ?? '')
  const name = String(song?.OriSongName ?? song?.SongName ?? '').trim()
  if (!hash || !name) return null
  const qualitys: LX.Music.MusicQualityTypeKg[] = []
  for (const [type, prefix] of [['128k', ''], ['320k', 'HQ'], ['flac', 'SQ'], ['flac24bit', 'Res']] as const) {
    const h = song?.[`${prefix}FileHash`]
    if (h && Number(song?.[`${prefix}FileSize`]) > 0) qualitys.push({ type: type as LX.Quality, size: null, hash: String(h) })
  }
  if (!qualitys.length) qualitys.push({ type: '128k', size: null, hash })
  const seconds = Math.max(0, Number(song?.Duration) || 0)
  const meta: LX.Music.MusicInfoMeta_kg = {
    songId: String(song?.Audioid ?? hash),
    hash,
    albumName: String(song?.AlbumName ?? ''),
    albumId: String(song?.AlbumID ?? ''),
    albumAudioId: String(song?.MixSongID ?? ''),
    picUrl: String(song?.Image ?? song?.AlbumImage ?? '').replace('{size}', '400'),
    qualitys,
    _qualitys: Object.fromEntries(qualitys.map(item => [item.type, { size: null, hash: item.hash }])),
  }
  return {
    id: `kg_${song?.Audioid ?? hash}_${hash}`,
    source: 'kg',
    name,
    singer: String(song?.SingerName ?? '未知歌手'),
    interval: seconds ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : null,
    meta,
  }
}

/** 加歌接口需要的资源标识（hash / album_id / mixsongid）。 */
function resource(track: LX.Music.MusicInfoOnline) {
  if (track.source !== 'kg') throw new Error('此记录不是酷狗音乐歌曲')
  const meta: Partial<LX.Music.MusicInfoMeta_kg> = track.meta
  if (!meta.hash) throw new Error('酷狗歌曲缺少 hash 标识')
  return { name: track.name, hash: meta.hash, albumId: meta.albumId ?? '', mixsongid: meta.albumAudioId ?? '' }
}

export default kugouConceptProvider
