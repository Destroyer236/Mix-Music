/**
 * 安装包增量下载（差分）核心。
 *
 * 原理与 electron-updater 的 NSIS 差分一致：发布时安装包旁边会带一个
 * `.blockmap`（gzip 压缩的 JSON），里面是按 Rabin 指纹切出的内容块及其
 * BLAKE2b-18 校验值。下载新版本时，若本地还留着上一个版本的安装包，
 * 就能把「未变化的块」直接从旧文件拷过来，只对变化块发 Range 请求。
 *
 * 这里不依赖 electron-updater：项目的更新下载、校验与安装都是自研链路
 * （支持国内镜像与 SHA-256 清单），引入它的 autoUpdater 会推翻这些行为。
 */

export interface BlockMapFile {
  name: string
  offset: number
  checksums: string[]
  sizes: number[]
}

export interface BlockMap {
  version: string
  files: BlockMapFile[]
}

export type DifferentialOperationKind = 'copy' | 'download'

export interface DifferentialOperation {
  kind: DifferentialOperationKind
  /** 新文件中的起始偏移。 */
  start: number
  /** 新文件中的结束偏移（不含）。 */
  end: number
  /** kind === 'copy' 时，对应旧文件中的起始偏移。 */
  oldStart?: number
}

/** 解析 gzip 压缩的 blockmap JSON。调用方负责解压。 */
export const parseBlockMap = (input: string): BlockMap => {
  const data: unknown = JSON.parse(input)
  if (data == null || typeof data !== 'object') throw new Error('更新块索引不是有效对象。')
  const record = data as Record<string, unknown>
  const version = typeof record.version === 'string' ? record.version : ''
  if (!Array.isArray(record.files) || !record.files.length) throw new Error('更新块索引缺少文件条目。')
  const files: BlockMapFile[] = []
  for (const value of record.files) {
    if (value == null || typeof value !== 'object') throw new Error('更新块索引的文件条目无效。')
    const file = value as Record<string, unknown>
    const offset = Number(file.offset)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('更新块索引的偏移无效。')
    if (!Array.isArray(file.checksums) || !Array.isArray(file.sizes)) throw new Error('更新块索引缺少块信息。')
    if (file.checksums.length !== file.sizes.length || !file.checksums.length) throw new Error('更新块索引的块数量不一致。')
    const checksums: string[] = []
    const sizes: number[] = []
    for (let index = 0; index < file.checksums.length; index++) {
      const checksum = file.checksums[index]
      const size = Number(file.sizes[index])
      if (typeof checksum !== 'string' || !checksum) throw new Error('更新块索引包含无效校验值。')
      if (!Number.isSafeInteger(size) || size <= 0) throw new Error('更新块索引包含无效块大小。')
      checksums.push(checksum)
      sizes.push(size)
    }
    const total = sizes.reduce((sum, size) => sum + size, 0) + offset
    if (!Number.isSafeInteger(total)) throw new Error('更新块索引的尺寸溢出。')
    files.push({ name: typeof file.name === 'string' ? file.name : 'file', offset, checksums, sizes })
  }
  return { version, files }
}

/**
 * 比较新旧块索引，产出「整文件偏移」的复制/下载计划。
 *
 * 规则与 electron-updater 相同：只按校验值匹配，且大小必须一致；
 * 找不到对应旧块的新块一律下载。返回的区间是连续合并后的结果，
 * 以便把相邻块合并成一次 Range 请求。
 */
export const planDifferential = (oldMap: BlockMap | null, newMap: BlockMap, options: { oldFileSize?: number } = {}): { operations: DifferentialOperation[], downloadBytes: number, copyBytes: number, reusable: boolean } => {
  const newFile = newMap.files[0]
  if (!newFile) throw new Error('更新块索引缺少文件条目。')
  const newSize = newFile.offset + newFile.sizes.reduce((sum, size) => sum + size, 0)
  const oldFile = oldMap?.files[0]
  // 只有单个文件、版本号一致、且旧文件尺寸能覆盖全部复制区间时才做差分。
  const oldFileSize = options.oldFileSize ?? null
  // 块区域必须覆盖整个文件（offset 为 0）。NSIS 安装包的块索引始终如此；
  // 若非 0，说明有块索引之外的前置字节，我们没有对应的数据来源，不能差分。
  const coversWholeFile = newFile.offset === 0
  const versionMatches = oldMap != null && oldMap.version === newMap.version && coversWholeFile
  const checksumToOffset = new Map<string, number>()
  if (oldFile && versionMatches) {
    let offset = oldFile.offset
    for (let index = 0; index < oldFile.checksums.length; index++) {
      const checksum = oldFile.checksums[index]
      const size = oldFile.sizes[index]
      if (!checksumToOffset.has(checksum)) checksumToOffset.set(checksum, offset)
      offset += size
    }
  }
  const canCopy = (oldOffset: number, size: number) => oldFile != null && versionMatches && (oldFileSize == null || oldOffset + size <= oldFileSize)

  const operations: DifferentialOperation[] = []
  let downloadBytes = 0
  let copyBytes = 0
  let newOffset = newFile.offset
  const push = (operation: DifferentialOperation) => {
    const previous = operations[operations.length - 1]
    // 相同类型且首尾相接的区间合并，减少 Range 请求数。
    if (previous && previous.kind === operation.kind && previous.end === operation.start && (operation.kind !== 'copy' || previous.oldStart! + (previous.end - previous.start) === operation.oldStart)) {
      previous.end = operation.end
      return
    }
    operations.push({ ...operation })
  }
  for (let index = 0; index < newFile.checksums.length; index++) {
    const size = newFile.sizes[index]
    const checksum = newFile.checksums[index]
    const oldOffset = checksumToOffset.get(checksum)
    if (oldOffset != null && canCopy(oldOffset, size)) {
      push({ kind: 'copy', start: newOffset, end: newOffset + size, oldStart: oldOffset })
      copyBytes += size
    } else {
      push({ kind: 'download', start: newOffset, end: newOffset + size })
      downloadBytes += size
    }
    newOffset += size
  }
  if (newOffset !== newSize) throw new Error('更新块索引与实际尺寸不一致。')
  const reusable = versionMatches && operations.some(operation => operation.kind === 'copy')
  return { operations, downloadBytes, copyBytes, reusable }
}

/** 把下载区间合并成尽量少的 Range 请求（相邻或间隔很小的区间合并）。 */
export const groupRanges = (operations: DifferentialOperation[], options: { maxGap?: number, maxBytes?: number } = {}): Array<{ start: number, end: number }> => {
  const maxGap = options.maxGap ?? 1024
  const maxBytes = Math.max(1, options.maxBytes ?? 8 * 1024 * 1024)
  const ranges: Array<{ start: number, end: number }> = []
  const append = (start: number, end: number) => {
    // 单个区间超过上限时切成多段，避免镜像拒绝过大的 Range 请求。
    for (let offset = start; offset < end; offset += maxBytes) {
      const previous = ranges[ranges.length - 1]
      const stop = Math.min(end, offset + maxBytes)
      if (previous && previous.end === offset && stop - previous.start <= maxBytes) {
        previous.end = stop
      } else {
        ranges.push({ start: offset, end: stop })
      }
    }
  }
  for (const operation of operations) {
    if (operation.kind !== 'download') continue
    const previous = ranges[ranges.length - 1]
    // 小间隔直接并入，省一次请求；但单次请求不超过 maxBytes。
    if (previous && operation.start - previous.end <= maxGap && operation.end - previous.start <= maxBytes) {
      previous.end = operation.end
    } else {
      append(operation.start, operation.end)
    }
  }
  return ranges
}

/** Range 头。HTTP Range 的 end 是闭区间。 */
export const rangeHeader = (range: { start: number, end: number }) => `bytes=${range.start}-${range.end - 1}`

/**
 * 从 Content-Range 解析总大小。格式：`bytes 0-1023/123456`。
 * 无法解析时返回 null，由调用方决定是否要求严格校验。
 */
export const parseContentRange = (value: string | null): { start: number, end: number, total: number } | null => {
  if (typeof value !== 'string') return null
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(value.trim())
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  const total = Number(match[3])
  if (![start, end, total].every(Number.isSafeInteger) || end < start || total <= end) return null
  return { start, end, total }
}
