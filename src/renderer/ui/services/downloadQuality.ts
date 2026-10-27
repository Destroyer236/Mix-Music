import { QUALITYS } from '@common/constants'

/**
 * 歌曲可下载的音质，按最高优先排序（QUALITYS 本身从高到低）。
 *
 * sourceList 是旧版音乐接口（设置里的「当前音源」）为该平台声明的音质。平台歌单
 * 的歌曲来自平台 provider，自带 meta.qualitys，与该接口无关——用户把「当前音源」
 * 设为未选择时 sourceList 为 undefined，必须回退到歌曲自身的声明，否则所有平台
 * 歌曲都会被误判为没有可用音质。
 */
export const trackQualities = (track: Pick<LX.Music.MusicInfoOnline, 'source' | 'meta'>, sourceList: readonly LX.Quality[] | undefined): LX.Quality[] =>
  QUALITYS.filter(quality => {
    if (!track.meta.qualitys.some(item => item.type === quality)) return false
    return sourceList ? sourceList.includes(quality) : Boolean(track.meta._qualitys?.[quality])
  })

/** 自动音质：该歌曲可用的最高音质；Worker 对请求音质不可用时会继续向下递减。 */
export const bestTrackQuality = (track: Pick<LX.Music.MusicInfoOnline, 'source' | 'meta'>, sourceList: readonly LX.Quality[] | undefined): LX.Quality | null =>
  trackQualities(track, sourceList)[0] ?? null
