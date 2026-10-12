import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import path from 'node:path'
import { LOCAL_LIBRARY_ID } from '@common/localMusic'
import { DOWNLOAD_STATUS } from '@common/constants'
import { getListMusics } from '@renderer/store/list/action'
import { getDownloadList } from '@renderer/store/download/action'
import { downloadList } from '@renderer/store/download/state'
import { ensureLocalLibrary } from './services/localLibrary'

const fileKey = (filePath: string) => {
  const normalized = path.normalize(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Count library entries and completed downloads, counting the same file once. */
export function useDeviceMusicCount() {
  const localFiles = shallowRef(new Set<string>())
  let version = 0
  let disposed = false
  async function refreshLocalCount() {
    const request = ++version
    try {
      const tracks = await getListMusics(LOCAL_LIBRARY_ID)
      if (disposed || request !== version) return
      localFiles.value = new Set(tracks.filter((track): track is LX.Music.MusicInfoLocal => track.source === 'local').map(track => track.meta.filePath ? fileKey(track.meta.filePath) : `local:${track.id}`))
    } catch { /* Preserve the last successful count when the database is unavailable. */ }
  }
  function onListUpdate(ids: string[]) { if (ids.includes(LOCAL_LIBRARY_ID)) void refreshLocalCount() }
  onMounted(() => {
    window.app_event.on('myListUpdate', onListUpdate)
    void ensureLocalLibrary().then(async() => { if (!disposed) await refreshLocalCount() }).catch(() => {})
    void getDownloadList().catch(() => {})
  })
  onBeforeUnmount(() => { disposed = true; version++; window.app_event.off('myListUpdate', onListUpdate) })
  return computed(() => {
    const files = new Set(localFiles.value)
    for (const task of downloadList) {
      if (task.status !== DOWNLOAD_STATUS.COMPLETED) continue
      files.add(task.metadata.filePath ? fileKey(task.metadata.filePath) : `download:${task.id}`)
    }
    return files.size
  })
}
