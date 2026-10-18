import type { BrowserWindow } from 'electron'

// Windows can round transparent window bounds up by one DIP at fractional scale
// factors. Feeding those native dimensions into the next move grows the window.
export class LyricWindowGeometry {
  private size: { width: number, height: number }
  private lastBounds: Electron.Rectangle | undefined

  constructor(private readonly win: BrowserWindow, size: { width: number, height: number }) {
    this.size = { width: Math.round(size.width), height: Math.round(size.height) }
  }

  getSize() { return { ...this.size } }

  getBounds(): Electron.Rectangle { return { ...this.win.getBounds(), ...this.size } }

  setBounds(bounds: Electron.Rectangle) {
    const next = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) }
    const current = this.win.getBounds()
    const sameSize = next.width === this.size.width && next.height === this.size.height
    const samePosition = current.x === next.x && current.y === next.y
    const repeatedPosition = this.lastBounds?.x === next.x && this.lastBounds.y === next.y && Math.abs(current.x - next.x) <= 1 && Math.abs(current.y - next.y) <= 1
    if (sameSize && (samePosition || repeatedPosition)) return false
    this.size = { width: next.width, height: next.height }
    this.lastBounds = next
    this.win.setBounds(next)
    return true
  }

  // Only will-resize (a user resize) may replace the logical size from native
  // bounds. Programmatic resize events include DPI rounding and must not do so.
  captureResize(bounds: Electron.Rectangle) {
    this.size = { width: Math.round(bounds.width), height: Math.round(bounds.height) }
    this.lastBounds = undefined
  }
}
