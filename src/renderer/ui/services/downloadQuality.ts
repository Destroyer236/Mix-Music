import { QUALITYS } from '@common/constants'

/**
 * 歌曲在其音源上可下载的音质，按最高优先排序（QUALITYS 本身从高到低）。
 * sourceList 是音源声明的音质列表；undefined 表示该音源未提供。
 */
export const trackQualities = (track: Pick<LX.Music.MusicInfoOnline, 'source' | 'meta'>, sourceList: readonly LX.Quality[] | undefined): LX.Quality[] =>
  QUALITYS.filter(quality => sourceList?.includes(quality) && track.meta.qualitys.some(item => item.type === quality))

/** 自动音质：该歌曲可用的最高音质；Worker 对请求音质不可用时会继续向下递减。 */
export const bestTrackQuality = (track: Pick<LX.Music.MusicInfoOnline, 'source' | 'meta'>, sourceList: readonly LX.Quality[] | undefined): LX.Quality | null =>
  trackQualities(track, sourceList)[0] ?? null
