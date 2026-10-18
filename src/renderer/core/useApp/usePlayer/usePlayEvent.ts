import { onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { isPlay, musicInfo, playMusicInfo } from '@renderer/store/player/state'
import { getAutoplay, setStop, isEmpty } from '@renderer/plugins/player'
import { playNext, recoverCurrentResource, setMusicUrl } from '@renderer/core/player'
import { setAllStatus } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'

export default () => {
  const t = useI18n()
  let retryNum = 0
  let errorGeneration = 0
  const errorRecovery = { pending: false }
  let prevTimeoutId: string | null = null

  let loadingTimeout: NodeJS.Timeout | null = null
  let delayNextTimeout: NodeJS.Timeout | null = null
  const startLoadingTimeout = () => {
    // console.log('start load timeout')
    clearLoadingTimeout()
    loadingTimeout = setTimeout(() => {
      if (window.lx.isPlayedStop || !getAutoplay()) {
        prevTimeoutId = null
        setAllStatus('', false)
        return
      }

      // 如果加载超时，则尝试刷新URL
      const track = playMusicInfo.musicInfo
      if (track && !('progress' in track) && track.source !== 'local') { void handleError(2); return }
      if (prevTimeoutId == musicInfo.id) {
        prevTimeoutId = null
        void playNext(true)
      } else {
        prevTimeoutId = musicInfo.id
        if (playMusicInfo.musicInfo) setMusicUrl(playMusicInfo.musicInfo, true)
      }
    }, 25000)
  }
  const clearLoadingTimeout = () => {
    if (!loadingTimeout) return
    // console.log('clear load timeout')
    clearTimeout(loadingTimeout)
    loadingTimeout = null
  }

  const clearDelayNextTimeout = () => {
    // console.log(this.delayNextTimeout)
    if (!delayNextTimeout) return
    clearTimeout(delayNextTimeout)
    delayNextTimeout = null
  }
  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    delayNextTimeout = setTimeout(() => {
      if (window.lx.isPlayedStop || !getAutoplay()) {
        setAllStatus('', false)
        return
      }
      void playNext(true)
    }, 5000)
  }

  const handleLoadstart = () => {
    if (window.lx.isPlayedStop) return
    if (appSetting['player.autoSkipOnError'] && getAutoplay()) startLoadingTimeout()
    setAllStatus(t('player__loading'), true)
  }

  const handleLoadeddata = () => {
    setAllStatus(t('player__loading'), true)
  }

  const handlePlaying = () => {
    setAllStatus('', false)
    clearLoadingTimeout()
  }

  const handleCanplay = () => {
    clearLoadingTimeout()
    clearDelayNextTimeout()
    if (!isPlay.value) setAllStatus('', false)
  }

  const handlePause = () => {
    if (getAutoplay()) return
    clearLoadingTimeout()
    clearDelayNextTimeout()
  }

  const handleEmpied = () => {
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  const handleWating = () => {
    setAllStatus(t('player__buffering'), true)
  }

  const handleError = async(errCode?: number) => {
    if (!musicInfo.id) return
    clearLoadingTimeout()
    if (window.lx.isPlayedStop) return
    if (errorRecovery.pending) return
    const track = playMusicInfo.musicInfo
    const generation = errorGeneration
    if (track && !('progress' in track) && track.source !== 'local' && errCode !== 1) {
      errorRecovery.pending = true
      let recovered = false
      try { recovered = await recoverCurrentResource() } finally { if (generation === errorGeneration) errorRecovery.pending = false }
      if (generation !== errorGeneration || track !== playMusicInfo.musicInfo || recovered || window.lx.isPlayedStop) return
    }
    const resume = getAutoplay()
    if (!isEmpty()) setStop()
    if (!resume) { setAllStatus(t('player__error'), false); return }
    if (track && ('progress' in track || track.source === 'local') && errCode !== 1 && retryNum < 2) {
      // console.log(this.retryNum)
      retryNum++
      setMusicUrl(track, true)
      setAllStatus(t('player__refresh_url'), true)
      return
    }

    if (appSetting['player.autoSkipOnError']) {
      if (document.hidden) {
        console.warn('error skip to next')
        void playNext(true)
      } else {
        setAllStatus(t('player__error'), false)
        setTimeout(addDelayNextTimeout)
      }
    }
  }

  const handleSetPlayInfo = () => {
    retryNum = 0
    errorGeneration++
    errorRecovery.pending = false
    prevTimeoutId = null
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  // const handlePlayedStop = () => {
  //   clearDelayNextTimeout()
  //   clearLoadingTimeout()
  // }


  window.app_event.on('playerLoadstart', handleLoadstart)
  window.app_event.on('playerLoadeddata', handleLoadeddata)
  window.app_event.on('playerPlaying', handlePlaying)
  window.app_event.on('playerCanplay', handleCanplay)
  window.app_event.on('playerPause', handlePause)
  window.app_event.on('playerWaiting', handleWating)
  window.app_event.on('playerEmptied', handleEmpied)
  window.app_event.on('playerError', handleError)
  window.app_event.on('musicToggled', handleSetPlayInfo)

  onBeforeUnmount(() => {
    window.app_event.off('playerLoadstart', handleLoadstart)
    window.app_event.off('playerLoadeddata', handleLoadeddata)
    window.app_event.off('playerPlaying', handlePlaying)
    window.app_event.off('playerCanplay', handleCanplay)
    window.app_event.off('playerPause', handlePause)
    window.app_event.off('playerWaiting', handleWating)
    window.app_event.off('playerEmptied', handleEmpied)
    window.app_event.off('playerError', handleError)
    window.app_event.off('musicToggled', handleSetPlayInfo)
  })
}
