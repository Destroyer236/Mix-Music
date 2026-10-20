import { updateListMusics } from '@renderer/store/list/action'
import { acceptStream, preferredQuality, resolvePlatformStream } from '@renderer/ui/services/platformPlayback'
import { isTruncatedStream, readStreamDuration } from '@renderer/ui/services/streamValidation'
import type { ResolvedPlatformStream } from '@common/platformPlayback'
import {
  saveLyric,
} from '@renderer/utils/ipc'
import {
  buildLyricInfo,
  handleGetOnlineLyricInfo,
  handleGetOnlinePicUrl,
  getCachedLyricInfo,
} from './utils'

/* export const setMusicUrl = ({ musicInfo, type, url }: {
  musicInfo: LX.Music.MusicInfo
  type: LX.Quality
  url: string
}) => {
  saveMusicUrl(musicInfo, type, url)
}

export const setPic = (datas: {
  listId: string
  musicInfo: LX.Music.MusicInfo
  url: string
}) => {
  datas.musicInfo.img = datas.url
  updateMusicInfo({
    listId: datas.listId,
    id: datas.musicInfo.songmid,
    data: { img: datas.url },
    musicInfo: datas.musicInfo,
  })
}
 */


export const getMusicUrl = async({ musicInfo, quality, isRefresh, allowToggleSource = true, rejectedUrls }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  rejectedUrls?: string[]
}): Promise<string> => {
  const requested = quality ?? preferredQuality.value
  const rejected = new Set(rejectedUrls)
  let preview: ResolvedPlatformStream | undefined
  let failure: unknown
  for (let attempt = 0; attempt < 16; attempt++) {
    let stream: ResolvedPlatformStream
    try {
      // Keep successful source caches when rejecting a short or invalid URL;
      // otherwise every retry starts all remote requests again.
      stream = await resolvePlatformStream(musicInfo, attempt === 0 && isRefresh, allowToggleSource, requested, { rejectedUrls: [...rejected] })
    } catch (error) { failure = error; break }
    if (rejected.has(stream.url)) { failure = new Error('音源重复返回了已失效的地址'); break }
    if (stream.isTrial) {
      preview = stream
      break
    }
    try {
      const duration = await readStreamDuration(stream.url)
      if (!isTruncatedStream(musicInfo.interval?.trim() ? musicInfo.interval : stream.musicInfo.interval, duration)) {
        acceptStream(musicInfo, stream, requested)
        return stream.url
      }
      preview ??= { ...stream, isTrial: true, qualityLabel: '试听' }
      failure = new Error('音源仅返回了试听片段')
    } catch (error) { failure = error }
    rejected.add(stream.url)
  }
  // A short resource remains the final fallback, explicitly labelled as a
  // preview. Never let an unlabelled one-minute URL shadow complete audio.
  if (preview) {
    acceptStream(musicInfo, preview, requested)
    return preview.url
  }
  throw failure instanceof Error ? failure : new Error('未找到可播放的完整音频')
}

export const getPicUrl = async({ musicInfo, listId, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  listId?: string | null
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (musicInfo.meta.picUrl && !isRefresh) return musicInfo.meta.picUrl
  return handleGetOnlinePicUrl({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(({ url, musicInfo: targetMusicInfo, isFromCache }) => {
    // picRequest = null
    if (listId) {
      musicInfo.meta.picUrl = url
      void updateListMusics([{ id: listId, musicInfo }])
    }
    // savePic({ musicInfo, url, listId })
    return url
  })
}
export const getLyricInfo = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  // lrcRequest = music[musicInfo.source].getLyric(musicInfo)
  return handleGetOnlineLyricInfo({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(async({ lyricInfo, musicInfo: targetMusicInfo, isFromCache }) => {
    // lrcRequest = null
    if (isFromCache) return buildLyricInfo(lyricInfo)
    if (targetMusicInfo.id == musicInfo.id) void saveLyric(musicInfo, lyricInfo)
    else void saveLyric(targetMusicInfo, lyricInfo)

    return buildLyricInfo(lyricInfo)
  })
}
