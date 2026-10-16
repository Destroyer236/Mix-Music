import { ipcRenderer } from 'electron'
import { toOldMusicInfo } from '@common/utils/tools'
import { getPlatformMusicUrl } from '../platform'

const unsupported = (..._args) => Promise.reject(new Error('波点音乐暂未提供此目录，请使用搜索或导入歌单链接。'))
const search = async(query, kind, page = 1, limit = 30) => {
  const response = await ipcRenderer.invoke('platform_bodian_search', { query, kind, page, limit })
  return {
    ...response,
    source: 'bo',
    allPage: Math.max(1, Math.ceil(response.total / Math.max(1, response.limit))),
  }
}

// Account credentials and media URL requests stay in the main process.
export default {
  hotSearch: {
    /** @returns {Promise<{source: string, list: string[]}>} */
    getList: unsupported,
  },
  leaderboard: { getBoards: unsupported, getList: unsupported },
  musicSearch: {
    async search(query, page = 1, limit = 30) {
      const response = await search(query, 'track', page, limit)
      return { ...response, list: response.list.map(toOldMusicInfo) }
    },
  },
  songList: {
    sortList: [],
    getTags: unsupported,
    getList: unsupported,
    async search(query, page = 1, limit = 18) {
      const response = await search(query, 'playlist', page, limit)
      return {
        ...response,
        list: response.list.map(item => ({
          source: 'bo',
          id: String(item.id),
          name: item.name,
          img: item.cover,
          author: item.singer || '波点音乐',
          desc: item.description || '',
          total: item.count == null ? undefined : String(item.count),
          play_count: '',
        })),
      }
    },
    async getListDetail(text, page = 1) {
      const { kind, id } = await ipcRenderer.invoke('platform_bodian_share', { text: String(text) })
      if (kind !== 'playlist') throw new Error('请粘贴波点音乐歌单链接或歌单 ID。')
      const response = await ipcRenderer.invoke('platform_bodian_playlist', { id })
      return {
        source: 'bo',
        list: page === 1 ? response.list.map(toOldMusicInfo) : [],
        page,
        limit: Math.max(1, response.list.length),
        total: response.list.length,
        info: { name: response.name, img: response.cover, author: '波点音乐', desc: response.description || '' },
      }
    },
  },
  getMusicUrl(songInfo, type) { return { promise: getPlatformMusicUrl('bo', songInfo, type) } },
  getLyric(songInfo) { return { promise: ipcRenderer.invoke('platform_bodian_lyric', { id: String(songInfo.songmid) }) } },
  getPic(songInfo) { return Promise.resolve(songInfo.img || '') },
  getMusicDetailPageUrl: undefined,
}
