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
interface NativeLayout { x: number, y: number, width: number, height: number, isLight: boolean, anchor: 'left' | 'right' }

/** Windows' built-in .NET/Win32 bridge avoids an Electron ABI-specific native addon. */
export function startTaskbarHost(win: BrowserWindow, onLayout: (layout: Record<string, unknown> & { maxWidth: number }) => void, onError: (error: Error) => void): TaskbarHost {
  const folder = mkdtempSync(path.join(app.getPath('temp'), 'linkline-taskbar-'))
  const script = path.join(folder, 'host.ps1')
  writeFileSync(script, '\uFEFF' + taskbarNativeScript, 'utf8')
  const nativeHandle = win.getNativeWindowHandle()
  const handle = nativeHandle.length >= 8 ? nativeHandle.readBigUInt64LE().toString() : nativeHandle.readUInt32LE().toString()
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-WindowHandle', handle, '-OwnerProcess', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stopped = false
  let buffer = ''
  let errors = ''
  let preferences = getExternalLyricConfig(global.lx.appSetting, 'taskbar')
  let layout: NativeLayout | undefined
  let contentWidth = 0
  let cleanupDone = false
  function cleanup() { if (cleanupDone) return; cleanupDone = true; try { unlinkSync(script); rmdirSync(folder) } catch {} }
  const timeout = setTimeout(() => { if (!layout && !stopped) { onError(new Error(errors || '任务栏布局初始化超时')); stop() } }, 30000)
  function command(value: unknown) { if (!stopped && child.stdin.writable) child.stdin.write(JSON.stringify(value) + '\n') }
  function shape() {
    if (!layout || win.isDestroyed()) return
    const dip = screen.screenToDipRect(win, { x: layout.x, y: layout.y, width: layout.width, height: layout.height })
    const width = preferences.autoMaxWidth && preferences.autoAdjustOccupiedSpace && contentWidth > 0 ? Math.min(dip.width, Math.max(120, Math.ceil(contentWidth))) : dip.width
    win.setShape(width < dip.width ? [{ x: layout.anchor === 'right' ? Math.round(dip.width - width) : 0, y: 0, width: Math.round(width), height: Math.round(dip.height) }] : [])
  }
  function configure(value: TaskbarLyricConfig) {
    preferences = value
    // The taskbar can move to a monitor with a different scale. Its native
    // helper converts these DIP preferences using the taskbar HWND's own DPI.
    command({ position: value.position, width: value.maxWidth, auto: value.autoMaxWidth, left: value.leftMargin, right: value.rightMargin })
    shape()
  }
  function stop() {
    if (stopped) return
    command({ stop: true })
    stopped = true
    clearTimeout(timeout)
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
        const next = JSON.parse(line) as NativeLayout
        if (![next.x, next.y, next.width, next.height].every(Number.isFinite)) continue
        layout = next
        clearTimeout(timeout)
        const dip = screen.screenToDipRect(win, { x: next.x, y: next.y, width: next.width, height: next.height })
        // Electron updates Chromium's viewport; the host places the HWND in taskbar coordinates.
        if (dip.width >= 120 && dip.height > 0) { win.setSize(Math.round(dip.width), Math.round(dip.height)); command({ place: true }); shape() }
        onLayout({ anchor: next.anchor, isLight: next.isLight, maxWidth: dip.width, height: dip.height })
      } catch (error) { console.error('Taskbar layout response:', error) }
    }
  })
  child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-3000) })
  child.stdin.on('error', () => {})
  child.on('error', error => { clearTimeout(timeout); cleanup(); if (!stopped) { stopped = true; onError(error) } })
  child.on('exit', code => { clearTimeout(timeout); cleanup(); if (!stopped) { stopped = true; onError(new Error(errors || `任务栏宿主已退出 (${code ?? 'unknown'})`)) } })
  configure(preferences)
  return { configure, contentWidth(width) { contentWidth = width; shape() }, stop }
}
