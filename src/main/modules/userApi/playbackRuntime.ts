import { BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { toOldMusicInfo } from '@common/utils/tools'
import { getProxy } from './main'
import names from './rendererEvent/name'

export interface ImportedScriptRuntime {
  sources: Partial<LX.UserApi.UserApiSources>
  revision: string
  request: (track: LX.Music.MusicInfoOnline, quality: LX.Quality) => Promise<{ url: string, type: LX.Quality }>
  close: () => void
}
interface RuntimeOptions { preloadPath?: string, htmlPath?: string, initTimeout?: number, requestTimeout?: number, signal?: AbortSignal, onClose?: (error: Error) => void }
export class ImportedScriptTimeoutError extends Error {}

// Each imported script gets its own nonpersistent session and its existing LX
// preload API. Its init/response messages never enter the selected legacy API.
export const createImportedScriptRuntime = async(api: LX.UserApi.UserApiInfo, script: string, options: RuntimeOptions = {}): Promise<ImportedScriptRuntime> => {
  const revision = createHash('sha256').update(script).digest('hex')
  const htmlPath = options.htmlPath ?? path.join(process.env.NODE_ENV !== 'production' ? webpackUserApiPath : path.join(__dirname, 'userApi'), 'renderer/user-api.html')
  const html = await fs.readFile(htmlPath, 'utf8')
  if (options.signal?.aborted) throw new Error('导入音源已关闭')
  const win = new BrowserWindow({
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      partition: `linkline-imported-${randomUUID()}`,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: false,
      webgl: false,
      images: false,
      spellcheck: false,
      disableDialogs: true,
      autoplayPolicy: 'document-user-activation-required',
      preload: options.preloadPath ?? path.join(__dirname, process.env.NODE_ENV !== 'production' ? '../dist/user-api-preload.js' : 'user-api-preload.js'),
    },
  })
  let closed = false
  let closeCause: Error | null = null
  let initialized = false
  let sources: Partial<LX.UserApi.UserApiSources> = {}
  const pending = new Map<string, { resolve: (value: { url: string, type: LX.Quality }) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>()
  let resolveInit: () => void
  let rejectInit: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { resolveInit = resolve; rejectInit = reject })
  // Attach rejection handling before navigation can fail or the script can crash.
  void ready.catch(() => {})
  const owns = (event: Electron.IpcMainEvent) => !closed && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
  const initTimer = setTimeout(() => { close(new ImportedScriptTimeoutError('导入音源初始化超时')) }, options.initTimeout ?? 5000)
  const onInit = (event: Electron.IpcMainEvent, message: { status?: boolean, message?: string, data?: { sources?: Partial<LX.UserApi.UserApiSources> } }) => {
    if (!owns(event) || initialized) return
    if (!message?.status || !message.data?.sources) { close(new Error(message?.message ?? '导入音源初始化失败')); return }
    sources = message.data.sources
    initialized = true
    clearTimeout(initTimer)
    resolveInit()
  }
  const onResponse = (event: Electron.IpcMainEvent, message: { status?: boolean, message?: string, data?: { requestKey?: string, result?: { source?: string, action?: string, data?: { url?: string, type?: LX.Quality } } } }) => {
    if (!owns(event)) return
    const key = message?.data?.requestKey
    const request = typeof key === 'string' ? pending.get(key) : undefined
    if (!request || !key) return
    pending.delete(key)
    clearTimeout(request.timer)
    const result = message.data?.result
    const data = result?.data
    if (!message.status || result?.action !== 'musicUrl' || !data || typeof data.url !== 'string' || !/^https?:\/\//i.test(data.url) || data.url.length > 2048 || !data.type) {
      request.reject(new Error(message.message ?? '导入音源未返回有效播放地址'))
      return
    }
    request.resolve({ url: data.url, type: data.type })
  }
  const onProxy = (event: Electron.IpcMainEvent) => { if (owns(event)) win.webContents.send(names.proxyUpdate, getProxy()) }
  const updateProxy = (keys: string[]) => { if (!closed && keys.some(key => key.startsWith('network.proxy.'))) win.webContents.send(names.proxyUpdate, getProxy()) }
  const onAbort = () => { close() }
  const close = (error = new Error('导入音源已关闭')) => {
    if (closed) return
    closed = true
    closeCause = error
    clearTimeout(initTimer)
    ipcMain.removeListener(names.init, onInit)
    ipcMain.removeListener(names.response, onResponse)
    ipcMain.removeListener(names.getProxy, onProxy)
    global.lx.event_app.off('updated_config', updateProxy)
    options.signal?.removeEventListener('abort', onAbort)
    rejectInit(error)
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error) }
    pending.clear()
    if (!win.isDestroyed()) win.destroy()
    options.onClose?.(error)
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  ipcMain.on(names.init, onInit)
  ipcMain.on(names.response, onResponse)
  ipcMain.on(names.getProxy, onProxy)
  global.lx.event_app.on('updated_config', updateProxy)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const preventNavigation = (event: Electron.Event) => { event.preventDefault() }
  win.webContents.on('will-navigate', preventNavigation)
  win.webContents.on('will-redirect', preventNavigation)
  win.webContents.on('will-attach-webview', preventNavigation)
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, allow) => { allow(false) })
  win.webContents.on('render-process-gone', () => { close(new Error('导入音源运行进程已退出')) })
  win.on('closed', () => { close() })
  try {
    await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html))
    if (closed) throw new Error('导入音源已关闭')
    win.webContents.send(names.initEnv, { ...api, script, proxy: getProxy() })
    await ready
  } catch (error) { const cause = closeCause ?? error; close(); throw cause }
  return {
    sources,
    revision,
    close,
    async request(track, quality) {
      if (closed) throw new Error('导入音源已关闭')
      const capability = sources[track.source]
      if (!capability?.actions.includes('musicUrl') || !capability.qualitys.includes(quality)) throw new Error('导入音源不支持此平台或音质')
      return new Promise((resolve, reject) => {
        const requestKey = `imported_playback_${randomUUID()}`
        const timer = setTimeout(() => { close(new ImportedScriptTimeoutError('导入音源请求超时')) }, options.requestTimeout ?? 25000)
        pending.set(requestKey, { resolve, reject, timer })
        win.webContents.send(names.request, { requestKey, data: { source: track.source, action: 'musicUrl', info: { type: quality, musicInfo: toOldMusicInfo(track) } } })
      })
    },
  }
}
