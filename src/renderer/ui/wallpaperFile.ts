import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { WallpaperPalette } from './wallpaperPalette'

export interface WallpaperRecord { version: 1, file: string, name: string, width: number, height: number, palette: WallpaperPalette }
const filenamePattern = /^background-[a-f0-9]{64}\.webp$/
export function parseWallpaper(text: string): WallpaperRecord {
  const value = JSON.parse(text)
  if (!value || value.version !== 1 || !filenamePattern.test(value.file) || typeof value.name !== 'string' || value.name.length > 255 || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 2560 || value.height > 2560 || value.width * value.height > 2560 * 1440 || !value.palette || !/^#[a-f0-9]{6}$/i.test(value.palette.seed) || !/^#[a-f0-9]{6}$/i.test(value.palette.average) || typeof value.palette.dark !== 'boolean') throw new Error('背景记录无法识别，请重新选择图片。')
  return { version: 1, file: value.file, name: value.name, width: value.width, height: value.height, palette: { seed: value.palette.seed, average: value.palette.average, dark: value.palette.dark } }
}
/** Managed files only; original uploads and other theme files are never deleted. */
export class WallpaperFile {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly directory: string) {}
  url(record: WallpaperRecord) { return pathToFileURL(path.join(this.directory, record.file)).href }
  async read(): Promise<WallpaperRecord | null> {
    try {
      const manifest = path.join(this.directory, 'current.json')
      if ((await fs.promises.stat(manifest)).size > 4096) throw new Error('背景记录过大，请重新选择图片。')
      const record = parseWallpaper(await fs.promises.readFile(manifest, 'utf8'))
      const stat = await fs.promises.stat(path.join(this.directory, record.file))
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || stat.size < 12) throw new Error('已保存的背景图片无法读取，请重新选择图片。')
      return record
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (!fs.existsSync(path.join(this.directory, 'current.json'))) return null
        throw new Error('已保存的背景图片已丢失，请重新选择图片。')
      }
      throw error
    }
  }

  async save(bytes: Uint8Array, info: Omit<WallpaperRecord, 'version' | 'file'>): Promise<WallpaperRecord> {
    const next = this.queue.then(async() => {
      if (bytes.length > 8 * 1024 * 1024 || bytes.length < 12 || Buffer.from(bytes.subarray(0, 4)).toString() !== 'RIFF' || Buffer.from(bytes.subarray(8, 12)).toString() !== 'WEBP') throw new Error('图片处理失败，请选择另一张图片。')
      const file = `background-${createHash('sha256').update(bytes).digest('hex')}.webp`
      const record = parseWallpaper(JSON.stringify({ ...info, version: 1, file }))
      await fs.promises.mkdir(this.directory, { recursive: true })
      const target = path.join(this.directory, file)
      await fs.promises.writeFile(target + '.tmp', bytes)
      await fs.promises.rename(target + '.tmp', target)
      const manifest = path.join(this.directory, 'current.json')
      await fs.promises.writeFile(manifest + '.tmp', JSON.stringify(record) + '\n', 'utf8')
      await fs.promises.rename(manifest + '.tmp', manifest)
      // Keep the previous image for an already-rendered window; at most two managed images.
      try {
        const candidates = await fs.promises.readdir(this.directory)
        const older = await Promise.all(candidates.filter(name => filenamePattern.test(name) && name !== file).map(async name => ({ name, time: (await fs.promises.stat(path.join(this.directory, name))).mtimeMs })))
        older.sort((a, b) => b.time - a.time)
        await Promise.all(older.slice(1).map(async item => { await fs.promises.unlink(path.join(this.directory, item.name)).catch(() => {}) }))
      } catch { /* Committed image remains usable when an old file is in use. */ }
      return record
    })
    this.queue = next.catch(() => {})
    return next
  }
}
