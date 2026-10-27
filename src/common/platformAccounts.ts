export type PlatformId = 'qq' | 'netease' | 'qishui' | 'bodian' | 'kugou' | 'kugouConcept' | 'kuwo' | 'migu' | 'bilibili'

export const platformNames: Record<PlatformId, string> = { qq: 'QQ 音乐', netease: '网易云音乐', qishui: '汽水音乐', bodian: '波点音乐', kugou: '酷狗音乐', kugouConcept: '酷狗概念版', kuwo: '酷我音乐', migu: '咪咕音乐', bilibili: '哔哩哔哩' }

export interface PlatformProfileVip {
  /** 会员展示名称，例如「黑胶VIP」。 */
  label: string
  /** 到期毫秒时间戳；平台未提供时为 null。 */
  dueDate: number | null
}

export interface PlatformProfile {
  id: string
  nickname: string
  avatar: string
  /** 平台会员状态；接口未提供的平台缺省。 */
  vip?: PlatformProfileVip
  extra?: Record<string, string>
}

export interface PlatformAccount {
  platform: PlatformId
  name: string
  connected: boolean
  profile: PlatformProfile | null
  lastSync: number | null
  count: number
  error: string
  notice?: string
  canSync?: boolean
  /** 该平台的 provider 是否实现了「添加歌曲到歌单」。 */
  canAddToPlaylist?: boolean
}

export interface PlatformFavorite {
  key: string
  track: LX.Music.MusicInfoOnline
  platforms: Array<{ platform: PlatformId, track: LX.Music.MusicInfoOnline }>
}

export interface PlatformPlaylist {
  id: string
  platform: PlatformId
  ownerId: string
  remoteId: string
  name: string
  cover: string
  count: number
  lastSync: number | null
  loaded: boolean
  /** 收藏的他人歌单；缺省视为本人创建。 */
  collected?: boolean
  /**
   * 平台侧原歌单的集合标识。收藏歌单的 remoteId 指向「我的收藏副本」，
   * 只有这个字段才指向可读的原歌单（酷狗概念版的 global_collection_id）。
   */
  remoteCollectionId?: string
}

export interface PlatformPlaylistDetail {
  playlist: PlatformPlaylist
  tracks: LX.Music.MusicInfoOnline[]
  cached: boolean
}

export interface PlatformHeartbeatRequest {
  /** Current NetEase song ID; otherwise a random liked song is used. */
  seedId?: string | number
}

export interface PlatformHeartbeatResult {
  accountId: string
  playlistId: string
  seedId: string
  tracks: LX.Music.MusicInfoOnline[]
}

export interface PlatformSnapshot {
  accounts: PlatformAccount[]
  favorites: PlatformFavorite[]
  playlists?: PlatformPlaylist[]
}

export interface PlatformLikeResult {
  platform: PlatformId
  status: 'success' | 'unavailable' | 'unmatched' | 'ambiguous' | 'failed'
  message: string
  track?: LX.Music.MusicInfoOnline
}

/** 单个平台「加入歌单」的结果；status 语义与红心一致。 */
export interface PlatformPlaylistAddResult {
  platform: PlatformId
  playlistId: string
  status: 'success' | 'unavailable' | 'unmatched' | 'ambiguous' | 'failed'
  message: string
  track?: LX.Music.MusicInfoOnline
}
