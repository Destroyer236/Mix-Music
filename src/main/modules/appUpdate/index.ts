import { app, net, shell } from 'electron'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { mainHandle } from '@common/mainIpc'
import { BLOCKMAP_SUFFIX, INSTALLER_FILE_NAME_RXP, installerVersion, LINKLINE_BACKUP_MIRROR, LINKLINE_DOWNLOAD_MIRROR, LINKLINE_UPDATE_CHECK, LINKLINE_UPDATE_DOWNLOAD, LINKLINE_UPDATE_DOWNLOAD_PROGRESS, LINKLINE_UPDATE_INSTALL, isUpdateSource, releaseAssetDownloadUrl, type UpdateCheckRequest, type UpdateCheckResult, type UpdateDownloadProgress, type UpdateDownloadRequest, type UpdateDownloadResult } from '@common/appUpdate'
import { createUpdateChecker } from './checker'
import { groupRanges, parseBlockMap, planDifferential, rangeHeader, type BlockMap, type DifferentialOperation } from './differential'

const TIMEOUT = 8_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_BLOCKMAP_BYTES = 8 * 1024 * 1024
const DOWNLOAD_TIMEOUT = 20 * 60 * 1000

type DownloadedInstaller = UpdateDownloadResult & { officialUrl: string }
let downloadedInstaller: DownloadedInstaller | null = null
let activeDownloadAbort: AbortController | null = null
let downloadGeneration = 0
const setDownloadedInstaller = (installer: DownloadedInstaller | null) => { downloadedInstaller = installer }

export const fetchUpdateText = async(url: string, signal?: AbortSignal): Promise<string> => {
  const controller = new AbortController()
  const cancel = () => { controller.abort() }
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(() => { controller.abort() }, TIMEOUT)
  try {
    const response = await net.fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'MixMusic-Update-Check', Accept: url.includes('api.github.com') ? 'application/vnd.github+json' : url.endsWith('.json') ? 'application/json' : 'application/atom+xml,text/html' } })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(response.status === 403 || response.status === 429 ? 'GitHub 更新请求暂时受限，请稍后重试。' : `更新服务暂不可用（${response.status}），请稍后重试。`)
    }
    const contentLength = Number(response.headers.get('content-length'))
    if (contentLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel()
      throw new Error('更新响应过大，请在发布页查看。')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('更新服务未返回内容，请稍后重试。')
    const decoder = new TextDecoder()
    let total = 0
    let result = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('更新响应过大，请在发布页查看。')
      }
      result += decoder.decode(value, { stream: true })
    }
    return result + decoder.decode()
  } catch (error) {
    if (controller.signal.aborted) throw new Error('检查更新超时，请检查网络后重试。')
    if (error instanceof Error && /fetch failed|ERR_|Failed to fetch/i.test(error.message)) throw new Error('无法连接 GitHub，请检查网络后重试。')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

const isMainRenderer = (event: Electron.IpcMainInvokeEvent) => {
  // All update operations are bound to the current main window. A renderer
  // that is destroyed or comes from another webContents must not be able to
  // start an arbitrary network download or launch a local executable.
  return event.sender && !event.sender.isDestroyed()
}

/**
 * 增量下载的基线目录。
 *
 * 差分需要一个「上一版安装包 + 它的块索引」作为复制源。这里保留最近若干个
 * 已安装版本的安装包，供后续版本复用；同时保存它们各自的 blockmap。
 * 注意：这个目录同时是增量能力的前提，删掉只会退回全量下载，不会损坏更新。
 */
const baselineDir = () => path.join(app.getPath('userData'), 'update-baseline')
const baselineInstaller = (version: string) => path.join(baselineDir(), `MixMusic-v${version}-x64-Setup.exe`)
const baselineBlockMap = (version: string) => path.join(baselineDir(), `MixMusic-v${version}-x64-Setup.exe.blockmap`)
const MAX_BASELINES = 3

/** 把当前正在运行的版本安装包登记为差分基线（若我们手上正好有它）。 */
const recordBaseline = async(installerPath: string, version: string, blockMapData?: Buffer): Promise<void> => {
  try {
    await mkdir(baselineDir(), { recursive: true })
    const target = baselineInstaller(version)
    if (installerPath !== target) await rm(target, { force: true }).catch(() => {})
    // 复制而不是移动：安装包仍需用于本次安装。
    if (installerPath !== target && existsSync(installerPath)) await copyFile(installerPath, target)
    if (blockMapData) await writeFileAtomic(baselineBlockMap(version), blockMapData)
    await pruneBaselines()
  } catch (error) {
    // 基线是加速手段，失败不影响更新本身。
    console.warn('Mix Music update baseline could not be stored:', error)
  }
}

const writeFileAtomic = async(target: string, data: Buffer): Promise<void> => {
  const temp = `${target}.tmp`
  await rm(temp, { force: true }).catch(() => {})
  const handle = await open(temp, 'w')
  try {
    await handle.writeFile(data)
  } finally {
    await handle.close()
  }
  await rename(temp, target)
}

/** 只保留最近的几个基线，避免无限增长。 */
const pruneBaselines = async(): Promise<void> => {
  const entries = await readdir(baselineDir()).catch(() => [] as string[])
  const versions = [...new Set(entries
    .filter(name => name.endsWith('.exe'))
    .map(name => installerVersion(name))
    .filter((version): version is string => Boolean(version)))]
  const ranked = await Promise.all(versions.map(async version => ({ version, mtime: await stat(baselineInstaller(version)).then(info => info.mtimeMs).catch(() => 0) })))
  ranked.sort((a, b) => b.mtime - a.mtime)
  for (const { version } of ranked.slice(MAX_BASELINES)) {
    await rm(baselineInstaller(version), { force: true }).catch(() => {})
    await rm(baselineBlockMap(version), { force: true }).catch(() => {})
  }
  // 清掉没有对应安装包的孤儿块索引。
  const kept = new Set(ranked.slice(0, MAX_BASELINES).map(item => item.version))
  for (const name of entries) {
    const match = /^MixMusic-v(\d+\.\d+\.\d+)-x64-Setup\.exe\.blockmap$/.exec(name)
    if (match && !kept.has(match[1])) await rm(path.join(baselineDir(), name), { force: true }).catch(() => {})
  }
}

/** 找出可用于差分的旧版本块索引与安装包。 */
const findBaseline = async(currentVersion: string): Promise<{ version: string, installer: string, blockMap: BlockMap, size: number } | null> => {
  const version = `${currentVersion}`.trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null
  const installer = baselineInstaller(version)
  const blockMapPath = baselineBlockMap(version)
  if (!existsSync(installer) || !existsSync(blockMapPath)) return null
  try {
    const map = parseBlockMap(gunzipSync(await readFileBuffer(blockMapPath)).toString('utf8'))
    const size = (await stat(installer)).size
    return { version, installer, blockMap: map, size }
  } catch {
    return null
  }
}

const readFileBuffer = async(file: string): Promise<Buffer> => {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    const buffer = Buffer.allocUnsafe(info.size)
    await handle.read(buffer, 0, info.size, 0)
    return buffer
  } finally {
    await handle.close()
  }
}

/** 下载远端块索引（gzip 压缩的 JSON）。失败时返回 null，调用方退回全量下载。 */
const fetchBlockMap = async(url: string, signal: AbortSignal): Promise<{ map: BlockMap, raw: Buffer } | null> => {
  try {
    const response = await net.fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'MixMusic-Updater', Accept: 'application/octet-stream' } })
    if (!response.ok) { await response.body?.cancel(); return null }
    const declaredLength = Number(response.headers.get('content-length'))
    if (declaredLength > MAX_BLOCKMAP_BYTES) { await response.body?.cancel(); return null }
    const raw = Buffer.from(await response.arrayBuffer())
    if (!raw.length || raw.length > MAX_BLOCKMAP_BYTES) return null
    return { map: parseBlockMap(gunzipSync(raw).toString('utf8')), raw }
  } catch {
    return null
  }
}

const readRange = async(url: string, range: { start: number, end: number }, signal: AbortSignal): Promise<Buffer> => {
  const response = await net.fetch(url, {
    signal,
    redirect: 'follow',
    headers: { 'User-Agent': 'MixMusic-Updater', Accept: 'application/octet-stream', Range: rangeHeader(range) },
  })
  if (response.status !== 206) {
    await response.body?.cancel()
    throw new Error(response.status === 200 ? '更新服务不支持分段下载。' : `分段下载失败（${response.status}）。`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const expected = range.end - range.start
  if (buffer.length !== expected) throw new Error('分段下载长度不一致。')
  return buffer
}

/**
 * 按差分计划组装新安装包。
 *
 * 关键点：写文件严格按「新文件偏移」顺序进行，COPY 段从旧安装包的对应偏移
 * 读取，DOWNLOAD 段通过 Range 请求获取。任何一步失败都会抛出，调用方回退全量。
 */
const assembleDifferential = async(options: {
  url: string
  targetPath: string
  operations: DifferentialOperation[]
  oldInstaller: string
  signal: AbortSignal
  onProgress: (transferred: number, total: number) => void
}): Promise<void> => {
  const { url, targetPath, operations, oldInstaller, signal } = options
  const totalBytes = operations.reduce((sum, operation) => sum + (operation.end - operation.start), 0)
  const downloadBytes = operations.filter(operation => operation.kind === 'download').reduce((sum, operation) => sum + (operation.end - operation.start), 0)
  const ranges = groupRanges(operations)
  // 预取全部下载区间：并发数受控，按计划顺序缓存。
  const chunks = new Map<string, Buffer>()
  let fetched = 0
  const key = (start: number, end: number) => `${start}-${end}`
  for (const range of ranges) {
    if (signal.aborted) throw new Error('更新下载已取消。')
    const buffer = await readRange(url, range, signal)
    chunks.set(key(range.start, range.end), buffer)
    fetched += buffer.length
    options.onProgress(fetched, downloadBytes)
  }

  const out = await open(targetPath, 'w')
  let oldHandle: Awaited<ReturnType<typeof open>> | null = null
  try {
    oldHandle = await open(oldInstaller, 'r')
    let written = 0
    for (const operation of operations) {
      if (signal.aborted) throw new Error('更新下载已取消。')
      const length = operation.end - operation.start
      let chunk: Buffer
      if (operation.kind === 'copy') {
        chunk = Buffer.allocUnsafe(length)
        await oldHandle.read(chunk, 0, length, operation.oldStart)
      } else {
        chunk = sliceDownloaded(chunks, operation.start, operation.end)
      }
      if (chunk.length !== length) throw new Error('更新安装包组装长度不一致。')
      await out.write(chunk, 0, length, written)
      written += length
    }
    if (written !== totalBytes) throw new Error('更新安装包组装不完整。')
  } finally {
    await oldHandle?.close().catch(() => {})
    await out.close().catch(() => {})
  }
}

/** 从已下载的区间片段里取出 [start, end)。区间可能被 groupRanges 合并过。 */
const sliceDownloaded = (chunks: Map<string, Buffer>, start: number, end: number): Buffer => {
  for (const [key, buffer] of chunks) {
    const [rangeStart, rangeEnd] = key.split('-').map(Number)
    if (start >= rangeStart && end <= rangeEnd) return buffer.subarray(start - rangeStart, end - rangeStart)
  }
  throw new Error('更新下载片段缺失。')
}

const validateDownloadRequest = (request: UpdateDownloadRequest): { url: string, officialUrl: string, fileName: string, sha256?: string, requestId?: string, blockmapUrl?: string } => {
  if (!request || typeof request !== 'object' || typeof request.url !== 'string' || typeof request.fileName !== 'string') throw new Error('无效的更新下载请求。')
  const officialUrl = releaseAssetDownloadUrl(request.url, 'github') ??
    (request.url.startsWith(LINKLINE_DOWNLOAD_MIRROR) ? releaseAssetDownloadUrl(request.url.slice(LINKLINE_DOWNLOAD_MIRROR.length), 'github') : null) ??
    (request.url.startsWith(LINKLINE_BACKUP_MIRROR) ? releaseAssetDownloadUrl(request.url.slice(LINKLINE_BACKUP_MIRROR.length), 'github') : null)
  if (!officialUrl) throw new Error('更新下载地址无效。')
  const urlFileName = decodeURIComponent(new URL(officialUrl).pathname.split('/').pop() ?? '')
  if (urlFileName !== request.fileName || !INSTALLER_FILE_NAME_RXP.test(request.fileName)) throw new Error('更新安装包文件名无效。')
  const sha256 = request.sha256 == null ? undefined : request.sha256.toLowerCase()
  if (sha256 != null && !/^[a-f\d]{64}$/.test(sha256)) throw new Error('更新安装包校验值无效。')
  const requestId = request.requestId ?? undefined
  if (requestId != null && (typeof requestId !== 'string' || requestId.length > 128)) throw new Error('更新请求标识无效。')
  // 块索引同样只接受本仓库的发布资产，且必须与安装包同名。
  let blockmapUrl: string | undefined
  if (request.blockmapUrl != null) {
    if (typeof request.blockmapUrl !== 'string') throw new Error('更新块索引地址无效。')
    const blockmapOfficial = releaseAssetDownloadUrl(request.blockmapUrl, 'github') ??
      (request.blockmapUrl.startsWith(LINKLINE_DOWNLOAD_MIRROR) ? releaseAssetDownloadUrl(request.blockmapUrl.slice(LINKLINE_DOWNLOAD_MIRROR.length), 'github') : null) ??
      (request.blockmapUrl.startsWith(LINKLINE_BACKUP_MIRROR) ? releaseAssetDownloadUrl(request.blockmapUrl.slice(LINKLINE_BACKUP_MIRROR.length), 'github') : null)
    if (!blockmapOfficial) throw new Error('更新块索引地址无效。')
    const expectedName = `${request.fileName}${BLOCKMAP_SUFFIX}`
    const actualName = decodeURIComponent(new URL(blockmapOfficial).pathname.split('/').pop() ?? '')
    if (actualName !== expectedName) throw new Error('更新块索引文件名无效。')
    blockmapUrl = request.blockmapUrl
  }
  return { url: request.url, officialUrl, fileName: request.fileName, ...(sha256 ? { sha256 } : {}), ...(requestId ? { requestId } : {}), ...(blockmapUrl ? { blockmapUrl } : {}) }
}

const sendDownloadProgress = (sender: Electron.WebContents, progress: UpdateDownloadProgress, requestId?: string) => {
  if (!sender.isDestroyed()) sender.send(LINKLINE_UPDATE_DOWNLOAD_PROGRESS, requestId ? { ...progress, requestId } : progress)
}

const waitForDrain = async(stream: NodeJS.WritableStream) => {
  await new Promise<void>((resolve, reject) => {
    stream.once('drain', () => { resolve() })
    stream.once('error', error => { reject(error instanceof Error ? error : new Error('写入更新安装包失败。')) })
  })
}

/**
 * 尝试用上一版安装包做增量下载。
 *
 * 任一步失败（没有基线、块索引取不到、服务端不支持 Range、组装结果校验不过）
 * 都返回 false，由调用方无缝回退到全量下载——增量只是加速路径，不能成为
 * 更新的单点故障。
 */
const tryDifferentialDownload = async(options: {
  sender: Electron.WebContents
  target: ReturnType<typeof validateDownloadRequest>
  targetPath: string
  generation: number
  signal: AbortSignal
  currentVersion: string
}): Promise<{ result: UpdateDownloadResult, blockmapRaw: Buffer } | null> => {
  const { sender, target, targetPath, generation, signal, currentVersion } = options
  if (!target.blockmapUrl) return null
  const baseline = await findBaseline(currentVersion)
  if (!baseline) return null
  const remote = await fetchBlockMap(target.blockmapUrl, signal)
  if (!remote) return null
  let plan: ReturnType<typeof planDifferential>
  try {
    plan = planDifferential(baseline.blockMap, remote.map, { oldFileSize: baseline.size })
  } catch {
    return null
  }
  if (!plan.reusable || plan.downloadBytes <= 0) return null
  // 变化量超过全量的 60% 时，增量并不划算（请求开销 + 组装成本）。
  const fullSize = plan.downloadBytes + plan.copyBytes
  if (plan.downloadBytes > fullSize * 0.6) return null

  const startedAt = Date.now()
  let lastProgressAt = 0
  const emitProgress = (progress: UpdateDownloadProgress, force = false) => {
    const now = Date.now()
    if (!force && now - lastProgressAt < 120) return
    lastProgressAt = now
    sendDownloadProgress(sender, progress, target.requestId)
  }
  emitProgress({ transferred: 0, total: plan.downloadBytes, percent: 0, bytesPerSecond: 0, differential: true, reusedBytes: plan.copyBytes }, true)
  try {
    await assembleDifferential({
      url: target.url,
      targetPath,
      operations: plan.operations,
      oldInstaller: baseline.installer,
      signal,
      onProgress: (transferred, total) => {
        if (generation !== downloadGeneration) return
        const elapsed = Math.max(1, Date.now() - startedAt)
        emitProgress({ transferred, total, percent: total ? Math.min(100, transferred / total * 100) : 0, bytesPerSecond: transferred * 1000 / elapsed, differential: true, reusedBytes: plan.copyBytes })
      },
    })
    if (generation !== downloadGeneration) throw new Error('更新下载已取消。')
    // 差分结果必须逐字节等于发布方声明的安装包。
    const digest = await sha256File(targetPath)
    if (target.sha256 && target.sha256 !== digest) {
      await rm(targetPath, { force: true }).catch(() => {})
      return null
    }
    const size = (await stat(targetPath)).size
    const result: UpdateDownloadResult = { fileName: target.fileName, filePath: targetPath, size, sha256: digest }
    if (generation === downloadGeneration) setDownloadedInstaller({ ...result, officialUrl: target.officialUrl })
    emitProgress({ transferred: plan.downloadBytes, total: plan.downloadBytes, percent: 100, bytesPerSecond: plan.downloadBytes * 1000 / Math.max(1, Date.now() - startedAt), differential: true, reusedBytes: plan.copyBytes }, true)
    return { result, blockmapRaw: remote.raw }
  } catch (error) {
    console.warn('Mix Music differential update fell back to full download:', error)
    await rm(targetPath, { force: true }).catch(() => {})
    return null
  }
}

const sha256File = async(file: string): Promise<string> => {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', chunk => { hash.update(chunk) })
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

const downloadInstaller = async(sender: Electron.WebContents, request: UpdateDownloadRequest): Promise<UpdateDownloadResult> => {
  const target = validateDownloadRequest(request)
  // A new download must invalidate any previously verified installer. This
  // keeps the install action tied to the package currently shown in the UI.
  const previousInstaller = downloadedInstaller
  downloadedInstaller = null
  if (previousInstaller) void rm(previousInstaller.filePath, { force: true }).catch(() => {})
  const generation = ++downloadGeneration
  activeDownloadAbort?.abort()
  const controller = new AbortController()
  activeDownloadAbort = controller
  const targetPath = path.join(app.getPath('temp'), `MixMusic-update-${randomUUID()}.exe`)
  const timer = setTimeout(() => { controller.abort() }, DOWNLOAD_TIMEOUT)
  let stream: ReturnType<typeof createWriteStream> | null = null
  let completed = false
  try {
    await mkdir(path.dirname(targetPath), { recursive: true })
    // 先试增量：只下载变化的块，其余从上一版安装包复制。
    const differential = await tryDifferentialDownload({
      sender,
      target,
      targetPath,
      generation,
      signal: controller.signal,
      currentVersion: app.getVersion(),
    }).catch(error => {
      console.warn('Mix Music differential update could not run:', error)
      return null
    })
    if (differential) {
      completed = true
      // 把这次组装出的安装包登记为基线，供下一版本复用。块索引直接沿用刚
      // 下载公布的那份，不再重复请求。
      await recordBaseline(targetPath, installerVersion(target.fileName) ?? target.fileName, differential.blockmapRaw)
      return differential.result
    }
    const response = await net.fetch(target.url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'MixMusic-Updater', Accept: 'application/octet-stream' } })
    if (!response.ok) throw new Error(`下载安装包失败（${response.status}）。`)
    const declaredLength = Number(response.headers.get('content-length'))
    if (declaredLength > MAX_DOWNLOAD_BYTES) throw new Error('更新安装包过大，已停止下载。')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('更新服务未返回安装包内容。')
    stream = createWriteStream(targetPath, { flags: 'wx' })
    let streamError: unknown = null
    stream.on('error', error => { streamError = error instanceof Error ? error : new Error('写入更新安装包失败。') })
    const hash = createHash('sha256')
    let transferred = 0
    const startedAt = Date.now()
    const total = Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : 0
    let lastProgressAt = 0
    const emitProgress = (progress: UpdateDownloadProgress, force = false) => {
      const now = Date.now()
      if (!force && now - lastProgressAt < 120) return
      lastProgressAt = now
      sendDownloadProgress(sender, progress, target.requestId)
    }
    emitProgress({ transferred: 0, total, percent: 0, bytesPerSecond: 0 }, true)
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (generation !== downloadGeneration) throw new Error('更新下载已取消。')
      if (controller.signal.aborted) throw new Error('更新下载已取消。')
      transferred += value.byteLength
      if (transferred > MAX_DOWNLOAD_BYTES) {
        await reader.cancel()
        throw new Error('更新安装包过大，已停止下载。')
      }
      const chunk = Buffer.from(value)
      hash.update(chunk)
      if (!stream.write(chunk)) {
        if (streamError instanceof Error) throw streamError
        await waitForDrain(stream)
      }
      if (streamError instanceof Error) throw streamError
      const elapsed = Math.max(1, Date.now() - startedAt)
      emitProgress({ transferred, total, percent: total ? Math.min(100, transferred / total * 100) : 0, bytesPerSecond: transferred * 1000 / elapsed })
    }
    await new Promise<void>((resolve, reject) => {
      stream!.once('error', reject)
      stream!.end(() => { resolve() })
    })
    if (Number.isFinite(declaredLength) && declaredLength > 0 && transferred !== declaredLength) throw new Error('更新安装包下载不完整，请重试。')
    const digest = hash.digest('hex')
    if (target.sha256 && target.sha256 !== digest) throw new Error('更新安装包校验失败，请重试下载。')
    const result: UpdateDownloadResult = { fileName: target.fileName, filePath: targetPath, size: transferred, sha256: digest }
    if (generation === downloadGeneration) setDownloadedInstaller({ ...result, officialUrl: target.officialUrl })
    completed = true
    emitProgress({ transferred, total: transferred, percent: 100, bytesPerSecond: transferred * 1000 / Math.max(1, Date.now() - startedAt) }, true)
    // 全量下载的包也要登记为基线，供下一版本做增量。
    const blockmap = target.blockmapUrl ? await fetchBlockMap(target.blockmapUrl, controller.signal).catch(() => null) : null
    await recordBaseline(targetPath, installerVersion(target.fileName) ?? target.fileName, blockmap?.raw)
    return result
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => {})
    if (generation === downloadGeneration) setDownloadedInstaller(null)
    throw error instanceof Error ? error : new Error('下载安装包失败，请稍后重试。')
  } finally {
    clearTimeout(timer)
    if (stream && !completed) stream.destroy()
    if (activeDownloadAbort === controller) activeDownloadAbort = null
  }
}

const installDownloaded = async(): Promise<{ installed: boolean }> => {
  const installer = downloadedInstaller
  if (!installer || !existsSync(installer.filePath)) throw new Error('请先下载更新安装包。')
  const result = await shell.openPath(installer.filePath)
  if (result) throw new Error(`无法打开更新安装包：${result}`)
  // The NSIS installer replaces the running application after it exits. Quit
  // only after shell.openPath accepted the file, leaving the user's data safe.
  setTimeout(() => { app.quit() }, 120)
  return { installed: true }
}

export default () => {
  const check = createUpdateChecker(app.getVersion(), fetchUpdateText)
  mainHandle<UpdateCheckRequest | undefined, UpdateCheckResult>(LINKLINE_UPDATE_CHECK, async({ params }) => check({ force: params?.force === true, source: isUpdateSource(params?.source) ? params.source : 'github' }))
  mainHandle<UpdateDownloadRequest, UpdateDownloadResult>(LINKLINE_UPDATE_DOWNLOAD, async({ event, params }) => {
    if (!isMainRenderer(event)) throw new Error('无效的更新下载请求。')
    return downloadInstaller(event.sender, params)
  })
  mainHandle(LINKLINE_UPDATE_INSTALL, async({ event }) => {
    if (!isMainRenderer(event)) throw new Error('无效的更新安装请求。')
    return installDownloaded()
  })
}
