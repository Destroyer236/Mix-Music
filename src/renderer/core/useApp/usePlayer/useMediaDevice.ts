import {
  onBeforeUnmount,
  watch,
} from '@common/utils/vueTools'
import { pause } from '@renderer/core/player/action'
import { dialog } from '@renderer/plugins/Dialog'
import { setMediaDeviceId } from '@renderer/plugins/player'
import { isPlay } from '@renderer/store/player/state'
import { appSetting, saveMediaDeviceId } from '@renderer/store/setting'

const getDevices = async() => {
  if (!navigator.mediaDevices) return [] as MediaDeviceInfo[]
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter(({ kind }) => kind === 'audiooutput')
}

let isShowingTipAlert = false

export default () => {
  let prevDeviceLabel: string | null = null
  let prevDeviceId = 'default'
  let version = 0
  let monitoring = false
  let sinkQueue: Promise<void> = Promise.resolve()

  const getMediaDevice = async(deviceId: string, token: number) => {
    const devices = await getDevices()
    let device = devices.find(device => device.deviceId === deviceId)
    if (!device) {
      deviceId = 'default'
      device = devices.find(device => device.deviceId === deviceId)
    }

    if (token === version && !device && !devices.length && !isShowingTipAlert) {
      isShowingTipAlert = true
      void dialog({
        message: window.i18n.t('media_device__empty_device_tip'),
        confirmButtonText: window.i18n.t('ok'),
      }).finally(() => {
        isShowingTipAlert = false
      })
    }
    return device ? { label: device.label, deviceId: device.deviceId } : { label: '', deviceId: 'default' }
  }
  const setMediaDevice = async(deviceId: string, label: string, token: number) => {
    // Serialize native sink operations as well as guarding their saved results:
    // an old in-flight setSinkId must finish before applying the newest choice.
    sinkQueue = sinkQueue.then(async() => {
      if (token !== version) return
      try {
        await setMediaDeviceId(deviceId)
        if (token !== version) return
        prevDeviceId = deviceId
        prevDeviceLabel = label
        if (appSetting['player.mediaDeviceId'] !== deviceId) saveMediaDeviceId(deviceId)
      } catch (err) {
        console.log(err)
        if (token !== version) return
        await setMediaDeviceId('default').catch(() => {})
        if (token !== version) return
        prevDeviceId = 'default'
        prevDeviceLabel = null
        saveMediaDeviceId('default')
      }
    }).catch((err: unknown) => { console.log(err) })
    return sinkQueue
  }

  const handleDeviceChange = (label: string, deviceId: string) => {
    if (prevDeviceLabel !== null && (label !== prevDeviceLabel || deviceId !== prevDeviceId)) {
      window.app_event.playerDeviceChanged()

      if (appSetting['player.isMediaDeviceRemovedStopPlay'] && isPlay.value) {
        window.lx.isPlayedStop = true
        pause()
      }
    }
  }

  const refreshOutput = async(isDeviceEvent: boolean) => {
    if (!monitoring) return
    const token = ++version
    const mediaDeviceId = appSetting['player.mediaDeviceId']
    try {
      const device = await getMediaDevice(mediaDeviceId, token)
      if (token !== version || !monitoring) return
      if (isDeviceEvent) handleDeviceChange(device.label, device.deviceId)
      prevDeviceLabel = device.label
      if (!isDeviceEvent || prevDeviceId !== device.deviceId || mediaDeviceId !== device.deviceId) await setMediaDevice(device.deviceId, device.label, token)
    } catch (err) { console.log(err) }
  }
  const handleMediaListChange = () => { void refreshOutput(true) }

  const updateMonitoring = () => {
    const needed = appSetting['player.mediaDeviceId'] !== 'default' || appSetting['player.isMediaDeviceRemovedStopPlay']
    if (!needed) {
      const wasMonitoring = monitoring
      monitoring = false
      const token = ++version
      prevDeviceLabel = null
      navigator.mediaDevices?.removeEventListener('devicechange', handleMediaListChange)
      // HTMLAudioElement starts on the default sink. Do not discover devices or
      // start Chromium's capture services for ordinary listening on that sink.
      if (wasMonitoring || prevDeviceId !== 'default') void setMediaDevice('default', '', token)
      return
    }
    if (!monitoring) {
      monitoring = true
      navigator.mediaDevices?.addEventListener('devicechange', handleMediaListChange)
    }
    void refreshOutput(false)
  }

  watch([
    () => appSetting['player.mediaDeviceId'],
    () => appSetting['player.isMediaDeviceRemovedStopPlay'],
  ], updateMonitoring)
  updateMonitoring()

  onBeforeUnmount(() => {
    monitoring = false
    version++
    navigator.mediaDevices?.removeEventListener('devicechange', handleMediaListChange)
  })
}
