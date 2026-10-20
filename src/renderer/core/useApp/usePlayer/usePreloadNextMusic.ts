import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { onTimeupdate, getCurrentTime } from '@renderer/plugins/player'
import { playProgress } from '@renderer/store/player/playProgress'
import { musicInfo } from '@renderer/store/player/state'
// import { getList } from '@renderer/store/utils'
import { getNextPlayMusicInfo, resetRandomNextMusicInfo } from '@renderer/core/player'
import { getMusicUrl } from '@renderer/core/music'
import { appSetting } from '@renderer/store/setting'
import { repeatMode } from '@renderer/store/player/repeatMode'

let audio: HTMLAudioElement
let cancelProbe: (() => void) | undefined
const initAudio = () => {
  if (audio) return
  audio = new Audio()
  audio.controls = false
  // This element is only used to validate the next stream.  The media
  // resource is released as soon as the check finishes below, so the player
  // can still receive a reliable `canplay` signal without retaining a second
  // track buffer.
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  audio.muted = true
  audio.volume = 0
  audio.autoplay = true
  audio.addEventListener('playing', () => {
    audio.pause()
  })
}
const checkMusicUrl = async(url: string): Promise<boolean> => {
  initAudio()
  // A failed resolver can return an empty URL. Avoid attaching listeners to
  // the singleton probe in that case, because no media event would resolve
  // the promise and the preload state would remain stuck forever.
  if (!url) return false
  return new Promise((resolve) => {
    const release = () => {
      if (!audio) return
      audio.pause()
      // Drop the probe's media resource as soon as the availability check is
      // complete.  The URL is resolved again by the player when the track is
      // actually selected, so retaining this buffer only increases memory
      // pressure.
      audio.removeAttribute('src')
      audio.load()
    }
    const clear = () => {
      clearTimeout(timer)
      cancelProbe = undefined
      audio.removeEventListener('error', handleErr)
      audio.removeEventListener('canplay', handlePlay)
    }
    const handleErr = () => {
      const isAborted = audio?.error?.code === 1
      clear()
      release()
      resolve(isAborted)
    }
    const handlePlay = () => {
      clear()
      release()
      resolve(true)
    }
    const cancel = () => { clear(); release(); resolve(false) }
    const timer = setTimeout(cancel, 8000)
    cancelProbe = cancel
    audio.addEventListener('error', handleErr)
    audio.addEventListener('canplay', handlePlay)
    audio.src = url
    audio.load()
  })
}

const preloadMusicInfo = {
  isLoading: false,
  preProgress: 0,
  info: null as LX.Player.PlayMusicInfo | null,
  readyAt: 0,
}
let preloadGeneration = 0
const resetPreloadInfo = () => {
  preloadGeneration++
  cancelProbe?.()
  preloadMusicInfo.preProgress = 0
  preloadMusicInfo.info = null
  preloadMusicInfo.isLoading = false
  preloadMusicInfo.readyAt = 0
}
const preloadNextMusicUrl = async(curTime: number) => {
  if (preloadMusicInfo.isLoading || curTime - preloadMusicInfo.preProgress < 3) return
  preloadMusicInfo.isLoading = true
  preloadMusicInfo.preProgress = curTime
  const generation = preloadGeneration
  console.log('preload next music url')
  try {
    const info = await getNextPlayMusicInfo()
    if (generation !== preloadGeneration) return
    if (info) {
      const url = await getMusicUrl({ musicInfo: info.musicInfo }).catch(() => '')
      if (generation !== preloadGeneration) return
      if (url) {
        console.log('preload url', url)
        const result = await checkMusicUrl(url)
        if (generation !== preloadGeneration) return
        if (result) {
          preloadMusicInfo.info = info
          preloadMusicInfo.readyAt = Date.now()
        } else {
          const refreshUrl = await getMusicUrl({ musicInfo: info.musicInfo, isRefresh: true }).catch(() => '')
          if (generation !== preloadGeneration) return
          const refreshed = await checkMusicUrl(refreshUrl)
          if (generation !== preloadGeneration) return
          if (refreshed) {
            preloadMusicInfo.info = info
            preloadMusicInfo.readyAt = Date.now()
          }
          console.log('preload url refresh', refreshUrl)
        }
      }
    }
  } catch (error) {
    // Preloading is opportunistic. Keep playback responsive and allow the
    // next progress window to retry after a transient resolver failure.
    console.warn('preload next music failed', error)
  } finally {
    if (generation === preloadGeneration) preloadMusicInfo.isLoading = false
  }
}

export default () => {
  const setProgress = (time: number) => {
    if (!musicInfo.id) return
    preloadMusicInfo.preProgress = time
  }

  const handleSetPlayInfo = () => {
    resetPreloadInfo()
  }

  watch([() => appSetting['player.togglePlayMethod'], () => appSetting['player.playQuality'], () => appSetting['player.preferredSource'], repeatMode], () => {
    resetRandomNextMusicInfo()
    resetPreloadInfo()
    preloadMusicInfo.preProgress = playProgress.nowPlayTime
  }, { flush: 'sync' })

  window.app_event.on('setProgress', setProgress)
  window.app_event.on('musicToggled', handleSetPlayInfo)

  const rOnTimeupdate = onTimeupdate(() => {
    const time = getCurrentTime()
    const duration = playProgress.maxPlayTime
    // Give public sources their full resolution budget while this track is
    // playing, including manual skips. Refresh before the four-minute cache
    // expires on long tracks.
    if (preloadMusicInfo.info && Date.now() - preloadMusicInfo.readyAt >= 180000) preloadMusicInfo.info = null
    if (duration > 10 && time >= Math.min(15, duration / 2) && !preloadMusicInfo.info) {
      void preloadNextMusicUrl(time)
    }
  })


  onBeforeUnmount(() => {
    resetPreloadInfo()
    rOnTimeupdate()
    window.app_event.off('setProgress', setProgress)
    window.app_event.off('musicToggled', handleSetPlayInfo)
  })
}
