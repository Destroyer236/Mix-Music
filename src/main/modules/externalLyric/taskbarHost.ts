import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import path from 'node:path'
import { app, screen, type BrowserWindow } from 'electron'
import { getExternalLyricConfig, type TaskbarLyricConfig } from '@common/externalLyric'
import { taskbarNativeScript } from './taskbarNative'

export interface TaskbarHost {
  configure: (config: TaskbarLyricConfig) => void
  contentWidth: (width: number) => void
  stop: () => void
}
interface NativeRect { x: number, y: number, width: number, height: number }
interface NativeLayout {
  space: { left: NativeRect, right: NativeRect }
  extra: { isCentered: boolean, isLight: boolean, systemType: 'win10' | 'win11', scale?: number, reattached?: boolean }
}
interface WindowRegion extends NativeRect { anchor: 'left' | 'right' }

/** Windows' built-in .NET/Win32 bridge avoids an Electron ABI-specific native addon. */
export function startTaskbarHost(win: BrowserWindow, onLayout: (layout: Record<string, unknown> & { maxWidth: number }) => void, onError: (error: Error) => void): TaskbarHost {
  const folder = mkdtempSync(path.join(app.getPath('temp'), 'linkline-taskbar-'))
  const script = path.join(folder, 'host.ps1')
  writeFileSync(script, '\uFEFF' + taskbarNativeScript, 'utf8')
  const nativeHandle = win.getNativeWindowHandle()
  const handle = nativeHandle.length >= 8 ? nativeHandle.readBigUInt64LE().toString() : nativeHandle.readUInt32LE().toString()
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', script, '-WindowHandle', handle, '-OwnerProcess', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stopped = false
  let buffer = ''
  let errors = ''
  let preferences = getExternalLyricConfig(global.lx.appSetting, 'taskbar')
  let layout: NativeLayout | undefined
  let region: WindowRegion | undefined
  let published = ''
  let appliedShape = ''
  let contentWidth = 0
  let cleanupDone = false
  let heartbeatTimeout: NodeJS.Timeout | undefined
  function cleanup() { if (cleanupDone) return; cleanupDone = true; try { unlinkSync(script); rmdirSync(folder) } catch {} }
  const timeout = setTimeout(() => { if (!layout) fail(new Error(errors || '任务栏布局初始化超时')) }, 30000)
  function fail(error: Error) {
    if (stopped) return
    stop()
    onError(error)
  }
  function heartbeat() {
    // Heartbeats run on the native service thread. A blocked UIAutomation scan
    // cannot keep this watchdog alive while the layout is unchanged.
    clearTimeout(heartbeatTimeout)
    heartbeatTimeout = setTimeout(() => { fail(new Error('任务栏宿主响应超时')) }, 30000)
  }
  function command(value: unknown) { if (!stopped && child.stdin.writable) child.stdin.write(JSON.stringify(value) + '\n') }
  function shape() {
    if (!region || win.isDestroyed()) return
    const width = preferences.autoMaxWidth && preferences.autoAdjustOccupiedSpace && contentWidth > 0 ? Math.min(region.width, Math.max(120, Math.ceil(contentWidth))) : region.width
    const rectangles = width < region.width ? [{ x: region.anchor === 'right' ? region.width - width : 0, y: 0, width, height: region.height }] : []
    const key = JSON.stringify(rectangles)
    if (key === appliedShape) return
    win.setShape(rectangles)
    appliedShape = key
  }
  function applyLayout(reattached = false) {
    if (!layout || stopped || win.isDestroyed()) return
    const { left, right } = layout.space
    const position = preferences.position
    let picked: NativeRect | undefined
    let anchor: 'left' | 'right' = 'right'
    if (position === 'left' && left.width > 0) { picked = left; anchor = 'left' } else if (position === 'right' && right.width > 0) picked = right
    else if (position === 'auto' && layout.extra.isCentered && left.width >= right.width) { picked = left; anchor = 'left' } else if (right.width > 0) picked = right
    else if (left.width > 0) { picked = left; anchor = 'left' }
    const scale = Number.isFinite(layout.extra.scale) && layout.extra.scale! > 0 ? layout.extra.scale! : screen.getPrimaryDisplay().scaleFactor
    const availableWidth = picked ? Math.round(picked.width / scale) - preferences.leftMargin - preferences.rightMargin : 0
    const height = picked ? Math.round(picked.height / scale) : 0
    const width = preferences.autoMaxWidth ? availableWidth : Math.min(preferences.maxWidth, availableWidth)
    const visible = width >= 120 && height > 0
    if (visible && picked) {
      const next: WindowRegion = {
        x: Math.round(picked.x / scale) + preferences.leftMargin + (anchor === 'right' ? availableWidth - width : 0),
        y: Math.round(picked.y / scale),
        width,
        height,
        anchor,
      }
      // The native HWND is already embedded. Keep Electron's compositor and
      // HWND in the same parent-relative bounds, only when the region changes.
      if (reattached || !region || ['x', 'y', 'width', 'height'].some(key => next[key as keyof NativeRect] !== region![key as keyof NativeRect])) win.setBounds({ x: next.x, y: next.y, width, height })
      region = next
      if (reattached) appliedShape = ''
      shape()
    }
    const result = { anchor, isCentered: layout.extra.isCentered, isLight: layout.extra.isLight, systemType: layout.extra.systemType, maxWidth: visible ? width : 0, height }
    const key = JSON.stringify(result)
    if (key !== published || reattached || (visible && !win.isVisible())) {
      published = key
      onLayout({ ...result, reattached })
    }
  }
  function configure(value: TaskbarLyricConfig) {
    preferences = value
    command({ width: value.maxWidth })
    applyLayout()
  }
  function stop() {
    if (stopped) return
    command({ stop: true })
    stopped = true
    clearTimeout(timeout)
    clearTimeout(heartbeatTimeout)
    child.stdin.end()
    const kill = setTimeout(() => { if (child.exitCode === null) child.kill(); cleanup() }, 2000)
    kill.unref()
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1)
      if (!line || stopped || win.isDestroyed()) continue
      try {
        const next = JSON.parse(line) as NativeLayout & { heartbeat?: boolean }
        if (next.heartbeat === true) { heartbeat(); continue }
        if (!next.space || !next.extra || ![next.space.left, next.space.right].every(rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))) continue
        layout = next
        clearTimeout(timeout)
        heartbeat()
        applyLayout(next.extra.reattached === true)
      } catch (error) { console.error('Taskbar layout response:', error) }
    }
  })
  child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-3000) })
  child.stdin.on('error', () => {})
  child.on('error', error => { cleanup(); fail(error) })
  child.on('exit', code => { cleanup(); fail(new Error(errors || `任务栏宿主已退出 (${code ?? 'unknown'})`)) })
  configure(preferences)
  return { configure, contentWidth(width) { contentWidth = width; shape() }, stop }
}
