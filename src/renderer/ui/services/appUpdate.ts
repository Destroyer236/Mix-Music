import { computed, ref, shallowRef } from 'vue'
import { rendererInvoke, rendererOff, rendererOn } from '@common/rendererIpc'
import { findInstallerAsset, isUpdateSource, LINKLINE_UPDATE_CHECK, LINKLINE_UPDATE_DOWNLOAD, LINKLINE_UPDATE_DOWNLOAD_PROGRESS, LINKLINE_UPDATE_INSTALL, UPDATE_SOURCES, type UpdateCheckRequest, type UpdateCheckResult, type UpdateDownloadProgress, type UpdateDownloadRequest, type UpdateDownloadResult, type UpdateSource } from '@common/appUpdate'
import { preferredUpdateSource, saveUpdateSource } from './updatePreferences'

export const updateResult = shallowRef<UpdateCheckResult | null>(null)
export const updateChecking = ref(false)
export const updateCenterOpen = ref(false)
export const updateAvailable = computed(() => !updateChecking.value && updateResult.value?.status === 'available' && updateResult.value.requestedSource === preferredUpdateSource.value)
const pendingRequests = new Map<UpdateSource, Promise<UpdateCheckResult>>()
let activeCheck: { source: UpdateSource, promise: Promise<UpdateCheckResult> } | null = null
let checkGeneration = 0
let startupChecked = false

export const updateDownloadProgress = shallowRef<UpdateDownloadProgress | null>(null)
export const updateDownloadState = ref<'idle' | 'downloading' | 'downloaded' | 'error'>('idle')
export const updateDownloadedFile = shallowRef<UpdateDownloadResult | null>(null)
export const updateDownloadError = ref('')
export interface UpdateDownloadDetails { source: UpdateSource, size?: number, backupUrl?: string | null }
export const updateDownloadTarget = shallowRef<(UpdateDownloadRequest & UpdateDownloadDetails) | null>(null)
let activeDownload: Promise<UpdateDownloadResult> | null = null
let removeDownloadProgressListener: (() => void) | null = null
let downloadGeneration = 0
let activeDownloadRequestId = ''
let downloadRequestSequence = 0

export function resetUpdateDownload(): void {
  // Closing or refreshing a panel must never detach an in-flight task.
  if (activeDownload) return
  downloadGeneration++
  activeDownloadRequestId = ''
  updateDownloadProgress.value = null
  updateDownloadedFile.value = null
  updateDownloadTarget.value = null
  updateDownloadError.value = ''
  updateDownloadState.value = 'idle'
}

const ensureDownloadProgressListener = () => {
  if (removeDownloadProgressListener) return
  const listener = ({ params }: { params?: UpdateDownloadProgress }) => {
    if (!params) return
    if (params.requestId && params.requestId !== activeDownloadRequestId) return
    updateDownloadProgress.value = params
  }
  rendererOn<UpdateDownloadProgress>(LINKLINE_UPDATE_DOWNLOAD_PROGRESS, listener)
  removeDownloadProgressListener = () => rendererOff(LINKLINE_UPDATE_DOWNLOAD_PROGRESS, listener as (...args: any[]) => any)
}

export async function downloadUpdateInstaller(request: UpdateDownloadRequest, details: UpdateDownloadDetails = { source: preferredUpdateSource.value }): Promise<UpdateDownloadResult> {
  if (activeDownload) return activeDownload
  if (updateDownloadState.value === 'downloaded' && updateDownloadedFile.value?.fileName === request.fileName && updateDownloadTarget.value?.sha256 === request.sha256) return Promise.resolve(updateDownloadedFile.value)
  ensureDownloadProgressListener()
  const generation = ++downloadGeneration
  const requestId = `${Date.now()}-${++downloadRequestSequence}`
  activeDownloadRequestId = requestId
  updateDownloadProgress.value = null
  updateDownloadedFile.value = null
  updateDownloadTarget.value = { ...request, ...details }
  updateDownloadError.value = ''
  updateDownloadState.value = 'downloading'
  const promise = rendererInvoke<UpdateDownloadRequest, UpdateDownloadResult>(LINKLINE_UPDATE_DOWNLOAD, { ...request, requestId }).then(result => {
    if (generation !== downloadGeneration) return result
    updateDownloadedFile.value = result
    updateDownloadState.value = 'downloaded'
    return result
  }).catch((error: unknown) => {
    if (generation === downloadGeneration) {
      updateDownloadState.value = 'error'
      updateDownloadError.value = error instanceof Error ? error.message : '下载失败，请重试。'
    }
    throw error
  }).finally(() => { if (activeDownload === promise) activeDownload = null })
  activeDownload = promise
  return promise
}

export async function installDownloadedUpdate(): Promise<void> {
  await rendererInvoke(LINKLINE_UPDATE_INSTALL)
}

// Settings and the title-bar dialog share a single request and result.
export async function checkAppUpdate(force = false): Promise<UpdateCheckResult> {
  const source = preferredUpdateSource.value
  if (activeCheck?.source === source) return activeCheck.promise
  const generation = ++checkGeneration
  const previous = updateResult.value
  updateChecking.value = true
  let request = pendingRequests.get(source)
  if (!request) {
    request = rendererInvoke<UpdateCheckRequest, UpdateCheckResult>(LINKLINE_UPDATE_CHECK, { force, source }).catch((error: unknown): UpdateCheckResult => ({
      status: 'error',
      currentVersion: previous?.currentVersion ?? process.versions.app ?? '',
      latestRelease: null,
      history: [],
      checkedAt: Date.now(),
      source,
      requestedSource: source,
      usedFallback: false,
      sourceLabel: UPDATE_SOURCES[source].label,
      error: error instanceof Error ? error.message : '无法连接更新服务，请稍后重试。',
    })).finally(() => { pendingRequests.delete(source) })
    pendingRequests.set(source, request)
  }
  const promise = request.then(result => {
    const next = result.status === 'error' && previous?.latestRelease && previous.requestedSource === source
      ? { ...result, latestRelease: previous.latestRelease, history: previous.history }
      : result
    if (generation === checkGeneration && preferredUpdateSource.value === source) {
      updateResult.value = next
      const target = updateDownloadTarget.value
      const release = next.latestRelease
      const asset = release ? findInstallerAsset(release.assets, release.version) : undefined
      // Preserve tasks through temporary checking/error states. Once a valid
      // result identifies another package/source, only an idle task may reset.
      if (target && asset && (next.status === 'available' || next.status === 'latest') && (target.fileName !== asset.name || target.sha256 !== asset.sha256 || target.source !== source)) resetUpdateDownload()
    }
    return next
  }).finally(() => {
    if (generation === checkGeneration) {
      updateChecking.value = false
      activeCheck = null
    }
  })
  activeCheck = { source, promise }
  return promise
}

export async function selectUpdateSource(value: string | number): Promise<void> {
  if (!isUpdateSource(value) || value === preferredUpdateSource.value) return
  saveUpdateSource(value)
  updateResult.value = null
  await checkAppUpdate(true)
}

export function checkUpdateOnStartup() {
  if (startupChecked) return
  startupChecked = true
  // Keep the first-run check in the same request pipeline as the title-bar
  // and settings checks.  When it finds a newer release, surface the update
  // center immediately so users do not need to discover the toolbar button.
  // Errors and an up-to-date result stay quiet during startup; the result is
  // still available from the update center for a manual retry.
  void checkAppUpdate().then(result => {
    if (result.status === 'available') updateCenterOpen.value = true
  })
}

export function openUpdateCenter() {
  updateCenterOpen.value = true
  void checkAppUpdate(true)
}
