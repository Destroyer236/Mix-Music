import type { PlatformId, PlatformProfile, PlatformPlaylist } from '@common/platformAccounts'
import type { PlatformQuality, PlatformStream } from '@common/platformPlayback'

export interface ProviderContext {
  session: Electron.Session
  playbackSession?: Pick<Electron.Session, 'fetch'>
  cookies: () => Promise<Record<string, string>>
}

export interface PlatformProvider {
  id: PlatformId
  name: string
  loginUrl: string
  cookieUrl?: string
  domains: string[]
  source: LX.OnlineSource
  webOnly?: boolean
  syncSupported?: boolean
  notice?: string
  logout?: (context: ProviderContext) => Promise<void>
  authenticated?: (cookies: Record<string, string>) => boolean
  profile: (context: ProviderContext) => Promise<PlatformProfile>
  likes: (context: ProviderContext, profile: PlatformProfile) => Promise<LX.Music.MusicInfoOnline[]>
  playlists?: (context: ProviderContext, profile: PlatformProfile) => Promise<PlatformPlaylist[]>
  playlistTracks?: (context: ProviderContext, profile: PlatformProfile, playlist: PlatformPlaylist) => Promise<LX.Music.MusicInfoOnline[]>
  search: (context: ProviderContext, track: LX.Music.MusicInfo) => Promise<LX.Music.MusicInfoOnline[]>
  available: (context: ProviderContext, track: LX.Music.MusicInfoOnline) => Promise<boolean>
  musicQualitys?: (context: ProviderContext, track: LX.Music.MusicInfoOnline) => Promise<PlatformQuality[]>
  musicUrl?: (context: ProviderContext, track: LX.Music.MusicInfoOnline, quality: PlatformQuality) => Promise<PlatformStream>
  like: (context: ProviderContext, profile: PlatformProfile, track: LX.Music.MusicInfoOnline, liked: boolean) => Promise<void>
  /**
   * 把歌曲加入指定平台歌单。未实现的平台在 UI 上置灰并展示 notice 原因。
   * 实现方需自行校验歌单归属，并确认平台已接受写入（可回读歌单）。
   */
  addToPlaylist?: (context: ProviderContext, profile: PlatformProfile, playlist: PlatformPlaylist, track: LX.Music.MusicInfoOnline) => Promise<void>
}
