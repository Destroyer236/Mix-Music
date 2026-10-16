import { createHash } from 'node:crypto'
import type { ProviderContext } from './types'
import { songVip } from '@common/musicAccess'

export type Json = Record<string, any>
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

export async function sharePage(context: ProviderContext, id: string): Promise<{ option: Json, info: Json }> {
  if (!itemId(id)) throw new Error('无效的汽水音乐歌曲编号')
  const response = await context.session.fetch(`https://www.qishui.com/share/track?track_id=${id}&auto_play_bgm=1`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(20_000), credentials: 'include' })
  if (!response.ok) throw new Error(`汽水音乐分享页请求失败 (${response.status})`)
  const raw = await response.text()
  if (raw.length > 4_000_000) throw new Error('汽水音乐分享页内容异常')
  const page = object(object(extractRouterData(raw).loaderData).track_page)
  const option = object(page.audioWithLyricsOption)
  const info = object(option.trackInfo)
  if (!Object.keys(option).length || Number(page.status_code ?? 0) !== 0 || Number(option.status_code ?? 0) !== 0) throw new Error('汽水音乐歌曲不可用或已下架')
  if (itemId(info.id ?? option.track_id) !== id) throw new Error('汽水音乐分享页歌曲编号不一致')
  return { option, info }
}

export async function shareAudio(context: ProviderContext, id: string): Promise<ShareAudio> {
  const { option, info } = await sharePage(context, id)
  if (!trueFlag(option.hasCopyright)) throw new Error('汽水音乐没有此歌曲的播放版权')
  if (trueFlag(option.encrypt) || text(option.kid)) throw new Error('汽水音乐此歌曲使用受保护音频，请在官方客户端播放')
  const duration = Number(info.duration) || Number(option.duration) * 1000
  const start = Number(option.previewStart) || 0
  const end = Number(option.previewEnd) || 0
  const audition = object(info.audition_info)
  const range = object(info.playable_range)
  const preview = object(info.preview)
  const isPreview = [option.is_preview, option.preview, info.is_preview, info.preview, audition.is_trial, audition.is_preview, audition.is_audition, range.is_preview, preview.is_preview, object(info.label_info).only_vip_playable].some(trueFlag)
  // The official share player uses option.previewStart/End; the track's
  // playable_range and preview clip metadata do not define its playback range.
  const partial = start > 0 || (end > 0 && (!duration || end < duration / 1000 - 1))
  const level = text(option.group_playable_level).toLowerCase()
  if (trueFlag(option.is_digital_track)) throw new Error('汽水音乐此歌曲需要数字专辑授权，请在官方客户端确认播放权限')
  if (isPreview || partial || /^(?:preview|trial|audition|vip|purchase|pay|none|forbidden)$/.test(level)) throw new Error('汽水音乐当前账号仅可试听此歌曲，请在平台确认完整播放权限')
  const url = httpsUrl(option.url)
  if (!url || !/(?:^|\.)(?:douyinvod\.com|bytecdn\.cn|bytecdn\.com|snssdk\.com)$/.test(new URL(url).hostname)) throw new Error('汽水音乐未返回可用的完整播放地址')
  const expiryPart = new URL(url).pathname.split('/').filter(Boolean)[1]
  const signedExpiry = /^[a-f0-9]{8}$/i.test(expiryPart ?? '') ? parseInt(expiryPart, 16) * 1000 : Infinity
  if (signedExpiry <= Date.now()) throw new Error('汽水音乐播放地址已过期，请重新播放')
  const expires = Math.min(signedExpiry, Date.now() + 3 * 60_000)
  return { option, info, url, expires }
}

// A valid share URL can still fail at the CDN. Check only its first KiB so
// the existing resolver can try another platform before committing playback.
export async function probeAudio(context: ProviderContext, url: string): Promise<void> {
  let response: Response
  try {
    response = await context.session.fetch(url, { headers: { Range: 'bytes=0-1023' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(6000) })
  } catch { throw new Error('汽水音乐音频暂时无法连接，正在尝试其他平台') }
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
