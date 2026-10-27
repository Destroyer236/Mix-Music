export const LINKLINE_REPOSITORY = 'https://github.com/Destroyer236/Mix-Music'
/** 改名前的仓库。历史 Release 仍托管在这里，安装包链接继续有效。 */
export const LINKLINE_LEGACY_REPOSITORY = 'https://github.com/yaonikaixin999999/LinkLine'
export const LINKLINE_RELEASES_URL = `${LINKLINE_REPOSITORY}/releases`
export const LINKLINE_UPDATE_CHECK = 'linkline_update_check'
/** Request the main process to download a validated Mix Music installer. */
export const LINKLINE_UPDATE_DOWNLOAD = 'linkline_update_download'
/** Sent by the main process while an installer download is in progress. */
export const LINKLINE_UPDATE_DOWNLOAD_PROGRESS = 'linkline_update_download_progress'
/** Request the main process to launch the downloaded installer. */
export const LINKLINE_UPDATE_INSTALL = 'linkline_update_install'
export const LINKLINE_UPDATE_MANIFEST = 'https://raw.githubusercontent.com/Destroyer236/Mix-Music/main/updates/stable-linkline.json'
export const LINKLINE_DOWNLOAD_MIRROR = 'https://gh-proxy.com/'
export const LINKLINE_BACKUP_MIRROR = 'https://ghfast.top/'

/** 允许引用的仓库路径：当前仓库，以及托管历史版本的旧仓库。 */
export const RELEASE_REPOSITORY_PATH = /^\/(?:Destroyer236\/Mix-Music|yaonikaixin999999\/LinkLine)\//

/**
 * Windows 安装包文件名模板。发布产物用无空格的 `MixMusic` 前缀，
 * 改名前的历史 Release 仍是 `LinkLine`，两者都要能识别。
 */
export const INSTALLER_FILE_NAME = (version: string, productName = 'MixMusic') => `${productName}-v${version}-x64-Setup.exe`
export const INSTALLER_FILE_NAME_RXP = /^(?:MixMusic|LinkLine)-v\d+\.\d+\.\d+-x64-Setup\.exe$/i
/** 在 Release 资产里按版本挑出 x64 安装包，兼容改名前后两种命名。 */
export const findInstallerAsset = <T extends { name: string }>(assets: T[] | undefined, version: string): T | undefined => {
  const expected = INSTALLER_FILE_NAME(version).toLowerCase()
  const legacy = INSTALLER_FILE_NAME(version, 'LinkLine').toLowerCase()
  return assets?.find(asset => asset.name.toLowerCase() === expected) ?? assets?.find(asset => asset.name.toLowerCase() === legacy)
}

export type UpdateSource = 'github' | 'mirror'
export const UPDATE_SOURCES: Readonly<Record<UpdateSource, { label: string, description: string }>> = {
  github: { label: 'GitHub 官方', description: '从 Mix Music 的 GitHub 仓库检查版本并下载。' },
  mirror: { label: '国内加速（第三方）', description: '通过 GH-Proxy / GHFast 读取 Mix Music 的更新信息，使用第三方加速下载安装包。' },
}

export const isUpdateSource = (value: unknown): value is UpdateSource => value === 'github' || value === 'mirror'

/** Only Mix Music's own published release files can be sent through a mirror. */
export const releaseAssetDownloadUrl = (value: unknown, source: UpdateSource): string | null => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !/^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname)) return null
    if (!RELEASE_REPOSITORY_PATH.test(url.pathname)) return null
    return source === 'mirror' ? `${LINKLINE_DOWNLOAD_MIRROR}${url.href}` : url.href
  } catch { return null }
}

export interface AppReleaseAsset {
  name: string
  url: string
  size: number
  sha256?: string
  downloadUrl?: string
  /** 增量下载用的块索引；未提供时该版本只能全量下载。 */
  blockmapUrl?: string
}

/** 安装包对应的块索引地址：与安装包同目录、同名前缀加 `.blockmap`。 */
export const BLOCKMAP_SUFFIX = '.blockmap'
export const blockMapUrlFor = (installerUrl: string): string => `${installerUrl}${BLOCKMAP_SUFFIX}`

/** 在资产列表里找出指定安装包配套的块索引。 */
export const findBlockMapAsset = <T extends { name: string }>(assets: T[] | undefined, installerName: string): T | undefined => {
  const expected = `${installerName}.blockmap`.toLowerCase()
  return assets?.find(asset => asset.name.toLowerCase() === expected)
}

/** 从 `MixMusic-v1.2.3-x64-Setup.exe` 取出 `1.2.3`；无法识别时返回 null。 */
export const installerVersion = (fileName: string): string | null => {
  const match = /^(?:MixMusic|LinkLine)-v(\d+\.\d+\.\d+)-x64-Setup\.exe$/i.exec(fileName)
  return match ? match[1] : null
}

export interface AppRelease {
  version: string
  name: string
  body: string
  publishedAt: string
  pageUrl: string
  assets: AppReleaseAsset[]
}

export interface UpdateCheckRequest {
  force?: boolean
  source?: UpdateSource
}

export interface UpdateDownloadRequest {
  /** URL returned in the trusted update metadata. The main process validates it again. */
  url: string
  /** Expected installer filename, used to prevent arbitrary file writes. */
  fileName: string
  /** Optional SHA-256 digest advertised by the release. */
  sha256?: string
  /** Renderer-local token used to ignore progress from a superseded download. */
  requestId?: string
  /** 该版本可用的块索引地址（已验证属于本仓库）；缺省时只能全量下载。 */
  blockmapUrl?: string
}

export interface UpdateDownloadProgress {
  transferred: number
  total: number
  percent: number
  bytesPerSecond: number
  requestId?: string
  /** 本次下载使用了增量（差分）方式，只取了变化的字节。 */
  differential?: boolean
  /** 从本地旧安装包复用、无需下载的字节数。 */
  reusedBytes?: number
}

export interface UpdateDownloadResult {
  fileName: string
  filePath: string
  size: number
  sha256: string
}

export interface UpdateCheckResult {
  status: 'latest' | 'available' | 'unpublished' | 'error'
  currentVersion: string
  latestRelease: AppRelease | null
  history: AppRelease[]
  checkedAt: number
  source: UpdateSource
  requestedSource: UpdateSource
  usedFallback: boolean
  sourceLabel: string
  error: string | null
}

export interface UpdateManifest {
  schemaVersion: 1
  repository: typeof LINKLINE_REPOSITORY
  releases: AppRelease[]
}
