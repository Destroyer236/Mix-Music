import fs from 'node:fs'
import path from 'node:path'
import { extractWallpaperPalette } from './wallpaperPalette'
import type { WallpaperRecord } from './wallpaperFile'

const MAX_PIXELS = 40 * 1024 * 1024
/** Read common image dimensions before decode, bounding a hostile/accidental huge upload. */
export function imageDimensions(bytes: Uint8Array): { width: number, height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start: number, size: number) => String.fromCharCode(...bytes.subarray(start, start + size))
  let width = 0; let height = 0
  let orientation = 1
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') { width = view.getUint32(16); height = view.getUint32(20) } else if (bytes.length >= 26 && ascii(0, 2) === 'BM') { width = Math.abs(view.getInt32(18, true)); height = Math.abs(view.getInt32(22, true)) } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const chunk = ascii(offset, 4)
      const length = view.getUint32(offset + 4, true)
      const p = offset + 8
      if (p + length > bytes.length) break
      if (chunk === 'VP8X' && length >= 10) { width = 1 + bytes[p + 4] + (bytes[p + 5] << 8) + (bytes[p + 6] << 16); height = 1 + bytes[p + 7] + (bytes[p + 8] << 8) + (bytes[p + 9] << 16); break }
      if (chunk === 'VP8 ' && length >= 10 && ascii(p + 3, 3) === '\x9d\x01\x2a') { width = view.getUint16(p + 6, true) & 16383; height = view.getUint16(p + 8, true) & 16383; break }
      if (chunk === 'VP8L' && length >= 5 && bytes[p] === 47) { const bits = view.getUint32(p + 1, true); width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383); break }
      offset = p + length + length % 2
    }
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if (marker === 225 && length >= 16 && ascii(offset + 2, 6) === 'Exif\x00\x00') {
        const start = offset + 8
        const end = offset + length
        const little = ascii(start, 2) === 'II'
        if ((little || ascii(start, 2) === 'MM') && view.getUint16(start + 2, little) === 42) {
          const directory = start + view.getUint32(start + 4, little)
          if (directory >= start + 8 && directory + 2 <= end) {
            const count = view.getUint16(directory, little)
            for (let i = 0; i < count && directory + 2 + (i + 1) * 12 <= end; i++) {
              const entry = directory + 2 + i * 12
              if (view.getUint16(entry, little) === 274 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) orientation = view.getUint16(entry + 8, little)
            }
          }
        }
      }
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) { height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break }
      offset += length
    }
  }
  if (!width || !height) throw new Error('请选择有效的 JPG、PNG、WebP 或 BMP 图片。')
  if (width > 16000 || height > 16000 || width * height > MAX_PIXELS) throw new Error('图片分辨率过大，请选择不超过 4000 万像素的图片。')
  if (orientation >= 5 && orientation <= 8) [width, height] = [height, width]
  return { width, height }
}
export function wallpaperSize(width: number, height: number) {
  const scale = Math.min(1, 2560 / width, 2560 / height, Math.sqrt(2560 * 1440 / (width * height)))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}
export async function prepareWallpaper(filename: string): Promise<{ bytes: Uint8Array, info: Omit<WallpaperRecord, 'version' | 'file'> }> {
  const stat = await fs.promises.stat(filename)
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('请选择不超过 32 MB 的图片。')
  const source = await fs.promises.readFile(filename)
  const rawSize = imageDimensions(source)
  const size = wallpaperSize(rawSize.width, rawSize.height)
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(source).buffer]), { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high', imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  const sample = document.createElement('canvas')
  try {
    canvas.width = size.width; canvas.height = size.height
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('无法处理背景图片。')
    ctx.fillStyle = '#eceef0'; ctx.fillRect(0, 0, size.width, size.height)
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)
    bitmap.close()
    sample.width = 64; sample.height = 64
    const sampling = sample.getContext('2d', { willReadFrequently: true })
    if (!sampling) throw new Error('无法分析图片颜色。')
    sampling.drawImage(canvas, 0, 0, 64, 64)
    const palette = extractWallpaperPalette(sampling.getImageData(0, 0, 64, 64).data)
    const encoded = await new Promise<Blob>((resolve, reject) => { canvas.toBlob(blob => { if (blob?.type === 'image/webp') resolve(blob); else reject(new Error('图片编码失败，请选择另一张图片。')) }, 'image/webp', 0.86) })
    return { bytes: new Uint8Array(await encoded.arrayBuffer()), info: { name: path.basename(filename).slice(0, 255), ...size, palette } }
  } finally { bitmap.close(); canvas.width = canvas.height = sample.width = sample.height = 0 }
}
