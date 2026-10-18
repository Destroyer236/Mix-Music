import { mainSend } from '@common/mainIpc'
import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'node:path'
import { openDevTools as handleOpenDevTools } from '@main/utils'
import USER_API_RENDERER_EVENT_NAME from './rendererEvent/name'
import { getScript } from './utils'

let browserWindow: Electron.BrowserWindow | null = null
let windowGeneration = 0

export const ownsApiEvent = (event: Electron.IpcMainEvent) => Boolean(browserWindow && !browserWindow.isDestroyed() && event.sender === browserWindow.webContents && event.senderFrame === browserWindow.webContents.mainFrame)

let html: string | null = null
let dir: string | null = null

const denyEvents = [
  'will-navigate',
  'will-redirect',
  'will-attach-webview',
  'will-prevent-unload',
  'media-started-playing',
] as const


export const getProxy = () => {
  if (global.lx.appSetting['network.proxy.enable'] && global.lx.appSetting['network.proxy.host']) {
    return {
      host: global.lx.appSetting['network.proxy.host'],
      port: global.lx.appSetting['network.proxy.port'],
    }
  }
  const envProxy = envParams.cmdParams['proxy-server']
  if (envProxy) {
    if (envProxy && typeof envProxy == 'string') {
      const [host, port = ''] = envProxy.split(':')
      return {
        host,
        port,
      }
    }
  }
  return {
    host: '',
    port: '',
  }
}
const handleUpdateProxy = (keys: Array<keyof LX.AppSetting>) => {
  if (keys.includes('network.proxy.enable') || (global.lx.appSetting['network.proxy.enable'] && keys.some(k => k.startsWith('network.proxy.')))) {
    sendEvent(USER_API_RENDERER_EVENT_NAME.proxyUpdate, getProxy())
  }
}

export const createWindow = async(userApi: LX.UserApi.UserApiInfo) => {
  const generation = windowGeneration + 1
  await closeWindow()
  if (generation !== windowGeneration) return
  let script: string
  try {
    script = await getScript(userApi.id)
  } catch (error) {
    if (generation !== windowGeneration) return
    throw error
  }
  if (generation !== windowGeneration) return
  dir ??= process.env.NODE_ENV !== 'production' ? webpackUserApiPath : path.join(__dirname, 'userApi')

  if (!html) {
    // eslint-disable-next-line require-atomic-updates
    html = await fs.promises.readFile(path.join(dir, 'renderer/user-api.html'), 'utf8')
  }
  if (generation !== windowGeneration) return
  const preloadUrl = process.env.NODE_ENV !== 'production'
    ? `${path.join(__dirname, '../dist/user-api-preload.js')}`
    : `${path.join(__dirname, 'user-api-preload.js')}`
  // console.log(preloadUrl)

  /**
   * Initial window options
   */
  const win = new BrowserWindow({
    // enableRemoteModule: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      // worldSafeExecuteJavaScript: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: false,

      spellcheck: false,
      autoplayPolicy: 'document-user-activation-required',
      enableWebSQL: false,
      disableDialogs: true,
      // nativeWindowOpen: false,
      webgl: false,
      images: false,

      preload: preloadUrl,
    },
  })
  browserWindow = win

  for (const eventName of denyEvents) {
    // @ts-expect-error
    win.webContents.on(eventName, (event: Electron.Event) => {
      event.preventDefault()
    })
  }
  win.webContents.session.setPermissionRequestHandler((webContents, permission, resolve) => {
    if (webContents === win.webContents) {
      resolve(false)
      return
    }
    resolve(true)
  })
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  win.on('closed', () => {
    if (browserWindow !== win) return
    browserWindow = null
    global.lx.event_app.off('updated_config', handleUpdateProxy)
  })
  // Register before loading: ready-to-show may fire before loadURL resolves.
  win.once('ready-to-show', () => {
    if (generation !== windowGeneration || browserWindow !== win || win.isDestroyed()) return
    global.lx.event_app.on('updated_config', handleUpdateProxy)
    mainSend(win, USER_API_RENDERER_EVENT_NAME.initEnv, { ...userApi, script, proxy: getProxy() })
  })

  // console.log(html.replace('</body>', `<script>${userApi.script}</script></body>`))
  // const randomNum = Math.random().toString().substring(2, 10)
  try {
    await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html))
  } catch (error) {
    if (generation !== windowGeneration) return
    await closeWindow()
    throw error
  }

  // global.modules.userApiWindow.loadFile(join(dir, 'renderer/user-api.html'))
  // global.modules.userApiWindow.webContents.openDevTools()
}

export const closeWindow = async() => {
  windowGeneration++
  global.lx.event_app.off('updated_config', handleUpdateProxy)
  const win = browserWindow
  browserWindow = null
  if (!win || win.isDestroyed()) return
  try {
    await Promise.all([
      win.webContents.session.clearAuthCache(),
      win.webContents.session.clearStorageData(),
      win.webContents.session.clearCache(),
    ])
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export const sendEvent = <T = any>(name: string, params?: T) => {
  if (!browserWindow) return
  mainSend(browserWindow, name, params)
}

export const openDevTools = () => {
  if (!browserWindow) return
  handleOpenDevTools(browserWindow.webContents)
}
