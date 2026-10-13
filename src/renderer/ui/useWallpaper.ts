import path from 'node:path'
import { ref } from 'vue'
import { getThemes, openDirInExplorer, showSelectDialog } from '@renderer/utils/ipc'
import { WallpaperFile, type WallpaperRecord } from './wallpaperFile'
import { prepareWallpaper } from './wallpaperImage'

export const wallpaper = ref<WallpaperRecord | null>(null)
export const wallpaperUrl = ref('')
export const wallpaperBusy = ref(false)
export const wallpaperError = ref('')
let storage: Promise<WallpaperFile> | undefined
let restore: Promise<void> | undefined
function getStorage() {
  return storage ??= getThemes().then(info => new WallpaperFile(path.join(info.dataPath, 'custom-backgrounds'))).catch(error => { storage = undefined; throw error })
}
export function initializeWallpaper() {
  return restore ??= getStorage().then(async store => {
    const record = await store.read()
    wallpaper.value = record
    wallpaperUrl.value = record ? store.url(record) : ''
  }).catch(error => { wallpaperError.value = error instanceof Error ? error.message : '背景暂时无法读取，请重新选择图片。' })
}
/** Return false on cancel/failure, leaving the active theme and saved image intact. */
export async function selectWallpaper(): Promise<boolean> {
  if (wallpaperBusy.value) return false
  wallpaperBusy.value = true
  wallpaperError.value = ''
  try {
    await initializeWallpaper()
    const result = await showSelectDialog({ title: '选择自定义背景', properties: ['openFile'], filters: [{ name: '背景图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }] })
    if (result.canceled || !result.filePaths[0]) return false
    const prepared = await prepareWallpaper(result.filePaths[0])
    const store = await getStorage()
    const record = await store.save(prepared.bytes, prepared.info)
    // Publish file URL and palette together; no partial recoloring while analyzing.
    wallpaperUrl.value = store.url(record)
    wallpaper.value = record
    wallpaperError.value = ''
    return true
  } catch (error) {
    wallpaperError.value = (error as NodeJS.ErrnoException).code ? '背景图片无法读取或保存，请检查文件和文件夹权限后重试。' : error instanceof Error ? error.message : '背景图片保存失败，请重试。'
    return false
  } finally { wallpaperBusy.value = false }
}
export async function openWallpaperFolder() {
  try {
    const store = await getStorage()
    await openDirInExplorer(wallpaper.value ? path.join(store.directory, wallpaper.value.file) : store.directory)
  } catch { wallpaperError.value = '暂时无法打开背景文件夹。' }
}
