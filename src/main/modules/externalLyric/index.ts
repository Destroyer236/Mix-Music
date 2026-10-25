import path from 'node:path'
import { app, BrowserWindow, ipcMain, MessageChannelMain, screen } from 'electron'
import { APP_EVENT_NAMES } from '@common/constants'
import { HOTKEY_DESKTOP_LYRIC } from '@common/hotKey'
import { WIN_LYRIC_RENDERER_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { externalLyricDefaults, getExternalLyricConfig, type ExternalLyricMode, type ExternalLyricSettings } from '@common/externalLyric'
import { getWebContents, sendTaskbarButtonClick, showWindow as showMainWindow } from '../winMain'
import { startTaskbarHost, type TaskbarHost } from './taskbarHost'
import { LyricWindowGeometry } from './windowGeometry'

const modes: ExternalLyricMode[] = ['desktop', 'island', 'taskbar']
const titles = { desktop: '桌面歌词', island: '灵动岛歌词', taskbar: '任务栏歌词' }
export const lyricWindows = new Map<ExternalLyricMode, BrowserWindow>()
const geometries = new WeakMap<BrowserWindow, LyricWindowGeometry>()
let host: TaskbarHost | undefined
let taskbarLayout: Record<string, unknown> & { maxWidth: number } | undefined
let taskbarRecoveryTimer: NodeJS.Timeout | undefined
let taskbarRecoveryAttempt = 0
let cursorTimer: NodeJS.Timeout | undefined
let ready = false
let shuttingDown = false
let islandSnapped = true
const hovered = new Map<ExternalLyricMode, boolean>()
const unlockRegions = new Map<ExternalLyricMode, Electron.Rectangle>()
const saveTimers = new Map<ExternalLyricMode, NodeJS.Timeout>()

function save(config: Partial<LX.AppSetting>) { global.lx.event_app.update_config(config) }
function config() { return Object.fromEntries(Object.keys(externalLyricDefaults).map(key => [key, global.lx.appSetting[key as keyof ExternalLyricSettings]])) }
function owner(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  for (const [mode, win] of lyricWindows) if (!win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame) return { mode, win }
  return null
}
function sendLayout(mode: ExternalLyricMode, extra: Record<string, unknown> = {}) {
  const win = lyricWindows.get(mode)
  if (!win || win.isDestroyed()) return
  const island = getExternalLyricConfig(global.lx.appSetting, 'island')
  win.webContents.send('externalLyric:layout', { isLight: !global.lx.theme.shouldUseDarkColors, maxWidth: screen.getDisplayMatching(win.getBounds()).workArea.width, snapped: mode === 'island' && (islandSnapped || (process.platform === 'darwin' && island.notchFusion)), ...(mode === 'taskbar' ? taskbarLayout : {}), ...extra })
}
function fit(bounds: Electron.Rectangle, clamp = true) {
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.max(120, Math.min(area.width, Math.round(bounds.width)))
  const height = Math.max(32, Math.min(area.height, Math.round(bounds.height)))
  return { width, height, x: Math.round(clamp ? Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)) : bounds.x), y: Math.round(clamp ? Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) : bounds.y) }
}
function positionIsland(win: BrowserWindow, width = geometries.get(win)!.getSize().width, height = geometries.get(win)!.getSize().height) {
  const prefs = getExternalLyricConfig(global.lx.appSetting, 'island')
  const previous = geometries.get(win)!.getBounds()
  const display = screen.getDisplayMatching(previous)
  const notch = process.platform === 'darwin' && prefs.notchFusion
  const centered = (islandSnapped && prefs.snapCentered) || notch
  const next = fit({ x: centered ? display.workArea.x + (display.workArea.width - width) / 2 : previous.x + (previous.width - width) / 2, y: islandSnapped || notch ? (notch ? display.bounds.y : display.workArea.y) : previous.y, width, height })
  if (notch) next.y = display.bounds.y
  geometries.get(win)!.setBounds(next)
  sendLayout('island')
}
function savePosition(mode: ExternalLyricMode, win: BrowserWindow) {
  if (mode === 'taskbar' || shuttingDown || win.isDestroyed()) return
  clearTimeout(saveTimers.get(mode))
  saveTimers.set(mode, setTimeout(() => {
    saveTimers.delete(mode)
    if (win.isDestroyed()) return
    if (mode === 'island' && global.lx.appSetting['externalLyric.island.useCSSDrag']) {
      islandSnapped = win.getBounds().y <= screen.getDisplayMatching(win.getBounds()).workArea.y + 16
      if (islandSnapped) positionIsland(win)
      else sendLayout('island')
    }
    const bounds = geometries.get(win)!.getBounds()
    const patch: Partial<LX.AppSetting> = { [`externalLyric.${mode}.x`]: bounds.x, [`externalLyric.${mode}.y`]: bounds.y }
    if (mode === 'desktop') { patch['externalLyric.desktop.width'] = bounds.width; patch['externalLyric.desktop.height'] = bounds.height }
    save(patch)
  }, 300))
}
function close(mode: ExternalLyricMode) {
  if (mode === 'taskbar') {
    clearTimeout(taskbarRecoveryTimer)
    taskbarRecoveryTimer = undefined
  }
  const win = lyricWindows.get(mode)
  if (!win) return
  lyricWindows.delete(mode)
  geometries.delete(win)
  clearTimeout(saveTimers.get(mode)); saveTimers.delete(mode)
  if (mode === 'taskbar') {
    host?.stop(); host = undefined
    taskbarLayout = undefined
  }
  if (!win.isDestroyed()) win.destroy()
  hovered.delete(mode)
  unlockRegions.delete(mode)
  if (!lyricWindows.size) { clearInterval(cursorTimer); cursorTimer = undefined }
}
function recoverTaskbar(win: BrowserWindow, error?: Error) {
  // Old host events and aborted loads must not affect a replacement window.
  if (lyricWindows.get('taskbar') !== win) return
  if (error) console.error('Taskbar lyric host:', error)
  const shouldRecover = !shuttingDown && ready && global.lx.appSetting['externalLyric.taskbar.enabled']
  close('taskbar')
  if (!shouldRecover) return
  const retryDelay = Math.min(1000 * (2 ** taskbarRecoveryAttempt++), 15000)
  taskbarRecoveryTimer = setTimeout(() => {
    taskbarRecoveryTimer = undefined
    if (!shuttingDown && ready && global.lx.appSetting['externalLyric.taskbar.enabled'] && !lyricWindows.has('taskbar')) create('taskbar')
  }, retryDelay)
}
function startCursorChecks() {
  if (cursorTimer) return
  cursorTimer = setInterval(() => {
    const cursor = screen.getCursorScreenPoint()
    for (const [mode, win] of lyricWindows) {
      if (win.isDestroyed() || mode === 'taskbar') continue
      const bounds = win.getBounds()
      const inside = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
      if (hovered.get(mode) !== inside) { hovered.set(mode, inside); win.webContents.send('externalLyric:hover', inside) }
      const desktop = getExternalLyricConfig(global.lx.appSetting, 'desktop')
      const island = getExternalLyricConfig(global.lx.appSetting, 'island')
      if (mode === 'desktop' && desktop.locked) {
        const region = unlockRegions.get(mode) ?? { x: bounds.width - 54, y: 0, width: 54, height: 54 }
        const unlock = inside && cursor.x >= bounds.x + region.x && cursor.x < bounds.x + region.x + region.width && cursor.y >= bounds.y + region.y && cursor.y < bounds.y + region.y + region.height
        win.setIgnoreMouseEvents(!unlock, { forward: true })
      } else if (mode === 'island' && island.nonOcclusive) {
        win.setIgnoreMouseEvents(true, { forward: true })
      } else win.setIgnoreMouseEvents(false)
    }
  }, 120)
}
function create(mode: ExternalLyricMode) {
  if (lyricWindows.has(mode) || !ready || shuttingDown || !global.lx.appSetting[`externalLyric.${mode}.enabled`]) return
  if (mode === 'taskbar' && process.platform !== 'win32') { save({ 'externalLyric.taskbar.enabled': false }); return }
  const desktop = getExternalLyricConfig(global.lx.appSetting, 'desktop')
  const island = getExternalLyricConfig(global.lx.appSetting, 'island')
  const area = screen.getPrimaryDisplay().workArea
  const width = mode === 'desktop' ? desktop.width : mode === 'island' ? Math.round(360 * island.scale) : 3000
  const height = mode === 'desktop' ? desktop.height : mode === 'island' ? Math.round(64 * island.scale) : 200
  const prefs = mode === 'desktop' ? desktop : island
  const bounds = mode === 'taskbar' ? { x: area.x, y: area.y, width, height } : fit({ x: prefs.x ?? area.x + (area.width - width) / 2, y: prefs.y ?? (mode === 'desktop' ? area.y + area.height - height - 40 : area.y + 8), width, height })
  const win = new BrowserWindow({ ...bounds, title: `Mix Music · ${titles[mode]}`, ...(mode === 'taskbar' ? { type: 'toolbar' as const, movable: false } : {}), frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, show: false, resizable: mode === 'desktop' && !desktop.locked, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, roundedCorners: false, minWidth: mode === 'desktop' ? 240 : 0, minHeight: mode === 'desktop' ? 80 : 0, alwaysOnTop: mode !== 'taskbar' && prefs.alwaysOnTop, webPreferences: { partition: 'persist:win-main', nodeIntegration: true, contextIsolation: false, sandbox: false, webgl: false, spellcheck: false, backgroundThrottling: false, ...(mode === 'taskbar' ? { zoomFactor: 1, disableDialogs: true } : {}) } })
  geometries.set(win, new LyricWindowGeometry(win, bounds))
  if (mode === 'island') islandSnapped = island.y === null || bounds.y <= screen.getDisplayMatching(bounds).workArea.y + 16
  lyricWindows.set(mode, win)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => { event.preventDefault() })
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    if (mode === 'island') positionIsland(win)
    if (mode === 'taskbar') {
      host = startTaskbarHost(win, layout => {
        if (lyricWindows.get(mode) !== win || win.isDestroyed()) return
        taskbarRecoveryAttempt = 0
        taskbarLayout = layout
        sendLayout(mode)
        if (layout.maxWidth >= 120) { if (!win.isVisible() || layout.reattached === true) win.showInactive() } else if (win.isVisible()) win.hide()
      }, error => { recoverTaskbar(win, error) })
    } else { win.showInactive(); startCursorChecks() }
    sendLayout(mode)
  })
  win.on('move', () => { savePosition(mode, win) })
  win.on('will-resize', (_event, next) => { if (mode === 'desktop') geometries.get(win)!.captureResize(next) })
  win.on('resize', () => { if (mode === 'desktop') savePosition(mode, win) })
  win.on('close', event => { if (!shuttingDown) { event.preventDefault(); save({ [`externalLyric.${mode}.enabled`]: false }) } })
  if (mode === 'taskbar') win.webContents.on('render-process-gone', (_event, details) => { recoverTaskbar(win, new Error(`任务栏歌词渲染进程已退出 (${details.reason})`)) })
  win.on('closed', () => {
    if (lyricWindows.get(mode) !== win) return
    // Explorer can destroy an embedded child window while rebuilding its taskbar.
    if (mode === 'taskbar') recoverTaskbar(win)
    else close(mode)
  })
  const base = process.env.NODE_ENV === 'production' ? `file://${path.join(__dirname, 'lyric.html').replace(/\\/g, '/')}` : 'http://localhost:9081/lyric.html'
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  void win.loadURL(`${base}?mode=${mode}&os=${os}`).catch(error => {
    if (lyricWindows.get(mode) !== win) return
    console.error('External lyric load failed', error); close(mode); save({ [`externalLyric.${mode}.enabled`]: false })
  })
  global.lx.event_app.desktop_lyric_window_created(win)
}
function updateWindows(keys: string[]) {
  for (const mode of modes) {
    if (!global.lx.appSetting[`externalLyric.${mode}.enabled`]) { close(mode); continue }
    create(mode)
    const win = lyricWindows.get(mode)
    if (!win || win.isDestroyed()) continue
    if (mode !== 'taskbar') {
      const top = global.lx.appSetting[`externalLyric.${mode}.alwaysOnTop`]
      win.setAlwaysOnTop(top, 'screen-saver')
      win.setVisibleOnAllWorkspaces(top, { visibleOnFullScreen: true })
      if (mode === 'desktop') {
        const prefs = getExternalLyricConfig(global.lx.appSetting, mode)
        win.setResizable(!prefs.locked)
        const bounds = geometries.get(win)!.getBounds()
        if (keys.some(key => /^externalLyric.desktop.(x|y|width|height|limitBounds)$/.test(key))) geometries.get(win)!.setBounds(fit({ x: prefs.x ?? bounds.x, y: prefs.y ?? bounds.y, width: prefs.width, height: prefs.height }, prefs.limitBounds || prefs.x === null || prefs.y === null))
      } else if (keys.some(key => ['x', 'y', 'snapCentered', 'notchFusion', 'scale'].some(field => key === `externalLyric.island.${field}`))) {
        const prefs = getExternalLyricConfig(global.lx.appSetting, 'island')
        if (prefs.x === null || prefs.y === null) {
          islandSnapped = true
          const area = screen.getPrimaryDisplay().workArea
          const bounds = geometries.get(win)!.getBounds()
          geometries.get(win)!.setBounds({ ...bounds, x: Math.round(area.x + (area.width - bounds.width) / 2), y: area.y })
        } else if (keys.includes('externalLyric.island.x') || keys.includes('externalLyric.island.y')) {
          geometries.get(win)!.setBounds({ ...geometries.get(win)!.getBounds(), x: prefs.x, y: prefs.y })
          islandSnapped = prefs.y <= screen.getDisplayMatching(win.getBounds()).workArea.y + 16
        }
        positionIsland(win)
      }
    } else host?.configure(getExternalLyricConfig(global.lx.appSetting, mode))
    win.webContents.send('externalLyric:config', config())
  }
}

export default () => {
  ipcMain.on('externalLyric:unlock-bounds', (event, bounds: Electron.Rectangle) => {
    const source = owner(event)
    if (source?.mode === 'desktop' && bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) unlockRegions.set('desktop', bounds)
  })
  ipcMain.handle('externalLyric:get-config', event => { if (!owner(event)) throw new Error('Unknown lyric window'); return { ...config(), 'player.playbackRate': global.lx.appSetting['player.playbackRate'] } })
  ipcMain.handle('externalLyric:set-config', (event, patch: Partial<ExternalLyricSettings>) => {
    const source = owner(event)
    if (!source || !patch || typeof patch !== 'object') return
    const result: Partial<LX.AppSetting> = {}
    for (const key of Object.keys(patch) as Array<keyof ExternalLyricSettings>) {
      if (!key.startsWith(`externalLyric.${source.mode}.`) || !(key in externalLyricDefaults)) continue
      const value = patch[key]
      const fallback = externalLyricDefaults[key]
      if (fallback === null ? value !== null && (typeof value !== 'number' || !Number.isFinite(value)) : typeof value !== typeof fallback) continue
      if (typeof value === 'number' && !Number.isFinite(value)) continue
      result[key] = value as never
    }
    save(result)
  })
  ipcMain.on('externalLyric:connect', event => {
    const source = owner(event)
    if (!source) return
    const { port1, port2 } = new MessageChannelMain()
    getWebContents().postMessage(WIN_MAIN_RENDERER_EVENT_NAME.process_new_desktop_lyric_client, { clientId: source.mode }, [port1])
    event.senderFrame?.postMessage(WIN_LYRIC_RENDERER_EVENT_NAME.provide_main_window_channel, null, [port2])
    sendLayout(source.mode)
  })
  ipcMain.on('externalLyric:control', (event, action: string) => {
    if (!owner(event)) return
    if (['play', 'pause', 'prev', 'next'].includes(action)) sendTaskbarButtonClick(action as 'play' | 'pause' | 'prev' | 'next')
    if (action === 'focus-main' || action === 'open-settings') { showMainWindow(); if (action === 'open-settings') getWebContents().send('externalLyric:open-settings') }
  })
  ipcMain.on('externalLyric:bounds', (event, next: { x: number, y: number, width?: number, height?: number, finished?: boolean }) => {
    const source = owner(event)
    if (!source || source.mode === 'taskbar' || !next || !Number.isFinite(next.x) || !Number.isFinite(next.y)) return
    if (source.mode === 'desktop' && global.lx.appSetting['externalLyric.desktop.locked']) return
    const geometry = geometries.get(source.win)!
    const bounds = geometry.getBounds()
    const width = Number.isFinite(next.width) ? Math.max(240, next.width!) : bounds.width
    const height = Number.isFinite(next.height) ? Math.max(80, next.height!) : bounds.height
    geometry.setBounds(fit({ x: next.x, y: next.y, width, height }, source.mode === 'island' || global.lx.appSetting['externalLyric.desktop.limitBounds']))
    if (source.mode === 'island') {
      const prefs = getExternalLyricConfig(global.lx.appSetting, 'island')
      const current = source.win.getBounds()
      const area = screen.getDisplayMatching(current).workArea
      islandSnapped = current.y <= area.y + 16 || (process.platform === 'darwin' && prefs.notchFusion)
      if (next.finished && islandSnapped) positionIsland(source.win)
      else sendLayout('island')
    }
    savePosition(source.mode, source.win)
  })
  const resize = (event: Electron.IpcMainEvent, size: { width?: number, height?: number }) => {
    const source = owner(event)
    if (!source || !size) return
    const geometry = geometries.get(source.win)!
    const bounds = geometry.getBounds()
    const width = typeof size.width === 'number' && Number.isFinite(size.width) ? size.width : bounds.width
    const height = typeof size.height === 'number' && Number.isFinite(size.height) ? size.height : bounds.height
    if (source.mode === 'island') positionIsland(source.win, width, height)
    else if (source.mode === 'desktop') geometry.setBounds(fit({ ...bounds, width: global.lx.appSetting['externalLyric.desktop.locked'] ? bounds.width : width, height }, global.lx.appSetting['externalLyric.desktop.limitBounds']))
    else if (source.mode === 'taskbar') host?.contentWidth(width)
  }
  ipcMain.on('externalLyric:resize', resize)
  ipcMain.on('externalLyric:content-size', resize)
  global.lx.event_app.on('main_window_inited', () => {
    ready = true
    if (global.lx.appSetting['desktopLyric.enable'] && !global.lx.appSetting['externalLyric.desktop.enabled']) save({ 'externalLyric.desktop.enabled': true })
    updateWindows([])
    for (const win of lyricWindows.values()) win.webContents.send('externalLyric:reconnect')
  })
  global.lx.event_app.on('updated_config', keys => {
    if (keys.includes('externalLyric.desktop.enabled')) {
      const value = global.lx.appSetting['externalLyric.desktop.enabled']
      if (global.lx.appSetting['desktopLyric.enable'] !== value) save({ 'desktopLyric.enable': value })
    } else if (keys.includes('desktopLyric.enable')) {
      const value = global.lx.appSetting['desktopLyric.enable']
      if (global.lx.appSetting['externalLyric.desktop.enabled'] !== value) save({ 'externalLyric.desktop.enabled': value })
    }
    if (keys.some(key => key.startsWith('externalLyric.'))) updateWindows(keys)
  })
  global.lx.event_app.on('hot_key_down', ({ key }) => {
    const info = global.lx.hotKey.config.global.keys[key]
    if (info?.type !== APP_EVENT_NAMES.winLyricName) return
    const names: Record<string, keyof ExternalLyricSettings> = { [HOTKEY_DESKTOP_LYRIC.toggle_visible.action]: 'externalLyric.desktop.enabled', [HOTKEY_DESKTOP_LYRIC.toggle_lock.action]: 'externalLyric.desktop.locked', [HOTKEY_DESKTOP_LYRIC.toggle_always_top.action]: 'externalLyric.desktop.alwaysOnTop' }
    const settingKey = names[info.action]
    if (settingKey) save({ [settingKey]: !global.lx.appSetting[settingKey] })
  })
  const recover = () => { for (const [mode, win] of lyricWindows) { if (mode === 'island') positionIsland(win); else if (mode === 'desktop') geometries.get(win)!.setBounds(fit(geometries.get(win)!.getBounds())) }; host?.configure(getExternalLyricConfig(global.lx.appSetting, 'taskbar')) }
  screen.on('display-removed', recover)
  screen.on('display-metrics-changed', recover)
  global.lx.event_app.on('main_window_close', () => { ready = false; for (const mode of modes) close(mode) })
  app.on('before-quit', () => { shuttingDown = true; for (const mode of modes) close(mode) })
}
