/** Platform preference is separate from the optional LX custom API script. */
export type PreferredPlatformSource = 'auto' | LX.OnlineSource

export const platformSourceLabels: Record<PreferredPlatformSource, string> = {
  auto: '自动 · 跟随歌曲来源',
  tx: 'QQ 音乐',
  wy: '网易云音乐',
  kg: '酷狗音乐',
  kw: '酷我音乐',
  mg: '咪咕音乐',
  qs: '汽水音乐',
  bi: '哔哩哔哩',
}

export const isPreferredPlatformSource = (value: unknown): value is PreferredPlatformSource => typeof value === 'string' && Object.prototype.hasOwnProperty.call(platformSourceLabels, value)
