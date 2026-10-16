import { ipcRenderer } from 'electron'
import { ref, watch } from 'vue'
import type { PlatformHeartbeatResult } from '@common/platformAccounts'
import { SESSION_PLAYBACK_QUEUE_PREFIX } from '@renderer/core/player/playbackIntent'
import { playInfo, playMusicInfo } from '@renderer/store/player/state'
import { appSetting, mergeSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import { initializePlatformAccounts, platformSnapshot } from './platformAccounts'
import { playTracks, reservePlaybackRequest, type PlaybackRequest } from './music'

export const heartbeatActive = ref(false)
export const heartbeatLoading = ref(false)

export interface HeartbeatNotice {
  message: string
  kind: 'success' | 'warning' | 'info'
}

let request: PlaybackRequest | null = null
let accountId = ''
let queueId = ''
let queueSequence = 0
let stopWatching: (() => void) | null = null

const neteaseAccountId = () => {
  const account = platformSnapshot.value.accounts.find(account => account.platform === 'netease')
  return account?.connected ? account.profile?.id ?? '' : ''
}

/** Leaving this mode keeps the delivered queue and current song intact. */
function exitHeartbeat() {
  const previous = request
  request = null
  accountId = ''
  queueId = ''
  heartbeatActive.value = false
  heartbeatLoading.value = false
  previous?.cancel()
}

function observeHeartbeat() {
  if (stopWatching) return
  const stopAccount = watch(neteaseAccountId, next => {
    if (accountId && next !== accountId) exitHeartbeat()
  }, { flush: 'sync' })
  const stopOrder = watch(() => appSetting['player.togglePlayMethod'], method => {
    if (request && method !== 'listLoop' && method !== 'singleLoop') exitHeartbeat()
  }, { flush: 'sync' })
  const checkQueue = () => {
    if (heartbeatActive.value && playInfo.playerListId !== queueId) exitHeartbeat()
  }
  const stopQueue = watch(() => playInfo.playerListId, checkQueue, { flush: 'sync' })
  stopWatching = () => {
    stopAccount()
    stopOrder()
    stopQueue()
    stopWatching = null
  }
}

/** Start an account-bound NetEase intelligence queue or leave the current session. */
export async function toggleHeartbeat(): Promise<HeartbeatNotice | undefined> {
  observeHeartbeat()
  if (heartbeatActive.value || heartbeatLoading.value) {
    exitHeartbeat()
    return { message: '已退出心动模式', kind: 'info' }
  }

  const currentRequest = reservePlaybackRequest(exitHeartbeat)
  request = currentRequest
  heartbeatLoading.value = true
  const valid = () => currentRequest.isCurrent() && request === currentRequest && (!accountId || neteaseAccountId() === accountId)
  try {
    await initializePlatformAccounts()
    if (!valid()) return
    accountId = neteaseAccountId()
    if (!accountId) {
      exitHeartbeat()
      return { message: '登录网易云音乐后才能使用心动模式', kind: 'warning' }
    }
    const track = playMusicInfo.musicInfo
    const seedId = track && 'meta' in track && track.source === 'wy' ? track.meta.songId : undefined
    const result = await ipcRenderer.invoke('platform_netease_heartbeat', { seedId }) as PlatformHeartbeatResult
    if (!valid()) return
    if (result.accountId !== accountId) throw new Error('网易云音乐账号已变化，请重新开启心动模式')
    if (!result.tracks.length) throw new Error('网易云暂时没有返回心动歌曲，请稍后重试')
    queueId = `${SESSION_PLAYBACK_QUEUE_PREFIX}heartbeat_${++queueSequence}`
    let playbackSetting: Pick<LX.AppSetting, 'player.togglePlayMethod'> = { 'player.togglePlayMethod': 'listLoop' }
    const played = await playTracks(result.tracks, 0, undefined, undefined, {
      request: currentRequest,
      valid,
      queueId,
      memoryQueue: true,
      beforePlay: () => {
        playbackSetting = { 'player.togglePlayMethod': appSetting['player.togglePlayMethod'] === 'singleLoop' ? 'singleLoop' : 'listLoop' }
        mergeSetting(playbackSetting)
      },
    })
    if (!played || !valid()) return
    heartbeatActive.value = true
    await updateSetting(playbackSetting)
    if (!valid()) return
    return { message: '已开启心动模式', kind: 'success' }
  } catch (error) {
    if (!valid()) return
    exitHeartbeat()
    const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : '心动模式开启失败，请稍后重试'
    return { message, kind: 'warning' }
  } finally {
    if (request === currentRequest) heartbeatLoading.value = false
  }
}

export function disposeHeartbeat() {
  exitHeartbeat()
  stopWatching?.()
}
