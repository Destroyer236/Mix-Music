import { getAutoplay, getResourceTime, isEmpty, setPause, setPlay, setResource, setStop } from '@renderer/plugins/player'
import { isPlay, playedList, playInfo, playMusicInfo, tempPlayList, musicInfo as _musicInfo } from '@renderer/store/player/state'
import {
  getList,
  clearPlayedList,
  clearTempPlayeList,
  setPlayMusicInfo,
  addPlayedList,
  setMusicInfo,
  setAllStatus,
  removeTempPlayList,
  setPlayListId,
  removePlayedList,
} from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getMusicUrl, getPicPath, getLyricInfo } from '../music/index'
import { filterList } from './utils'
import { requestMsg } from '@renderer/utils/message'
import { getRandom } from '@renderer/utils/index'
import { requestFavorite } from '@renderer/ui/services/platformAccounts'
import { activeStream, commitStream, preferredQuality, preferredSource, rejectCurrentPlaybackUrl, resetPlaybackFailures } from '@renderer/ui/services/platformPlayback'
import { addDislikeInfo } from '@renderer/core/dislikeList'
import { samePlayTrack } from '@common/platformMatching'
import { ensureQueueContinuation, filterQueueContinuation, notifyQueueContinuation } from './queueContinuation'
import { notifyPlaybackIntent } from './playbackIntent'
import { watch } from 'vue'
import { repeatMode } from '@renderer/store/player/repeatMode'
// import { checkMusicFileAvailable } from '@renderer/utils/music'

let gettingUrlId = ''
let resourceGeneration = 0
let navigationGeneration = 0
let recoveringResource: { track: LX.Music.MusicInfo | LX.Download.ListItem, promise: Promise<boolean> } | null = null
const createGettingUrlId = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const tInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.toggleMusicInfo : musicInfo.meta.toggleMusicInfo
  return `${'progress' in musicInfo ? 'download' : musicInfo.source}:${musicInfo.id}_${tInfo?.id ?? ''}_${preferredQuality.value}_${preferredSource.value}`
}
const createDelayNextTimeout = (delay: number) => {
  let timeout: NodeJS.Timeout | null
  const clearDelayNextTimeout = () => {
    // console.log(this.timeout)
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    timeout = setTimeout(() => {
      timeout = null
      if (window.lx.isPlayedStop) return
      console.warn('delay next timeout timeout', delay)
      void playNext(true)
    }, delay)
  }

  return {
    clearDelayNextTimeout,
    addDelayNextTimeout,
  }
}
const { addDelayNextTimeout, clearDelayNextTimeout } = createDelayNextTimeout(5000)
const { addDelayNextTimeout: addLoadTimeout, clearDelayNextTimeout: clearLoadTimeout } = createDelayNextTimeout(100000)

/**
 * 检查音乐信息是否已更改
 */
const diffCurrentMusicInfo = (curMusicInfo: LX.Music.MusicInfo | LX.Download.ListItem): boolean => {
  // return curMusicInfo !== playMusicInfo.musicInfo || isPlay.value
  return gettingUrlId != createGettingUrlId(curMusicInfo) || curMusicInfo !== playMusicInfo.musicInfo || isPlay.value
}

let cancelDelayRetry: (() => void) | null = null
const delayRetry = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false): Promise<string | null> => {
  // if (cancelDelayRetry) cancelDelayRetry()
  return new Promise<string | null>((resolve, reject) => {
    const time = getRandom(2, 6)
    setAllStatus(window.i18n.t('player__getting_url_delay_retry', { time }), true)
    const tiemout = setTimeout(() => {
      getMusicPlayUrl(musicInfo, isRefresh, true).then((result) => {
        cancelDelayRetry = null
        resolve(result)
      }).catch(async(err: any) => {
        cancelDelayRetry = null
        reject(err)
      })
    }, time * 1000)
    cancelDelayRetry = () => {
      clearTimeout(tiemout)
      cancelDelayRetry = null
      resolve(null)
    }
  })
}
const getMusicPlayUrl = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, isRetryed = false): Promise<string | null> => {
  // this.musicInfo.url = await getMusicPlayUrl(targetSong, type)
  setAllStatus(window.i18n.t('player__getting_url'), true)
  if (appSetting['player.autoSkipOnError']) addLoadTimeout()

  // const type = getPlayType(appSetting['player.highQuality'], musicInfo)
  let toggleMusicInfo = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo
  if (!('progress' in musicInfo) && musicInfo.source !== 'local') toggleMusicInfo = null

  return (toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    isRefresh,
    allowToggleSource: false,
  }) : Promise.reject(new Error('not found'))).catch(async() => {
    return getMusicUrl({
      musicInfo,
      isRefresh,
      onToggleSource(mInfo) {
        if (diffCurrentMusicInfo(musicInfo)) return
        setAllStatus(window.i18n.t('toggle_source_try'), true)
      },
    })
  }).then(url => {
    if (window.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return null

    return url
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch(err => {
    // console.log('err', err.message)
    if (window.lx.isPlayedStop ||
      diffCurrentMusicInfo(musicInfo) ||
      err.message == requestMsg.cancelRequest) return null

    if (err.message == requestMsg.tooManyRequests) return delayRetry(musicInfo, isRefresh)

    if (!isRetryed) return getMusicPlayUrl(musicInfo, isRefresh, true)

    throw err
  })
}

export const setMusicUrl = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh?: boolean) => {
  // if (appSetting['player.autoSkipOnError']) addLoadTimeout()
  if (!diffCurrentMusicInfo(musicInfo)) return
  resetPlaybackFailures()
  recoveringResource = null
  if (cancelDelayRetry) cancelDelayRetry()
  gettingUrlId = createGettingUrlId(musicInfo)
  const generation = ++resourceGeneration
  const requested = preferredQuality.value
  void getMusicPlayUrl(musicInfo, isRefresh).then((url) => {
    if (!url || generation !== resourceGeneration) return
    commitStream(musicInfo, url, requested)
    setResource(url)
  }).catch((err: any) => {
    if (generation !== resourceGeneration) return
    console.log(err)
    setAllStatus(err.message, false)
    window.app_event.error()
    if (appSetting['player.autoSkipOnError']) addDelayNextTimeout()
  }).finally(() => {
    if (generation === resourceGeneration && musicInfo === playMusicInfo.musicInfo) {
      gettingUrlId = ''
      clearLoadTimeout()
    }
  })
}

export const reloadCurrentQuality = async(): Promise<void> => {
  const track = playMusicInfo.musicInfo
  if (!track || 'progress' in track || track.source === 'local') return
  resetPlaybackFailures()
  recoveringResource = null
  const generation = ++resourceGeneration
  const quality = preferredQuality.value
  const source = preferredSource.value
  setAllStatus('正在切换播放资源…', true)
  try {
    const url = await getMusicUrl({ musicInfo: track, isRefresh: true })
    if (generation !== resourceGeneration || track !== playMusicInfo.musicInfo || quality !== preferredQuality.value || source !== preferredSource.value) return
    const resume = getAutoplay()
    const time = getResourceTime()
    setPause()
    commitStream(track, url, quality)
    // A short official preview cannot resume a full song's later position.
    setResource(url, { time: activeStream.value?.isTrial ? 0 : time, autoplay: resume })
    if (!resume) setAllStatus('', false)
  } catch (error) {
    if (generation === resourceGeneration) setAllStatus(error instanceof Error ? error.message : '音质切换失败', false)
    throw error
  }
}

/** Retry a media/HTTP failure with a new resource, retaining playback intent. */
export const recoverCurrentResource = async(): Promise<boolean> => {
  const track = playMusicInfo.musicInfo
  if (!track || 'progress' in track || track.source === 'local') return false
  if (recoveringResource?.track === track) return recoveringResource.promise
  const rejectedUrls = rejectCurrentPlaybackUrl(track)
  if (!rejectedUrls) return false
  const generation = ++resourceGeneration
  const quality = preferredQuality.value
  const source = preferredSource.value
  // Capture position before detaching the failed resource. Keeping autoplay on
  // the element lets an intervening Pause remain authoritative while resolving.
  const time = getResourceTime()
  const current = () => generation === resourceGeneration && track === playMusicInfo.musicInfo && quality === preferredQuality.value && source === preferredSource.value && !window.lx.isPlayedStop
  setStop()
  setAllStatus(window.i18n.t('player__refresh_url'), true)
  const promise = (async() => {
    try {
      const url = await getMusicUrl({ musicInfo: track, isRefresh: true, rejectedUrls })
      if (!current()) return true
      if (rejectedUrls.includes(url)) return false
      const resume = getAutoplay()
      commitStream(track, url, quality)
      setResource(url, { time: activeStream.value?.isTrial ? 0 : time, autoplay: resume })
      if (activeStream.value?.isTrial) window.app_event.setProgress(0)
      if (!resume) {
        setAllStatus('', false)
        // A replacement that stays paused may not emit another native Pause.
        window.app_event.pause()
      }
      return true
    } catch (error) {
      if (!current()) return true
      setAllStatus(error instanceof Error ? error.message : '无法找到其他可播放音源', false)
      return false
    } finally {
      if (generation === resourceGeneration) recoveringResource = null
    }
  })()
  recoveringResource = { track, promise }
  return promise
}

// 恢复上次播放的状态
const handleRestorePlay = async(restorePlayInfo: LX.Player.SavedPlayInfo) => {
  const musicInfo = playMusicInfo.musicInfo
  if (!musicInfo) return

  activeStream.value = null

  setImmediate(() => {
    if (musicInfo !== playMusicInfo.musicInfo) return
    window.app_event.setProgress(appSetting['player.isSavePlayTime'] ? restorePlayInfo.time : 0, restorePlayInfo.maxTime)
    window.app_event.pause()
  })


  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (musicInfo !== playMusicInfo.musicInfo || url == _musicInfo.pic) return
    setMusicInfo({ pic: url })
    window.app_event.picUpdated()
  }).catch(_ => _)

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo !== playMusicInfo.musicInfo) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    window.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo !== playMusicInfo.musicInfo) return
    setAllStatus(window.i18n.t('lyric__load_error'))
  })

  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...playMusicInfo as LX.Player.PlayMusicInfo })
}


// 处理音乐播放
const handlePlay = () => {
  window.lx.isPlayedStop &&= false

  removedQueueTrack = null
  resetRandomNextMusicInfo()
  if (window.lx.restorePlayInfo) {
    void handleRestorePlay(window.lx.restorePlayInfo)
    window.lx.restorePlayInfo = null
    return
  }
  const musicInfo = playMusicInfo.musicInfo

  if (!musicInfo) return
  resetPlaybackFailures()
  recoveringResource = null

  notifyQueueContinuation()

  setStop()
  window.app_event.pause()

  clearDelayNextTimeout()
  clearLoadTimeout()


  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...(playMusicInfo as LX.Player.PlayMusicInfo) })

  setMusicUrl(musicInfo)

  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (musicInfo !== playMusicInfo.musicInfo || url == _musicInfo.pic) return
    setMusicInfo({ pic: url })
    window.app_event.picUpdated()
  }).catch(_ => _)

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo !== playMusicInfo.musicInfo) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    window.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo !== playMusicInfo.musicInfo) return
    setAllStatus(window.i18n.t('lyric__load_error'))
  })
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param id 歌曲id
 */
export const playListById = (listId: string, id: string) => {
  const musicInfo = getList(listId).find(m => m.id == id)
  if (!musicInfo) return
  notifyPlaybackIntent(listId)
  navigationGeneration++
  const prevListId = playInfo.playerListId
  setPlayListId(listId)
  // pause()
  setPlayMusicInfo(listId, musicInfo)
  if (appSetting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  handlePlay()
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param index 播放的歌曲位置
 */
export const playList = (listId: string, index: number) => {
  const musicInfo = getList(listId)[index]
  if (!musicInfo) return
  notifyPlaybackIntent(listId)
  navigationGeneration++
  const prevListId = playInfo.playerListId
  setPlayListId(listId)
  // pause()
  setPlayMusicInfo(listId, musicInfo)
  if (appSetting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  handlePlay()
}

const handleToggleStop = () => {
  stop()
  const generation = navigationGeneration
  setTimeout(() => {
    if (generation === navigationGeneration) setPlayMusicInfo(null, null)
  })
}

const randomNextMusicInfo = {
  info: null as LX.Player.PlayMusicInfo | null,
  // index: -1,
}
export const resetRandomNextMusicInfo = () => {
  navigationGeneration++
  if (randomNextMusicInfo.info) {
    randomNextMusicInfo.info = null
    // randomNextMusicInfo.index = -1
  }
}

watch([() => appSetting['player.togglePlayMethod'], repeatMode], resetRandomNextMusicInfo, { flush: 'sync' })

let removedQueueTrack: LX.Player.PlayMusicInfo | null = null
/** Keep a removed playing resource alive, but resume the queue after it ends. */
export const detachCurrentQueueTrack = () => {
  removedQueueTrack = playMusicInfo.musicInfo ? { ...(playMusicInfo as LX.Player.PlayMusicInfo) } : null
}
const isDetachedQueueTrack = () => removedQueueTrack?.musicInfo === playMusicInfo.musicInfo && removedQueueTrack?.listId === playMusicInfo.listId
const getAutomaticRepeatTrack = (): LX.Player.PlayMusicInfo | null => {
  const mode = appSetting['player.togglePlayMethod']
  if (!playMusicInfo.musicInfo || isDetachedQueueTrack() || (mode === 'random' ? repeatMode.value !== 'singleLoop' : mode !== 'singleLoop')) return null
  return { ...(playMusicInfo as LX.Player.PlayMusicInfo) }
}
const filterNextQueue = async(currentListId: string, currentList: Array<LX.Music.MusicInfo | LX.Download.ListItem>, generation: number) => {
  const isRandomOnce = appSetting['player.togglePlayMethod'] === 'random' && repeatMode.value === 'list'
  let result = await filterList({
    listId: currentListId,
    list: currentList,
    // Preserve the completed cycle in repeat-off mode instead of resetting it.
    playedList: isRandomOnce ? [] : playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
    valid: () => generation === navigationGeneration,
  })
  if (isRandomOnce) result.filteredList = result.filteredList.filter(track => !playedList.some(entry => entry.listId === currentListId && !entry.isTempPlay && samePlayTrack(entry.musicInfo, track)))
  return result
}

export const getNextPlayMusicInfo = async(): Promise<LX.Player.PlayMusicInfo | null> => {
  const generation = navigationGeneration
  if (tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
    const playMusicInfo = tempPlayList[0]
    return playMusicInfo
  }

  if (playMusicInfo.musicInfo == null) return null

  const repeated = getAutomaticRepeatTrack()
  if (repeated) return repeated

  if (!await ensureQueueContinuation() || generation !== navigationGeneration) return null

  if (randomNextMusicInfo.info) return randomNextMusicInfo.info

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return null
  const currentList = getList(currentListId)

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    const currentTrack = playMusicInfo.isTempPlay ? currentList[playInfo.playerPlayIndex] : playMusicInfo.musicInfo
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => currentTrack && samePlayTrack(m.musicInfo, currentTrack)) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      if (playMusicInfo.listId == currentListId && !currentList.some(m => samePlayTrack(m, playMusicInfo.musicInfo))) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) return playedList[index]
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterNextQueue(currentListId, currentList, generation)
  if (generation !== navigationGeneration) return null

  filteredList = filterQueueContinuation(filteredList)

  if (!filteredList.length) return null
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  let nextIndex = Math.max(0, playerIndex)

  let togglePlayMethod = appSetting['player.togglePlayMethod']
  if (togglePlayMethod === 'singleLoop' && isDetachedQueueTrack()) togglePlayMethod = 'listLoop'
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      return null
  }
  if (nextIndex < 0) return null

  const nextPlayMusicInfo = {
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  }

  if (togglePlayMethod == 'random') {
    randomNextMusicInfo.info = nextPlayMusicInfo
    // randomNextMusicInfo.index = nextIndex
  }
  return nextPlayMusicInfo
}

const handlePlayNext = (playMusicInfo: LX.Player.PlayMusicInfo) => {
  // pause()
  setPlayMusicInfo(playMusicInfo.listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
  handlePlay()
}
/**
 * 下一曲
 * @param isAutoToggle 是否自动切换
 * @returns
 */
export const playNext = async(isAutoToggle = false): Promise<void> => {
  const generation = ++navigationGeneration
  console.log('skip next', isAutoToggle)
  if (tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
    const playMusicInfo = tempPlayList[0]
    removeTempPlayList(0)
    handlePlayNext(playMusicInfo)
    console.log('play temp list')
    return
  }

  if (playMusicInfo.musicInfo == null) {
    handleToggleStop()
    console.log('musicInfo empty')
    return
  }

  const repeated = isAutoToggle ? getAutomaticRepeatTrack() : null
  if (repeated) {
    handlePlayNext(repeated)
    return
  }

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) {
    handleToggleStop()
    console.log('currentListId empty')
    return
  }
  const canContinue = await ensureQueueContinuation(!isAutoToggle)
  if (generation !== navigationGeneration) return
  if (!canContinue) {
    pause()
    setAllStatus('新的推荐暂时无法加载，请稍后点击下一首重试。', false)
    return
  }
  const currentList = getList(currentListId)

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    const currentTrack = playMusicInfo.isTempPlay ? currentList[playInfo.playerPlayIndex] : playMusicInfo.musicInfo
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => currentTrack && samePlayTrack(m.musicInfo, currentTrack)) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      if (playMusicInfo.listId == currentListId && !currentList.some(m => samePlayTrack(m, playMusicInfo.musicInfo))) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) {
      handlePlayNext(playedList[index])
      console.log('play played list')
      return
    }
  }
  if (randomNextMusicInfo.info) {
    handlePlayNext(randomNextMusicInfo.info)
    return
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterNextQueue(currentListId, currentList, generation)
  if (generation !== navigationGeneration) return

  filteredList = filterQueueContinuation(filteredList)

  if (!filteredList.length) {
    if (appSetting['player.togglePlayMethod'] === 'random' && repeatMode.value === 'list' && currentList.length) {
      pause()
      return
    }
    handleToggleStop()
    console.log('filtered list empty')
    return
  }
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  let nextIndex = Math.max(0, playerIndex)

  let togglePlayMethod = appSetting['player.togglePlayMethod']
  if (togglePlayMethod === 'singleLoop' && isDetachedQueueTrack()) togglePlayMethod = 'listLoop'
  if (!isAutoToggle) {
    switch (togglePlayMethod) {
      case 'list':
      case 'singleLoop':
      case 'none':
        togglePlayMethod = 'listLoop'
    }
  }
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      nextIndex = -1
      console.log('stop toggle play', togglePlayMethod, isAutoToggle)
      pause()
      return
  }
  if (nextIndex < 0) {
    console.log('next index empty')
    pause()
    return
  }

  handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 上一曲
 */
export const playPrev = async(isAutoToggle = false): Promise<void> => {
  const generation = ++navigationGeneration
  if (playMusicInfo.musicInfo == null) {
    handleToggleStop()
    return
  }

  const currentListId = playInfo.playerListId
  if (!currentListId) {
    handleToggleStop()
    return
  }
  const currentList = getList(currentListId)

  if (playedList.length) {
    const currentTrack = playMusicInfo.isTempPlay ? currentList[playInfo.playerPlayIndex] : playMusicInfo.musicInfo
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => currentTrack && samePlayTrack(m.musicInfo, currentTrack)) - 1; index > -1; index--) {
      const playMusicInfo = playedList[index]
      if (playMusicInfo.listId == currentListId && !currentList.some(m => samePlayTrack(m, playMusicInfo.musicInfo))) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index > -1) {
      handlePlayNext(playedList[index])
      return
    }
  }

  // const isCheckFile = findNum > 2
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: false,
    valid: () => generation === navigationGeneration,
  })
  if (generation !== navigationGeneration) return
  if (!filteredList.length) {
    handleToggleStop()
    return
  }

  // let currentIndex = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  let nextIndex = Math.max(0, playerIndex)
  if (!playMusicInfo.isTempPlay) {
    let togglePlayMethod = appSetting['player.togglePlayMethod']
    if (!isAutoToggle) {
      switch (togglePlayMethod) {
        case 'list':
        case 'singleLoop':
        case 'none':
          togglePlayMethod = 'listLoop'
      }
    }
    switch (togglePlayMethod) {
      case 'random':
        nextIndex = getRandom(0, filteredList.length)
        break
      case 'listLoop':
      case 'list':
        nextIndex = playerIndex <= 0 ? filteredList.length - 1 : playerIndex - 1
        break
      case 'singleLoop':
        break
      default:
        nextIndex = -1
        return
    }
    if (nextIndex < 0) return
  }

  handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 恢复播放
 */
export const play = () => {
  window.lx.isPlayedStop &&= false
  if (playMusicInfo.musicInfo == null) return
  notifyQueueContinuation()
  if (isEmpty()) {
    if (createGettingUrlId(playMusicInfo.musicInfo) != gettingUrlId) setMusicUrl(playMusicInfo.musicInfo)
    return
  }
  setPlay()
}

/**
 * 暂停播放
 */
export const pause = () => {
  navigationGeneration++
  setPause()
}

/**
 * 停止播放
 */
export const stop = () => {
  navigationGeneration++
  ++resourceGeneration
  gettingUrlId = ''
  cancelDelayRetry?.()
  clearDelayNextTimeout()
  clearLoadTimeout()
  activeStream.value = null
  resetPlaybackFailures()
  recoveringResource = null
  setStop()
  setTimeout(() => {
    window.app_event.stop()
  })
}

/**
 * 播放、暂停播放切换
 */
export const togglePlay = () => {
  window.lx.isPlayedStop &&= false
  if (isPlay.value) {
    pause()
  } else {
    play()
  }
}

/**
 * 收藏当前播放的歌曲
 */
export const collectMusic = () => {
  if (!playMusicInfo.musicInfo) return
  requestFavorite('progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo, true)
}

/**
 * 取消收藏当前播放的歌曲
 */
export const uncollectMusic = () => {
  if (!playMusicInfo.musicInfo) return
  requestFavorite('progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo, false)
}

/**
 * 不喜欢当前播放的歌曲
 */
export const dislikeMusic = async() => {
  if (!playMusicInfo.musicInfo) return
  const minfo = 'progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo
  await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
  await playNext(true)
}
