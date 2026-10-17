import { effectScope, reactive, watch, type EffectScope } from 'vue'
import { startTimeoutStop, stopTimeoutStop, useTimeout } from '@renderer/core/player/timeoutStop'
import { playMusicInfo, isPlay } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'

export const playerSessionTools = reactive({
  abStart: null as number | null,
  abEnd: null as number | null,
  abEnabled: false,
  sleepDeadline: null as number | null,
  sleepRemaining: 0,
})

let scope: EffectScope | null = null
let lastLoopAt = 0

export function resetABLoop(): void {
  playerSessionTools.abEnabled = false
  playerSessionTools.abStart = null
  playerSessionTools.abEnd = null
  lastLoopAt = 0
}

export function cancelSleepTimer(): void {
  if (useTimeout().time.value >= 0) stopTimeoutStop()
  playerSessionTools.sleepDeadline = null
  playerSessionTools.sleepRemaining = 0
}

/** Own this at the app shell; hiding the player or closing its menu keeps tools active. */
export function initializePlayerSessionTools(): () => void {
  if (!scope) {
    scope = effectScope(true)
    scope.run(() => {
      watch(useTimeout().time, remaining => {
        playerSessionTools.sleepRemaining = Math.max(0, remaining)
        playerSessionTools.sleepDeadline = remaining >= 0 ? Date.now() + remaining * 1000 : null
      }, { immediate: true, flush: 'sync' })
      watch(() => {
        const track = playMusicInfo.musicInfo
        return track ? `${'metadata' in track ? track.metadata.musicInfo.source : track.source}:${track.id}` : ''
      }, resetABLoop, { flush: 'sync' })
      watch(() => playProgress.nowPlayTime, time => {
        const { abEnabled, abStart, abEnd } = playerSessionTools
        if (!abEnabled || !isPlay.value || abStart === null || abEnd === null || time < abEnd) return
        const now = Date.now()
        if (now - lastLoopAt < 300) return
        lastLoopAt = now
        window.app_event.setProgress(abStart)
      }, { flush: 'sync' })
    })
  }
  return disposePlayerSessionTools
}

export function disposePlayerSessionTools(): void {
  scope?.stop()
  scope = null
  resetABLoop()
  cancelSleepTimer()
}

export function setABPoint(point: 'a' | 'b', seconds = playProgress.nowPlayTime): void {
  initializePlayerSessionTools()
  if (!playMusicInfo.musicInfo || !Number.isFinite(seconds) || seconds < 0) throw new Error('播放歌曲后才能设置循环片段。')
  const maximum = playProgress.maxPlayTime
  const time = maximum > 0 ? Math.min(seconds, maximum) : seconds
  if (point === 'a') {
    playerSessionTools.abStart = time
    if (playerSessionTools.abEnd !== null && playerSessionTools.abEnd - time < 0.25) {
      playerSessionTools.abEnd = null
      playerSessionTools.abEnabled = false
    }
  } else {
    if (playerSessionTools.abStart === null) throw new Error('请先设置 A 起点。')
    if (time - playerSessionTools.abStart < 0.25) throw new Error('B 终点需晚于 A 起点至少 0.25 秒。')
    playerSessionTools.abEnd = time
    playerSessionTools.abEnabled = true
  }
  lastLoopAt = 0
}

export function setABEnabled(enabled: boolean): void {
  initializePlayerSessionTools()
  if (enabled && (playerSessionTools.abStart === null || playerSessionTools.abEnd === null)) throw new Error('请先设置 A 起点和 B 终点。')
  playerSessionTools.abEnabled = enabled
  lastLoopAt = 0
}

export function startSleepTimer(minutes: number): void {
  initializePlayerSessionTools()
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error('请输入 1 到 1440 分钟。')
  cancelSleepTimer()
  startTimeoutStop(Math.round(minutes * 60))
}
