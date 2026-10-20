import { ipcRenderer } from 'electron'
import { toOldMusicInfo } from '@common/utils/tools'
import { getPlatformMusicUrl } from '../platform'

const unsupported = (..._args) => Promise.reject(new Error('汽水音乐暂未提供此目录，请使用搜索或导入歌单链接。'))
const search = async(query, kind, page = 1) => {
  const response = await ipcRenderer.invoke('platform_qishui_search', { query, kind, page })
  return {
    ...response,
    source: 'qs',
    allPage: Math.max(1, Math.ceil(response.total / Math.max(1, response.limit))),
    notice: response.limited ? '汽水音乐当前显示搜索联想中的有限结果；登录后可尝试完整搜索。' : '',
  }
}

// Account cookies and signed media URLs stay in the main process. The SDK only
// converts account data to the legacy shape expected by the existing player.
export default {
  // Keep the legacy SDK contract; these categories are excluded from discovery.
  hotSearch: {
    /** @returns {Promise<{source: string, list: string[]}>} */
    getList: unsupported,
  },
  leaderboard: { getBoards: unsupported, getList: unsupported },
  musicSearch: {
    async search(query, page = 1) {
      const response = await search(query, 'track', page)
      return { ...response, list: response.list.map(toOldMusicInfo) }
    },
  },
  songList: {
    sortList: [],
    getTags: unsupported,
    getList: unsupported,
    async search(query, page = 1) {
      const response = await search(query, 'playlist', page)
      return {
        ...response,
        list: response.list.map(item => ({
          source: 'qs',
          id: String(item.id),
          name: item.name,
          img: item.cover,
          author: item.singer || '汽水音乐',
          desc: item.description || '',
          total: item.count == null ? undefined : String(item.count),
          play_count: '',
        })),
      }
    },
    async getListDetail(text, page = 1) {
      const { kind, id } = await ipcRenderer.invoke('platform_qishui_share', { text: String(text) })
      if (kind !== 'playlist') throw new Error('请粘贴汽水音乐歌单链接或歌单 ID。')
      const response = await ipcRenderer.invoke('platform_qishui_playlist', { id })
      const limit = Math.max(1, response.list.length)
      return {
        source: 'qs',
        list: page === 1 ? response.list.map(toOldMusicInfo) : [],
        page,
        limit,
        total: response.list.length,
        info: { name: response.name, img: response.cover, author: '汽水音乐', desc: response.description || '' },
      }
    },
  },
  getMusicUrl(songInfo, type) { return { promise: getPlatformMusicUrl('qs', songInfo, type) } },
  getLyric(songInfo) { return { promise: ipcRenderer.invoke('platform_qishui_lyric', { id: String(songInfo.songmid), ...(songInfo.qishuiMediaType ? { mediaType: songInfo.qishuiMediaType } : {}) }) } },
  getPic(songInfo) { return Promise.resolve(songInfo.img || '') },
  getMusicDetailPageUrl(songInfo) { return `https://www.qishui.com/share/track?track_id=${encodeURIComponent(songInfo.songmid)}` },
}
