export type PlatformQuality = LX.Quality | 'auto' | '64k' | 'dolby' | 'jyeffect' | 'sky' | 'jymaster' | 'vivid'

export const qualityLabels: Record<PlatformQuality, string> = {
  auto: '账号最高音质',
  '64k': '基础 · 64K',
  dolby: '杜比音频',
  '128k': 'SD',
  '192k': '较高 · 192K',
  '320k': 'HQ',
  flac: 'SQ',
  flac24bit: 'Hi-Res · 24bit',
  jyeffect: '高清环绕声',
  sky: '沉浸环绕声',
  jymaster: '超清母带',
  vivid: '臻音全景声（Audio Vivid）',
  ape: '无损 · APE',
  wav: '无损 · WAV',
}

// Providers share internal tier IDs, but their product names differ.
const neteaseQualityLabels: Partial<Record<PlatformQuality, string>> = {
  '128k': '标准 · 128kbps',
  '320k': '极高（HQ）',
  flac: '无损（SQ）',
  flac24bit: '高解析度无损（Hi-Res）',
  jyeffect: '高清臻音（Spatial Audio）',
  sky: '沉浸环绕声（Surround Audio）',
}
export const getPlatformQualityLabel = (quality: PlatformQuality, source?: string): string =>
  (source === 'wy' || source === 'netease' ? neteaseQualityLabels[quality] : undefined) ?? qualityLabels[quality]

export const isPlatformQuality = (value: unknown): value is PlatformQuality => typeof value === 'string' && Object.prototype.hasOwnProperty.call(qualityLabels, value)

export interface PlatformStream {
  url: string
  type: LX.Quality
  quality?: PlatformQuality
  qualityLabel?: string
  expires?: number
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  /** True only when the platform returned an official preview resource. */
  isTrial?: boolean
}

export interface ResolvedPlatformStream extends PlatformStream {
  platform: string
  musicInfo: LX.Music.MusicInfoOnline
}

/** URLs rejected by the media element during the current playback attempt. */
export interface PlaybackResolveOptions {
  rejectedUrls?: string[]
  /** 请求音质不可用时，沿候选自身可提供的更低音质依次重试（下载级联用；播放不开启）。 */
  qualityFallback?: boolean
}

export const legacyQuality = (quality: PlatformQuality): LX.Quality => {
  if (quality === '64k') return '128k'
  if (quality === 'dolby') return '192k'
  return ['auto', 'jyeffect', 'sky', 'jymaster', 'vivid'].includes(quality) ? 'flac24bit' : quality as LX.Quality
}
