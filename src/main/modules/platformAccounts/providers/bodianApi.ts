import { net } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { ProviderContext } from './types'

// Wavepoint desktop protocol, verified against bd-api.kuwo.cn. Protocol references:
// https://github.com/Mintcolour/bodian-music-api/blob/main/docs/protocol.md
export type Json = Record<string, any>
export const object = (value: unknown): Json => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
export const text = (value: unknown): string => String(value ?? '').replace(/<[^>]*>/g, '').trim()
export const itemId = (value: unknown): string => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  const result = String(value ?? '')
  return /^[1-9]\d{0,15}$/.test(result) && Number.isSafeInteger(Number(result)) ? result : ''
}
const decoded = (value: string | undefined) => { try { return decodeURIComponent(value ?? '') } catch { return '' } }
export const getIdentity = async(context: ProviderContext) => {
  const cookies = await context.cookies()
  const id = itemId(cookies.linkline_bodian_uid)
  const token = cookies.linkline_bodian_token ?? ''
  if (!id || !token || token.length > 8192 || /[\r\n]/.test(token)) throw new Error('波点音乐登录状态已失效，请重新扫码登录')
  return { id, token, nickname: decoded(cookies.linkline_bodian_nickname) || '波点音乐用户', avatar: mediaUrl(decoded(cookies.linkline_bodian_avatar)) }
}
export const mediaUrl = (value: unknown): string => {
  try {
    const url = new URL(String(value ?? ''))
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : ''
  } catch { return '' }
}
const md5 = (value: string) => createHash('md5').update(value).digest('hex')
export const signRequest = (pathname: string, query: URLSearchParams, body: string) => md5(`kuwotest${[...query.toString()].filter(char => /[a-z0-9]/i.test(char)).sort().join('')}${body ? md5(`${body}kuwotest`) : ''}${pathname}`)
const devices = new WeakMap<Electron.Session, Promise<string>>()
export const getDevice = async(context: ProviderContext): Promise<string> => {
  let pending = devices.get(context.session)
  if (!pending) {
    pending = (async() => {
      const saved = (await context.cookies()).linkline_bodian_device
      if (/^[a-f0-9]{32}$/.test(saved ?? '')) return saved
      const value = randomBytes(16).toString('hex')
      await context.session.cookies.set({ url: 'https://bd-api.kuwo.cn/', name: 'linkline_bodian_device', value, secure: true, httpOnly: true, sameSite: 'strict', expirationDate: Date.now() / 1000 + 3650 * 86400 })
      return value
    })().catch(error => { devices.delete(context.session); throw error })
    devices.set(context.session, pending)
  }
  return pending
}
export interface RequestOptions {
  query?: Record<string, unknown>
  body?: Json
  signed?: boolean
  anonymous?: boolean
  signal?: AbortSignal
  lyric?: boolean
  expectedUser?: string
}
const failure = (code: number, message: string) => Object.assign(new Error(message), { code })
export async function request(context: ProviderContext, path: string, options: RequestOptions = {}): Promise<Json> {
  if (!/^\/(?:api\/|mobi\.s$)/.test(path) || path.includes('..') || path.includes('?') || path.includes('#')) throw new Error('无效的波点音乐请求')
  const device = await getDevice(context)
  const cookies = options.anonymous ? {} : await context.cookies()
  const uid = itemId(cookies.linkline_bodian_uid) || '-1'
  const token = cookies.linkline_bodian_token ?? ''
  if (token.length > 8192 || /[\r\n]/.test(token)) throw new Error('波点音乐登录状态已失效，请重新扫码登录')
  if (options.expectedUser && uid !== options.expectedUser) throw new Error('波点音乐账号已变化，请重新同步后操作')
  const url = new URL(path, options.lyric ? 'https://mlyric.kuwo.cn' : 'https://bd-api.kuwo.cn')
  for (const [key, value] of Object.entries({ ...options.query, uid, token })) if (value != null) url.searchParams.set(key, String(value))
  const body = options.body == null ? '' : JSON.stringify(options.body)
  if (options.signed) {
    url.searchParams.set('timestamp', String(Date.now()))
    url.searchParams.set('sign', signRequest(path, url.searchParams, body))
  }
  const method = path === '/api/ucenter/users/login' || /^\/api\/service\/playlist\/music(?:\/delete)?$/.test(path) ? 'POST' : 'GET'
  // Playback uses a signed GET with a JSON body; fetch discards/rejects that body.
  const response = await new Promise<Json>((resolve, reject) => {
    const signal = options.signal
    if (signal?.aborted) { reject(new Error('波点音乐请求已取消')); return }
    let finished = false
    const req = net.request({ url: url.toString(), method, session: context.session, useSessionCookies: false, redirect: 'error' })
    const end = (error?: Error, value?: Json) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      if (error) reject(error)
      else resolve(value ?? {})
    }
    const cancel = () => { end(new Error('波点音乐请求已取消')); req.abort() }
    const timer = setTimeout(() => { end(new Error('波点音乐请求超时，请检查网络后重试')); req.abort() }, 15_000)
    signal?.addEventListener('abort', cancel, { once: true })
    req.on('error', () => { end(new Error('连接波点音乐失败，请检查网络后重试')) })
    req.on('response', res => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 8 * 1024 * 1024) { end(new Error('波点音乐响应过大')); req.abort(); return }
        chunks.push(Buffer.from(chunk))
      })
      res.on('error', () => { end(new Error('波点音乐响应被中断，请重试')) })
      res.on('end', () => {
        if (finished) return
        if (res.statusCode !== 200) { end(failure(res.statusCode, `波点音乐请求失败 (${res.statusCode})`)); return }
        try {
          const bytes = Buffer.concat(chunks)
          const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 }) : bytes
          end(undefined, object(JSON.parse(decoded.toString('utf8'))))
        } catch { end(new Error('波点音乐返回内容异常，请稍后重试')) }
      })
    })
    const headers = { 'User-Agent': 'Dart/3.3 (dart:io)', plat: 'win', channel: 'W1', ver: '1.1.7', svrver: '13', 'api-ver': 'application/json', brand: 'Windows', net: 'wifi', devid: device, qimei36: device, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip', ...(uid !== '-1' && token ? { uid, token } : {}) }
    for (const [key, value] of Object.entries(headers)) req.setHeader(key, value)
    req.end(body || undefined)
  })
  const code = Number(response.code)
  if (code !== 200) {
    if (code === -101 || code === 11012 || code === 401) throw failure(code, '波点音乐登录状态已失效，请重新扫码登录')
    if (code === 407) throw failure(code, '由于版权保护，该波点音乐资源仅限中国大陆地区使用')
    if (code === 20018) throw failure(code, '波点音乐当前账号暂无此歌曲的播放权限')
    throw failure(code, `波点音乐请求未成功 (${Number.isFinite(code) ? code : '未知错误'})`)
  }
  return object(response.data)
}

export function toTrack(value: unknown): LX.Music.MusicInfo_online_common | null {
  const raw = object(value)
  const id = itemId(raw.id ?? raw.musicId)
  const name = text(raw.name ?? raw.songName)
  if (!id || !name) return null
  const formats: Json[] = Array.isArray(raw.audios) ? raw.audios.map(object) : []
  const qualitys: LX.Music.MusicQualityType[] = []
  for (const type of ['128k', '320k', 'flac'] as const) {
    const audio = formats.find(item => type === 'flac' ? item.format === 'flac' : item.format === 'mp3' && Number(item.bitrate) === Number(type.replace('k', '')))
    if (audio != null || (!formats.length && type === '128k')) qualitys.push({ type, size: text(audio?.size) || null })
  }
  const seconds = Math.max(0, Math.floor(Number(raw.duration) || 0))
  const pay = object(raw.payInfo)
  const play = String(pay.play ?? '')
  const isVip = /^[01]+$/.test(play) ? play[0] === '1' && object(pay.feeType).vip !== '0' : undefined
  return { id: `bo_${id}`, source: 'bo', name, singer: text(raw.artist) || (Array.isArray(raw.artists) ? raw.artists.map((item: unknown) => text(object(item).name)).filter(Boolean).join('、') : '') || '未知歌手', interval: seconds ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : null, meta: { songId: id, albumId: itemId(raw.albumId), albumName: text(raw.album), picUrl: mediaUrl(raw.albumPic ?? raw.albumPic120 ?? raw.pic), subtitle: text(raw.subtitle), isVip, qualitys, _qualitys: Object.fromEntries(qualitys.map(item => [item.type, { size: item.size }])) } }
}
