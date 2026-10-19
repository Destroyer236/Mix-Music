import { createHash } from 'node:crypto'
import type { ProviderContext } from './types'
import { songVip } from '@common/musicAccess'
import { audioStreams, protectedAudio, streamQuality, type AudioStream } from './qishuiStreams'

export type Json = Record<string, any>
export type QishuiMediaType = 'track' | 'ugc_clip'
export const object = (value: unknown): Json => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
export const text = (value: unknown): string => String(value ?? '').replace(/<[^>]*>/g, '').trim()
export const itemId = (value: unknown): string => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  const id = String(value ?? '')
  return /^[1-9]\d{0,24}$/.test(id) ? id : ''
}
export const officialHosts = new Set(['www.qishui.com', 'qishui.com', 'qishui.douyin.com', 'music.douyin.com'])
export const httpsUrl = (value: unknown): string => {
  try {
    const url = new URL(String(value ?? ''))
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : ''
  } catch { return '' }
}

export async function request(context: ProviderContext, path: string, query: Record<string, unknown> = {}, body?: Json): Promise<Json> {
  const url = new URL(path, 'https://api.qishui.com')
  const params = {
    aid: '386088',
    app_name: 'luna_pc',
    region: 'cn',
    geo_region: 'cn',
    os_region: 'cn',
    version_name: '3.7.0',
    version_code: '3.7.0',
    channel: 'official',
    build_mode: 'master',
    ac: 'wifi',
    tz_name: 'Asia/Shanghai',
    device_platform: 'windows',
    device_type: 'Windows',
    ...query,
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value ?? ''))
  const cookies = await context.cookies()
  const cookie = Object.entries(cookies).filter(([key, value]) => key && value && !/[\r\n;]/.test(key)).map(([key, value]) => `${key}=${value}`).join('; ')
  const headers = new Headers({ 'User-Agent': 'LunaPC/3.7.0(official)', Accept: 'application/json', 'x-luna-is-local-user': cookies.sessionid || cookies.sessionid_ss || cookies.sid_tt ? '1' : '0' })
  if (cookie) headers.set('Cookie', cookie)
  const encoded = body == null ? undefined : JSON.stringify(body)
  if (encoded != null) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
    headers.set('x-ss-stub', createHash('md5').update(encoded).digest('hex').toUpperCase())
  }
  const response = await context.session.fetch(url.toString(), { method: encoded == null ? 'GET' : 'POST', body: encoded, headers, credentials: 'include', signal: AbortSignal.timeout(20_000) })
  if (['bdturing-verify', 'x-tt-verify-passport-decision'].some(key => Boolean(response.headers.get(key)))) throw new Error('汽水音乐要求安全验证，请在官方客户端完成验证后重试')
  if (!response.ok) throw new Error(`汽水音乐请求失败 (${response.status})`)
  const raw = await response.text()
  if (!raw.trim()) throw new Error('汽水音乐接口暂未返回内容，请稍后重试')
  let result: Json
  try { result = object(JSON.parse(raw)) } catch { throw new Error('汽水音乐返回了无法识别的数据') }
  const code = Number(result.status_code ?? 0)
  if (code === 1000016) throw new Error('汽水音乐登录状态已失效，请重新登录')
  if (code !== 0) throw new Error(`汽水音乐：${text(object(result.status_info).status_msg ?? result.message) || '平台拒绝了请求'} (${code})`)
  return result
}

export function imageUrl(value: unknown): string {
  if (typeof value === 'string') return httpsUrl(value)
  const image = object(value)
  const base = typeof image.urls?.[0] === 'string' ? image.urls[0] : ''
  if (!image.uri) return httpsUrl(base)
  if (!base) return ''
  const suffix = image.template_prefix ? `${String(image.template_prefix)}-crop-center:400:400.jpg` : 'c5_400x400.jpg'
  return httpsUrl(`${base}${String(image.uri)}~${suffix}`)
}

export function toTrack(value: unknown, fallbackName = ''): LX.Music.MusicInfo_online_common | null {
  const item = object(value)
  const entity = object(item.entity)
  const track = object(object(entity.track_wrapper).track ?? entity.track ?? object(entity.ranked_track).track ?? item.track ?? item)
  const id = itemId(track.id)
  const name = text(track.name ?? track.title) || text(fallbackName)
  if (!id || !name) return null
  const album = object(track.album)
  const artists: Json[] = Array.isArray(track.artists) ? track.artists.map(object) : []
  const seconds = Math.floor(Math.max(0, Number(track.duration) || 0) / 1000)
  return {
    id: `qs_${id}`,
    source: 'qs',
    name,
    singer: artists.map(item => text(item.name)).filter(Boolean).join('、') || '未知歌手',
    interval: seconds ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : null,
    meta: {
      songId: id,
      ...(track.media_type === 'track' || track.media_type === 'ugc_clip' ? { qishuiMediaType: track.media_type as QishuiMediaType } : {}),
      isVip: songVip('qs', track),
      albumName: text(album.name),
      albumId: itemId(album.id),
      picUrl: imageUrl(album.url_cover) || imageUrl(track.url_cover) || imageUrl(artists[0]?.url_avatar),
      // The public share stream exposes no selectable native quality ladder.
      qualitys: [],
      _qualitys: {},
    },
  }
}

// Read the JSON assignment without executing page scripts or interpolated code.
export function extractRouterData(html: string): Json {
  const assignment = /(?:window\.)?_ROUTER_DATA\s*=\s*/g.exec(html)
  if (!assignment) throw new Error('汽水音乐分享页结构已变化，请稍后重试')
  const start = assignment.index + assignment[0].length
  if (html[start] !== '{') throw new Error('汽水音乐分享页数据格式错误')
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < html.length; index++) {
    const char = html[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{' || char === '[') depth++
    else if ((char === '}' || char === ']') && --depth === 0) {
      try { return object(JSON.parse(html.slice(start, index + 1))) } catch { break }
    }
  }
  throw new Error('汽水音乐分享页数据不完整')
}

export interface ShareAudio { option: Json, info: Json, url: string, expires: number }
export const trueFlag = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true'
export const falseFlag = (value: unknown): boolean => value === false || value === 0 || value === '0' || value === 'false'

interface SharePage { option: Json, info: Json, baseOption?: Json, streams?: Json[], playerInfoUrl?: string, source?: 'share' | 'seo' | QishuiMediaType }
class ShareTrackMismatch extends Error {}
class SharePageApiError extends Error {
  constructor(message: string, readonly code: number) { super(message) }
}
const shareHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36' }
const timeout = (signal?: AbortSignal, ms = 20_000) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)

async function readSharePage(context: ProviderContext, id: string, signal?: AbortSignal): Promise<SharePage & { refresh: boolean }> {
  // Sharing is a public web flow. Account cookies and cached SSR errors must
  // not affect it; the native account APIs use their own authenticated requests.
  const response = await context.session.fetch(`https://www.qishui.com/share/track?track_id=${id}&auto_play_bgm=1`, { headers: shareHeaders, signal: timeout(signal), credentials: 'omit', cache: 'no-store' })
  if (!response.ok) throw new Error(`汽水音乐分享页请求失败 (${response.status})`)
  const raw = await response.text()
  if (raw.length > 4_000_000) throw new Error('汽水音乐分享页内容异常')
  const loaders = object(extractRouterData(raw).loaderData)
  const page = [loaders.track_page, ...Object.values(loaders)].map(object).find(page => Object.keys(object(page.audioWithLyricsOption)).length) ?? {}
  const option = object(page.audioWithLyricsOption)
  const info = object(option.trackInfo)
  if (!Object.keys(option).length) throw new Error('汽水音乐分享页未返回歌曲数据')
  const code = Number(page.status_code || option.status_code || 0)
  if (code !== 0) throw new SharePageApiError(`汽水音乐分享页加载失败 (${code})`, code)
  if (itemId(info.id ?? option.track_id) !== id) throw new ShareTrackMismatch('汽水音乐分享页歌曲编号不一致')
  if (trueFlag(page.happenError)) throw new Error('汽水音乐分享页加载失败')
  const urls = [option.url, option.backup_url, ...(Array.isArray(option.backup_urls) ? option.backup_urls : [])].filter(value => typeof value === 'string')
  return { option, info, streams: urls.map(url => ({ ...option, url })), source: 'share', refresh: trueFlag(page.enable_ssr_cache) }
}

async function refreshedSharePage(context: ProviderContext, id: string, signal?: AbortSignal): Promise<SharePage> {
  // This is the same public refresh endpoint used by Qishui's share player.
  const response = await context.session.fetch(`https://beta-luna.douyin.com/luna/h5/seo_track?track_id=${id}&device_platform=web`, { headers: shareHeaders, signal: timeout(signal), credentials: 'omit', cache: 'no-store' })
  if (!response.ok) throw new Error(`汽水音乐音频信息请求失败 (${response.status})`)
  const raw = await response.text()
  if (!raw.trim()) throw new Error('汽水音乐音频信息暂未返回内容')
  if (raw.length > 4_000_000) throw new Error('汽水音乐音频信息内容异常')
  let body: Json
  try { body = object(JSON.parse(raw)) } catch { throw new Error('汽水音乐音频信息格式错误') }
  const code = Number(body.status_code ?? 0)
  if (code !== 0) throw new SharePageApiError(`汽水音乐音频信息加载失败 (${code})`, code)
  return { ...playerSharePage(body, id), source: 'seo' }
}

function playerSharePage(body: Json, id: string, mediaType?: QishuiMediaType): SharePage {
  const info = [object(body.seo_track).track, body.track, body.track_info].map(object).find(info => itemId(info.id)) ?? {}
  if (!itemId(info.id)) throw new Error('汽水音乐音频接口未返回歌曲信息')
  if (itemId(info.id) !== id) throw new ShareTrackMismatch('汽水音乐音频接口歌曲编号不一致')
  if (mediaType && (info.media_type ? info.media_type !== mediaType : mediaType === 'ugc_clip')) throw new ShareTrackMismatch('汽水音乐音频接口媒体类型不一致')
  const player = object(body.track_player)
  const labels = object(info.label_info)
  const onlyVip = trueFlag(labels.only_vip_playable)
  const preview = object(info.preview)
  const audition = object(info.audition_info)
  const start = onlyVip ? Math.max(0, Number(preview.start ?? audition.start_time_ms) || 0) / 1000 : 0
  const digital = object(info.digital_track_info)
  const option: Json = {
    status_code: 0,
    track_id: id,
    trackInfo: info,
    hasCopyright: Object.keys(player).length > 0 && Number(info.share_status ?? 0) === 0,
    encrypt: protectedAudio(player),
    duration: Number(info.duration) / 1000,
    previewStart: start,
    is_preview: onlyVip || Number(player.video_model_type) === 2,
    group_playable_level: onlyVip ? 'pay' : 'free',
    is_digital_track: Object.keys(digital).length > 0 && Number(digital.sale_period) !== 3,
  }
  const page: SharePage = { option, baseOption: option, info, playerInfoUrl: typeof player.url_player_info === 'string' ? player.url_player_info : undefined }
  page.streams = streamOptions(page, audioStreams(player))
  // Metadata and lyrics remain readable even when only a protected stream or
  // a player-info URL is present. Playback validates every candidate separately.
  page.option = page.streams[0] ?? { ...option, streamDuration: 0 }
  return page
}

function streamOptions(page: SharePage, streams: AudioStream[]): Json[] {
  const base = page.baseOption ?? page.option
  const duration = Number(page.info.duration) / 1000
  const full = (stream: AudioStream) => stream.duration > 0 && duration > 0 && stream.duration >= duration - 1 && !stream.preview
  return streams.sort((a, b) => Number(full(b)) - Number(full(a)) || Number(a.protected) - Number(b.protected) || streamQuality(b.quality) - streamQuality(a.quality) || b.bitrate - a.bitrate).flatMap((stream, streamGroup) => stream.urls.map(url => ({
    ...base,
    url,
    encrypt: trueFlag(base.encrypt) || stream.protected,
    kid: undefined,
    streamGroup,
    streamDuration: stream.duration,
    previewEnd: (Number(base.previewStart) || 0) + stream.duration,
    is_preview: trueFlag(base.is_preview) || stream.preview,
  })))
}

async function trackPage(context: ProviderContext, id: string, mediaType: QishuiMediaType, signal?: AbortSignal): Promise<SharePage> {
  // Original sounds use ugc_clip even when shared as /share/track. Both types
  // have this public detail endpoint; the SEO route only knows ordinary tracks.
  const url = new URL('https://api.qishui.com/luna/h5/track_v2')
  url.search = new URLSearchParams({ track_id: id, media_type: mediaType, aid: '386088', device_platform: 'web' }).toString()
  const response = await context.session.fetch(url.toString(), { headers: shareHeaders, signal: timeout(signal), credentials: 'omit', cache: 'no-store' })
  if (!response.ok) throw new Error(`汽水音乐歌曲信息请求失败 (${response.status})`)
  const raw = await response.text()
  if (raw.length > 4_000_000) throw new Error('汽水音乐歌曲信息内容异常')
  let body: Json
  try { body = object(JSON.parse(raw)) } catch { throw new Error('汽水音乐歌曲信息格式错误') }
  const code = Number(body.status_code ?? 0)
  if (code !== 0) throw new SharePageApiError(`汽水音乐歌曲信息加载失败 (${code})`, code)
  return { ...playerSharePage(body, id, mediaType), source: mediaType }
}

export async function sharePage(context: ProviderContext, id: string, mediaType?: QishuiMediaType, signal?: AbortSignal): Promise<SharePage> {
  if (!itemId(id)) throw new Error('无效的汽水音乐歌曲编号')
  if (mediaType === 'ugc_clip') return trackPage(context, id, 'ugc_clip', signal)
  let shared: Awaited<ReturnType<typeof readSharePage>> | undefined
  let shareError: unknown
  try {
    shared = await readSharePage(context, id, signal)
    if (!shared.refresh) return shared
  } catch (error) {
    if (error instanceof ShareTrackMismatch) throw error
    shareError = error
  }
  try {
    const refreshed = await refreshedSharePage(context, id, signal)
    // Keep SSR lyrics when a cached but otherwise valid page needs refreshing.
    if (shared?.option.lyrics) refreshed.option.lyrics = shared.option.lyrics
    return refreshed
  } catch (error) {
    if (error instanceof ShareTrackMismatch) throw error
    // Old synced records and /share/track links may not carry media_type. Only
    // an explicit "SEO track unknown" response warrants checking ugc_clip.
    if (shared) return shared
    if (error instanceof SharePageApiError && error.code === 1000091) return trackPage(context, id, 'ugc_clip', signal)
    const detail = shareError instanceof Error && shareError.message.startsWith('汽水音乐') ? shareError.message : '汽水音乐分享页连接失败'
    const refresh = error instanceof Error && error.message.startsWith('汽水音乐') ? error.message : '汽水音乐音频信息连接失败'
    throw new Error(`${detail}；${refresh}，请稍后重试`)
  }
}

export async function shareAudio(context: ProviderContext, id: string, mediaType?: QishuiMediaType): Promise<ShareAudio> {
  const page = await sharePage(context, id, mediaType)
  let failure: unknown
  for (const option of page.streams?.length ? page.streams : [page.option]) {
    try { return checkedAudio(option, page.info) } catch (error) { failure ??= error }
  }
  throw failure
}

function checkedAudio(option: Json, info: Json): ShareAudio {
  if (!trueFlag(option.hasCopyright)) throw new Error('汽水音乐没有此歌曲的播放版权')
  if (trueFlag(option.encrypt) || text(option.kid)) throw new Error('汽水音乐此歌曲使用受保护音频，请在官方客户端播放')
  const duration = Number(info.duration) || Number(option.duration) * 1000
  const start = Number(option.previewStart) || 0
  const end = Number(option.previewEnd) || 0
  const audition = object(info.audition_info)
  const range = object(info.playable_range)
  const preview = object(info.preview)
  const isPreview = [option.is_preview, option.preview, info.is_preview, info.preview, audition.is_trial, audition.is_preview, audition.is_audition, range.is_preview, preview.is_preview, object(info.label_info).only_vip_playable].some(trueFlag)
  if ('streamDuration' in option && (!(option.streamDuration > 0) || !(duration > 0))) throw new Error('汽水音乐未返回可验证的完整音频时长')
  // The official share player uses option.previewStart/End; the track's
  // playable_range and preview clip metadata do not define its playback range.
  const partial = start > 0 || (end > 0 && (!duration || end < duration / 1000 - 1))
  const level = text(option.group_playable_level).toLowerCase()
  if (trueFlag(option.is_digital_track)) throw new Error('汽水音乐此歌曲需要数字专辑授权，请在官方客户端确认播放权限')
  if (isPreview || partial || /^(?:preview|trial|audition|vip|purchase|pay|none|forbidden)$/.test(level)) throw new Error('汽水音乐网页仅可试听此歌曲，App 播放权限不等同于网页权限')
  const url = httpsUrl(option.url)
  if (!url || !/(?:^|\.)(?:douyinvod\.com|bytecdn\.cn|bytecdn\.com|snssdk\.com)$/.test(new URL(url).hostname)) throw new Error('汽水音乐未返回可用的完整播放地址')
  const expiryPart = new URL(url).pathname.split('/').filter(Boolean)[1]
  const signedExpiry = /^[a-f0-9]{8}$/i.test(expiryPart ?? '') ? parseInt(expiryPart, 16) * 1000 : Infinity
  if (signedExpiry <= Date.now()) throw new Error('汽水音乐播放地址已过期，请重新播放')
  const expires = Math.min(signedExpiry, Date.now() + 3 * 60_000)
  return { option, info, url, expires }
}

async function playerInfoPage(context: ProviderContext, page: SharePage, signal: AbortSignal): Promise<SharePage> {
  const value = httpsUrl(page.playerInfoUrl)
  if (!value) throw new Error('汽水音乐未返回播放器补充地址')
  const url = new URL(value)
  if (url.hostname !== 'vod-luna.douyin.com' || url.port || url.pathname !== '/' || url.searchParams.get('Action') !== 'GetPlayInfo') throw new Error('汽水音乐播放器补充地址无效')
  const response = await context.session.fetch(value, { headers: shareHeaders, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: timeout(signal, 8000) })
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`汽水音乐播放器信息请求失败 (${response.status})`)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > 4_000_000) throw new Error('汽水音乐播放器信息内容异常')
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  let body: Json
  try { body = object(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { throw new Error('汽水音乐播放器信息格式错误') }
  const result = object(body.Result)
  const data = object(result.Data)
  if (text(result.EncryptKey) || text(result.CipherText)) throw new Error('汽水音乐此歌曲使用受保护音频，请在官方客户端播放')
  if (!Array.isArray(data.PlayInfoList) || !data.PlayInfoList.length) throw new Error('汽水音乐播放器未返回音频候选')
  // Data.Status=10 is normal in GetPlayInfo, not a failed business response.
  const streams = streamOptions(page, audioStreams({ ...result, Data: { ...data, PlayInfoList: data.PlayInfoList } }))
  return { ...page, streams }
}

// Resolve fresh, complete, clear streams before handing a URL to the player.
// A failed SSR/CDN URL must not hide the player's other official candidates.
export async function resolveAudio(context: ProviderContext, id: string, mediaType?: QishuiMediaType, verify = true): Promise<ShareAudio> {
  if (!itemId(id)) throw new Error('无效的汽水音乐歌曲编号')
  const signal = AbortSignal.timeout(30_000)
  const seen = new Set<string>()
  const playerInfos = new Set<string>()
  let probes = 0
  let audioFailure: Error | undefined
  let permissionFailure: Error | undefined
  let metadataFailure: Error | undefined
  const remember = (error: unknown) => {
    if (error instanceof ShareTrackMismatch) throw error
    // Transport exceptions may include signed URLs. Keep only our own messages.
    metadataFailure = error instanceof Error && error.message.startsWith('汽水音乐') ? error : new Error('汽水音乐音频信息连接失败，请稍后重试')
  }
  const attempt = async(page: SharePage): Promise<ShareAudio | undefined> => {
    const candidates: ShareAudio[] = []
    for (const option of page.streams?.length ? page.streams : [page.option]) {
      try {
        const audio = checkedAudio(option, page.info)
        if (!verify) return audio
        if (!seen.has(audio.url) && !candidates.some(candidate => candidate.url === audio.url)) candidates.push(audio)
      } catch (error) { permissionFailure ??= error instanceof Error ? error : new Error('汽水音乐音频候选无效') }
    }
    // Probe a primary and backup concurrently, canceling the loser. Limit both
    // the total number of connections and the time spent on one track.
    const limit = Math.min(4, 12 - probes)
    let attempted = 0
    for (let offset = 0; offset < candidates.length && attempted < limit && !signal.aborted;) {
      // Race only URLs for the same stream. A fast low-quality response must
      // not replace a reachable preferred stream before it has been checked.
      const batch = candidates.slice(offset).filter(audio => audio.option.streamGroup === candidates[offset].option.streamGroup).slice(0, Math.min(2, limit - attempted))
      offset += batch.length
      attempted += batch.length
      probes += batch.length
      for (const audio of batch) seen.add(audio.url)
      const cancel = new AbortController()
      try {
        return await Promise.any(batch.map(async audio => {
          await probeAudio(context, audio.url, AbortSignal.any([signal, cancel.signal]))
          return audio
        }))
      } catch (error) {
        if (error instanceof AggregateError && error.errors[0] instanceof Error) audioFailure = error.errors[0]
      } finally { cancel.abort() }
    }
  }
  const attemptPage = async(page: SharePage): Promise<ShareAudio | undefined> => {
    const audio = await attempt(page)
    if (audio) return audio
    if (page.playerInfoUrl && !playerInfos.has(page.playerInfoUrl) && !signal.aborted && probes < 12) {
      playerInfos.add(page.playerInfoUrl)
      try { return await attempt(await playerInfoPage(context, page, signal)) } catch (error) { remember(error) }
    }
  }
  let first: SharePage | undefined
  try { first = await sharePage(context, id, mediaType, signal) } catch (error) { remember(error) }
  if (first) {
    const audio = await attemptPage(first)
    if (audio) return audio
  }
  const type = mediaType ?? (first?.info.media_type === 'ugc_clip' ? 'ugc_clip' : 'track')
  if (type !== 'ugc_clip' && first?.source !== 'seo' && !signal.aborted && probes < 12) {
    try {
      const audio = await attemptPage(await refreshedSharePage(context, id, signal))
      if (audio) return audio
    } catch (error) { remember(error) }
  }
  if (first?.source !== type && !signal.aborted && probes < 12) {
    try {
      const audio = await attemptPage(await trackPage(context, id, type, signal))
      if (audio) return audio
    } catch (error) { remember(error) }
  }
  throw audioFailure ?? permissionFailure ?? metadataFailure ?? new Error('汽水音乐暂未取得可播放的完整音频，请稍后重试')
}

// A valid share URL can still fail at the CDN. Check only its first KiB so
// the existing resolver can try another platform before committing playback.
export async function probeAudio(context: ProviderContext, url: string, signal?: AbortSignal): Promise<void> {
  let response: Response
  try {
    // The renderer's audio element uses win-main's proxy settings. Probing in
    // the account session could reject a stream the player can actually reach.
    response = await (context.playbackSession ?? context.session).fetch(url, { headers: { Range: 'bytes=0-1023' }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: timeout(signal, 6000) })
  } catch (error) {
    const code = /\bERR_[A-Z_]+\b/.exec(error instanceof Error ? error.message : '')?.[0]
    throw new Error(`汽水音乐音频暂时无法连接${code ? ` (${code})` : ''}，请检查网络或代理设置`)
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`汽水音乐音频不可用 (${response.status})`)
  }
  const reader = response.body.getReader()
  const head = Buffer.alloc(1024)
  let length = 0
  try {
    while (length < head.length) {
      const part = await reader.read()
      if (part.done) break
      const bytes = part.value.subarray(0, head.length - length)
      head.set(bytes, length)
      length += bytes.length
    }
  } catch { throw new Error('汽水音乐音频读取失败，正在尝试其他平台') } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const data = head.subarray(0, length)
  const marker = (offset: number, value: string) => data.length >= offset + value.length && data.subarray(offset, offset + value.length).toString('ascii') === value
  const mp4 = data.length >= 12 && marker(4, 'ftyp')
  const mp3 = marker(0, 'ID3') || (data.length >= 4 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0 && (data[1] & 0x06) !== 0 && (data[2] & 0xf0) !== 0xf0)
  const adts = data.length >= 7 && data[0] === 0xff && (data[1] & 0xf6) === 0xf0
  const wav = marker(0, 'RIFF') && marker(8, 'WAVE')
  if (!mp4 && !mp3 && !adts && !wav && !marker(0, 'fLaC') && !marker(0, 'OggS')) throw new Error('汽水音乐返回的内容不是可识别音频，正在尝试其他平台')
}

export function toLyrics(option: Json): { lyric: string, tlyric: string, rlyric: string, lxlyric: string | null } {
  const sentences = object(option.lyrics).sentences
  const lyric = Array.isArray(sentences) ? sentences.map(object).filter(item => Number.isFinite(item.startMs) && item.startMs >= 0 && item.startMs < Number.MAX_SAFE_INTEGER && text(item.text)).map(item => {
    const centiseconds = Math.floor(Number(item.startMs) / 10)
    return `[${String(Math.floor(centiseconds / 6000)).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}]${text(item.text)}`
  }).join('\n') : ''
  return { lyric, tlyric: '', rlyric: '', lxlyric: null }
}
