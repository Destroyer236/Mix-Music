// 酷狗概念版（KugouYoung / lite）Android 协议层。
// 协议参数与签名算法对齐 EchoMusic 的 server/util，全部用 Node 内置模块实现，
// 不引入 crypto-js/node-forge 这类间接依赖。
import { createCipheriv, createDecipheriv, createHash, createPublicKey, publicEncrypt, randomBytes, constants } from 'node:crypto'
import type { ProviderContext } from './types'

const GATEWAY = 'https://gateway.kugou.com'
const LOGIN_HOST = 'https://login-user.kugou.com'
/**
 * 概念版客户端标识（设备注册用）。
 * 注意：扫码拿到的 token 属于**标准版** appid 体系——所有业务接口（资料/歌单/加歌）
 * 必须改用 STANDARD_APPID + STANDARD_CLIENTVER 和标准版签名盐，否则一律 20006。
 */
export const LITE_APPID = 3116
export const LITE_CLIENTVER = 11440
const STANDARD_APPID = 1005
const STANDARD_CLIENTVER = 20489
/** Android 端签名盐值：概念版（设备注册）。 */
const ANDROID_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'
/** Android 端签名盐值：标准版（业务接口）。 */
const ANDROID_SALT_STANDARD = 'OIlwieks28dk2k092lksi2UIkp'
/** Web 端签名盐值（扫码登录系列接口）。 */
const WEB_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
const SRC_APPID = 2919
const UA_ANDROID = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi'
const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
/** 标准版 RSA 公钥（业务接口的裸 RSA 加密用）。 */
const STANDARD_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB
-----END PUBLIC KEY-----`
/** 概念版 RSA 公钥（设备注册的 p 参数）。 */
const LITE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB
-----END PUBLIC KEY-----`

const md5 = (value: string | Buffer): string => createHash('md5').update(value).digest('hex')
const encode = (value: unknown): string => typeof value === 'object' ? JSON.stringify(value) : String(value)

/** Android 端签名：参数按 key 排序拼接（key=value），盐值包裹，含请求体。 */
export function signatureAndroid(params: Record<string, unknown>, data = '', salt = ANDROID_SALT_STANDARD): string {
  const paramsString = Object.keys(params).sort().map(key => `${key}=${encode(params[key])}`).join('')
  return md5(`${salt}${paramsString}${data}${salt}`)
}

/** Web 端签名：按 key=value 逐条排序后拼接（与 Android 排序对象不同），盐值包裹。 */
export function signatureWeb(params: Record<string, unknown>, data = ''): string {
  const paramsString = Object.keys(params).map(key => `${key}=${encode(params[key])}`).sort().join('')
  return md5(`${WEB_SALT}${paramsString}${data}${WEB_SALT}`)
}

/** 概念版 signKey（部分接口的 key 参数）。 */
export function signKey(hash: string, mid: string, userid: string | number, appid: number | string = LITE_APPID): string {
  return md5(`${hash}185672dd44712f60bb1736df5a377e82${appid}${mid}${userid || 0}`)
}

/** 裸 RSA（无 padding，仅 modPow）：酷狗资料接口的 p 参数用的是这种。 */
function rsaRawEncrypt(data: Buffer, pem: string): string {
  // 用 Node 的 publicEncrypt 无法关闭 padding，这里直接做模幂运算。
  const key = createPublicKey(pem)
  const details = key.export({ format: 'jwk' }) as { n?: string, e?: string }
  if (!details.n || !details.e) throw new Error('酷狗公钥解析失败')
  const n = BigInt(`0x${Buffer.from(details.n, 'base64url').toString('hex')}`)
  const e = BigInt(`0x${Buffer.from(details.e, 'base64url').toString('hex')}`)
  const keyLength = Math.ceil(n.toString(16).length / 2)
  // 左侧补零到密钥长度，与服务端期望的定长块一致。
  const message = BigInt(`0x${data.toString('hex') || '0'}`)
  const encrypted = modPow(message, e, n)
  return encrypted.toString(16).padStart(keyLength * 2, '0')
}

const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
  let result = 1n
  let value = base % modulus
  let exp = exponent
  while (exp > 0n) {
    if (exp & 1n) result = result * value % modulus
    value = value * value % modulus
    exp >>= 1n
  }
  return result
}
/** AES-128-CBC + PKCS7，返回 base64（用于请求体封装）。 */
function aesEncrypt(data: string, key: string, iv: string): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  return Buffer.concat([cipher.update(Buffer.from(data, 'utf8')), cipher.final()]).toString('base64')
}

function aesDecrypt(data: Buffer, key: string, iv: string): string {
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** GUID 经 MD5 转十进制大整数，得到设备 MID（服务端会校验格式）。 */
export function calculateMid(guid: string): string {
  return BigInt(`0x${md5(guid)}`).toString(10)
}

const newGuid = (): string => randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
const randomString = (length: number): string => randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)

export interface KugouCredentials { guid: string, mid: string, dfid: string, dev: string, userid: string, token: string, nickname: string, avatar: string }
const COOKIE_PREFIX = 'linkline_kugou_'

const decodeCookie = (value: string): string => {
  try { return decodeURIComponent(value) } catch { return value }
}

/** 设备与登录凭据持久化在账号分区 cookie 里，重启后无需重新扫码。 */
export async function loadCredentials(context: ProviderContext): Promise<KugouCredentials | null> {
  const cookies = await context.cookies()
  // persist() 统一做了 encodeURIComponent，这里必须对称解码。
  const read = (name: string) => decodeCookie(cookies[`${COOKIE_PREFIX}${name}`] ?? '')
  const guid = read('guid')
  if (!guid) return null
  return {
    guid,
    mid: read('mid') || calculateMid(guid),
    dfid: read('dfid'),
    dev: read('dev'),
    userid: read('userid'),
    token: read('token'),
    nickname: read('nickname'),
    avatar: read('avatar'),
  }
}

async function persist(context: ProviderContext, values: Record<string, string>): Promise<void> {
  for (const [name, value] of Object.entries(values)) {
    await context.session.cookies.set({
      url: 'https://www.kugou.com/',
      domain: '.kugou.com',
      path: '/',
      name: `${COOKIE_PREFIX}${name}`,
      value: encodeURIComponent(value),
      secure: true,
      sameSite: 'no_restriction',
      expirationDate: Date.now() / 1000 + 3650 * 86400,
    })
  }
}

/** 首次使用时生成设备指纹并注册 dfid。 */
export async function ensureDevice(context: ProviderContext): Promise<KugouCredentials> {
  const saved = await loadCredentials(context)
  if (saved?.dfid && saved.dev) return saved
  const guid = saved?.guid ?? newGuid()
  const mid = saved?.mid ?? calculateMid(guid)
  const dev = saved?.dev ? saved.dev : randomString(10).toUpperCase()
  const dfid = saved?.dfid ? saved.dfid : await registerDevice(context, guid, mid, dev)
  await persist(context, { guid, mid, dfid, dev })
  return { guid, mid, dfid, dev, userid: saved?.userid ?? '', token: saved?.token ?? '', nickname: saved?.nickname ?? '', avatar: saved?.avatar ?? '' }
}

/** 概念版设备注册：换取 dfid（设备指纹），是后续所有请求的前提。 */
async function registerDevice(context: ProviderContext, guid: string, mid: string, dev: string): Promise<string> {
  const device = {
    availableRamSize: 4983533568,
    availableRomSize: 48114719,
    availableSDSize: 48114717,
    basebandVer: '',
    batteryLevel: 100,
    batteryStatus: 3,
    brand: 'Redmi',
    buildSerial: 'unknown',
    device: 'marble',
    imei: guid,
    imsi: '',
    manufacturer: 'Xiaomi',
    uuid: guid,
    accelerometer: false,
    accelerometerValue: '',
    gravity: false,
    gravityValue: '',
    gyroscope: false,
    gyroscopeValue: '',
    light: false,
    lightValue: '',
    magnetic: false,
    magneticValue: '',
    orientation: 0,
    orientationValue: '',
    pressure: false,
    pressureValue: '',
    step_counter: false,
    step_counterValue: '',
    temperature: false,
    temperatureValue: '',
    totalRamSize: 8011747328,
    totalRomSize: 249746178048,
    totalSDSize: 249746178048,
    uuid2: guid,
    nettype: 1,
    mac: '02:00:00:00:00:00',
  }
  // 请求体用随机 key 做 AES 加密放进 data，key 再用 RSA 公钥包一层作为 p 参数。
  const aesKey = randomString(6).toLowerCase()
  const encryptKey = md5(aesKey).substring(0, 16)
  const iv = md5(aesKey).substring(16, 32)
  const body = aesEncrypt(JSON.stringify(device), encryptKey, iv)
  const p = publicEncrypt(
    { key: LITE_PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(JSON.stringify({ aes: aesKey, uid: 0, token: '' }), 'utf8'),
  ).toString('hex')
  const clienttime = Math.floor(Date.now() / 1000)
  const params: Record<string, unknown> = {
    dfid: '-',
    mid,
    uuid: '-',
    appid: LITE_APPID,
    clientver: LITE_CLIENTVER,
    clienttime,
    part: 1,
    platid: 1,
    p,
    dev,
  }
  // 设备注册属于概念版客户端流程，用概念版盐值。
  params.signature = signatureAndroid(params, body, ANDROID_SALT)
  const url = new URL('https://userservice.kugou.com/risk/v2/r_register_dev')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const response = await context.session.fetch(url.toString(), {
    method: 'POST',
    headers: new Headers({ 'User-Agent': UA_ANDROID, 'Content-Type': 'application/x-www-form-urlencoded', dfid: '-', mid, clienttime: String(clienttime) }),
    body,
    signal: AbortSignal.timeout(20000),
  })
  // 该接口返回 AES 加密的二进制体，dfid 在响应体的 data.dfid 里。
  // 少数情况下服务端也会 Set-Cookie 下发 kg_dfid，两者都接受。
  let result: any = {}
  try { result = JSON.parse(aesDecrypt(Buffer.from(await response.arrayBuffer()), encryptKey, iv)) } catch { result = {} }
  const cookies = await context.cookies()
  const fromBody = String(result?.data?.dfid ?? '')
  const fromCookie = String(cookies.kg_dfid ?? cookies.dfid ?? '')
  const dfid = fromBody || fromCookie
  if (!dfid) {
    const code = Number(result?.error_code ?? -1)
    throw new Error(`酷狗设备注册失败 (${Number.isFinite(code) ? code : '未知'})`)
  }
  return dfid
}

export interface KugouQrCode { key: string, image: string }
/** 申请扫码二维码：服务端直接返回 base64 图片。 */
export async function createQrCode(context: ProviderContext): Promise<KugouQrCode> {
  const creds = await ensureDevice(context)
  const params: Record<string, unknown> = {
    dfid: creds.dfid,
    mid: creds.mid,
    uuid: '-',
    clientver: STANDARD_CLIENTVER,
    appid: 1001,
    type: 1,
    plat: 4,
    qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${STANDARD_APPID}&`,
    srcappid: SRC_APPID,
    clienttime: Math.floor(Date.now() / 1000),
  }
  params.signature = signatureWeb(params)
  const url = new URL('/v2/qrcode', LOGIN_HOST)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const response = await context.session.fetch(url.toString(), {
    headers: new Headers({ 'User-Agent': UA_WEB, Cookie: `kg_mid=${creds.mid}; kg_dfid=${creds.dfid}` }),
    signal: AbortSignal.timeout(15000),
  })
  const result = await response.json().catch(() => ({}))
  const key = String(result?.data?.qrcode ?? '')
  const image = String(result?.data?.qrcode_img ?? '')
  if (!key) throw new Error(`酷狗二维码申请失败 (${Number(result?.error_code ?? -1)})`)
  return { key, image }
}

export interface KugouQrState { status: number, token?: string, userid?: string, nickname?: string, avatar?: string }
/** 轮询扫码状态：0 过期 / 1 等待扫码 / 2 待确认 / 4 授权成功。 */
export async function checkQrLogin(context: ProviderContext, key: string): Promise<KugouQrState> {
  const creds = await ensureDevice(context)
  const params: Record<string, unknown> = {
    dfid: creds.dfid,
    mid: creds.mid,
    uuid: '-',
    clientver: STANDARD_CLIENTVER,
    plat: 4,
    appid: STANDARD_APPID,
    srcappid: SRC_APPID,
    qrcode: key,
    dev: creds.dev,
    clienttime: Math.floor(Date.now() / 1000),
  }
  params.signature = signatureWeb(params)
  const url = new URL('/v2/get_userinfo_qrcode', LOGIN_HOST)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const response = await context.session.fetch(url.toString(), {
    headers: new Headers({ 'User-Agent': UA_WEB, Cookie: `kg_mid=${creds.mid}; kg_dfid=${creds.dfid}` }),
    signal: AbortSignal.timeout(15000),
  })
  const result = await response.json().catch(() => ({}))
  const data = result?.data ?? {}
  return {
    status: Number(data.status) || 0,
    ...(data.token ? { token: String(data.token) } : {}),
    ...(data.userid ? { userid: String(data.userid) } : {}),
    ...(data.nickname ? { nickname: String(data.nickname) } : {}),
    ...(data.pic ? { avatar: String(data.pic) } : {}),
  }
}

/** 扫码成功后写入登录态并拉取用户资料。 */
export async function commitQrLogin(context: ProviderContext, state: KugouQrState): Promise<KugouCredentials> {
  if (!state.token || !state.userid) throw new Error('酷狗扫码登录未返回凭据')
  const creds = await ensureDevice(context)
  await persist(context, { token: state.token, userid: state.userid })
  // 复查一次，确认凭据真的落到了会话里（persist 失败时这里会暴露）。
  const written = await loadCredentials(context)
  if (written?.token !== state.token) throw new Error('酷狗凭据写入失败，请重新扫码')
  const merged = { ...creds, token: state.token, userid: state.userid }
  try {
    const info = await userDetail(context, merged)
    await persist(context, { nickname: info.nickname, avatar: info.avatar })
    return { ...merged, nickname: info.nickname, avatar: info.avatar }
  } catch (error) {
    // 凭据已落盘但资料拉取失败：把真实原因带出去，否则界面只会显示「未登录」。
    throw new Error(`酷狗登录成功但读取资料失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export interface KugouUserDetail { id: string, nickname: string, avatar: string, vip: { label: string, dueDate: number | null } | null }

/** 概念版会员信息：busi_vip 里按时长取最晚到期的一档。 */
export async function unionVip(context: ProviderContext, creds?: KugouCredentials): Promise<{ label: string, dueDate: number | null } | null> {
  const current = creds ?? await ensureDevice(context)
  if (!current.token || !current.userid) return null
  const clienttime = Math.floor(Date.now() / 1000)
  const params: Record<string, unknown> = {
    dfid: current.dfid,
    mid: current.mid,
    uuid: '-',
    appid: STANDARD_APPID,
    clientver: STANDARD_CLIENTVER,
    clienttime,
    dev: current.dev,
    token: current.token,
    userid: Number(current.userid) || 0,
    busi_type: 'concept',
  }
  params.signature = signatureAndroid(params)
  const url = new URL('/v1/get_union_vip', 'https://kugouvip.kugou.com')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const response = await context.session.fetch(url.toString(), {
    headers: new Headers({ 'User-Agent': UA_ANDROID, dfid: current.dfid, mid: current.mid }),
    signal: AbortSignal.timeout(15000),
  })
  const result = await response.json().catch(() => ({}))
  const entries: any[] = Array.isArray(result?.data?.busi_vip) ? result.data.busi_vip : []
  const active = entries.filter(entry => Number(entry?.is_vip) === 1)
  if (!active.length) return null
  // vip_end_time 形如 "2027-05-13 06:47:19"。
  const parse = (value: unknown): number => {
    const text = String(value ?? '')
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text)
    if (!match) return 0
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])).getTime()
  }
  // 账号可能同时有 svip（正式会员）和 tvip（畅听体验）；按等级优先，同级再取到期最晚的。
  const rank: Record<string, number> = { svip: 3, qvip: 2, dvip: 2, tvip: 1 }
  const best = active
    .map(entry => ({ entry, due: parse(entry.vip_end_time), rank: rank[String(entry.product_type ?? '')] ?? 0 }))
    .sort((a, b) => b.rank - a.rank || b.due - a.due)[0]
  const labels: Record<string, string> = { svip: 'SVIP', qvip: '概念版VIP', dvip: '概念版VIP', tvip: '畅听会员' }
  const label = labels[String(best.entry.product_type ?? '')] ?? '会员'
  return { label, dueDate: best.due > Date.now() ? best.due : null }
}

/** 用户资料与会员状态。 */
export async function userDetail(context: ProviderContext, creds?: KugouCredentials): Promise<KugouUserDetail> {
  const current = creds ?? await ensureDevice(context)
  if (!current.token || !current.userid) throw new Error('请先扫码登录酷狗概念版')
  // 资料接口的 p 参数用**裸 RSA**（无 PKCS1 padding），与设备注册的加密方式不同。
  const clienttime = Math.floor(Date.now() / 1000)
  const p = rsaRawEncrypt(
    Buffer.from(JSON.stringify({ token: current.token, clienttime }), 'utf8'),
    STANDARD_PUBLIC_KEY,
  ).toUpperCase()
  const result = await apiRequest(context, '/v3/get_my_info', {
    router: 'usercenter.kugou.com',
    query: { plat: 1 },
    body: { visit_time: clienttime, usertype: 1, p, userid: Number(current.userid) || 0 },
  })
  const data = result?.data ?? {}
  // 用户中心不返回会员信息（vip_type 恒为 0），会员状态来自 kugouvip 的 union 接口。
  const vip = await unionVip(context, current).catch(() => null)
  return {
    id: String(data.userid ?? current.userid),
    nickname: String(data.nickname ?? data.nick_name ?? current.nickname ?? '酷狗用户'),
    avatar: String(data.pic ?? data.user_pic ?? current.avatar ?? ''),
    vip,
  }
}

export interface KugouResponse { status?: number, error_code?: number, data?: any, [key: string]: unknown }

/** 统一 Android 请求：注入设备参数、签名与 x-router。业务接口一律用标准版标识。 */
async function apiRequest(context: ProviderContext, path: string, options: { query?: Record<string, unknown>, body?: Record<string, unknown>, router?: string, allowCodes?: number[], clientverOverride?: number } = {}): Promise<KugouResponse> {
  const creds = await ensureDevice(context)
  const clienttime = Math.floor(Date.now() / 1000)
  const data = options.body === undefined ? '' : JSON.stringify(options.body)
  const params: Record<string, unknown> = {
    dfid: creds.dfid,
    mid: creds.mid,
    uuid: '-',
    appid: STANDARD_APPID,
    clientver: options.clientverOverride ?? STANDARD_CLIENTVER,
    clienttime,
    dev: creds.dev,
    ...(options.query ?? {}),
  }
  if (creds.token) params.token = creds.token
  if (creds.userid) params.userid = creds.userid
  params.signature = signatureAndroid(params, data)
  const url = new URL(path, GATEWAY)
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, String(value))
  const headers = new Headers({
    'User-Agent': UA_ANDROID,
    dfid: creds.dfid,
    clienttime: String(clienttime),
    mid: creds.mid,
    'Content-Type': 'application/json; charset=utf-8',
  })
  if (options.router) headers.set('x-router', options.router)
  const response = await context.session.fetch(url.toString(), {
    method: 'POST', headers, ...(data ? { body: data } : {}), signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`酷狗概念版请求失败 (${response.status})`)
  const result = await response.json().catch(() => ({})) as KugouResponse
  const status = Number(result.status)
  if (status !== 1 && status !== 0) {
    const code = Number(result.error_code ?? status)
    // 部分接口用错误码表达业务状态（如今日已领取），调用方可显式放行。
    if (options.allowCodes?.includes(code)) return result
    // 带上接口路径与错误码，便于区分「登录失效」和「路径/参数不对」。
    const detail = `${path} -> status=${status} error_code=${code}`
    if ([20010, 20011, 20012, 20018, 20006].includes(code)) throw new Error(`酷狗概念版登录已失效，请重新扫码 (${detail})`)
    throw new Error(`酷狗概念版接口返回错误 (${detail})`)
  }
  return result
}

export interface KugouPlaylist { id: string, name: string, cover: string, count: number, isDefault: boolean, owned: boolean }

/**
 * 账号歌单列表，包含本人创建与收藏的他人歌单。
 *
 * 字段含义（实测 /v7/get_all_list）：
 * - is_def：1 = 默认收藏，2 = 我喜欢；其余歌单没有该字段
 * - type：0 = 本人创建，1 = 收藏的他人歌单
 * - list_create_userid：歌单创建者，收藏歌单是原作者
 *
 * 两种歌单都是用户可见且可写入的，不做过滤；owned 仅用于展示来源。
 */
export async function playlists(context: ProviderContext, _userId: string): Promise<KugouPlaylist[]> {
  const creds = await ensureDevice(context)
  const result = await apiRequest(context, '/v7/get_all_list', {
    router: 'cloudlist.service.kugou.com',
    query: { plat: 1, userid: Number(creds.userid) || 0 },
    body: { userid: Number(creds.userid) || 0, token: creds.token, total_ver: 979, type: 2, page: 1, pagesize: 100 },
  })
  const lists = Array.isArray(result?.data?.info) ? result.data.info : []
  return lists.map((item: any): KugouPlaylist | null => {
    const listid = String(item.listid ?? '')
    if (!listid) return null
    const isDefault = Number(item.is_def) === 2 || /^我喜欢$/.test(String(item.name ?? ''))
    return {
      id: listid,
      name: String(item.name ?? '未命名歌单'),
      // pic 形如 ".../stdmusic/{size}/xxx.jpg"，{size} 必须替换成具体尺寸才能加载。
      cover: String(item.pic ?? item.cover ?? '').replace('{size}', '400'),
      count: Math.max(0, Number(item.count ?? item.song_count) || 0),
      isDefault,
      owned: Number(item.type) !== 1,
    }
  }).filter((item: KugouPlaylist | null): item is KugouPlaylist => item != null)
}

/** 搜索歌曲：概念版走 complexsearch 网关（官网 web 搜索接口在概念版分区不可用）。 */
export async function searchSongs(context: ProviderContext, keyword: string, pageSize = 30): Promise<any[]> {
  const result = await apiRequest(context, '/v2/search/song', {
    router: 'complexsearch.kugou.com',
    // 搜索接口的 clientver 必须是概念版版本号 201，否则返回空结果。
    query: {
      keyword,
      page: 1,
      pagesize: pageSize,
      platform: 'AndroidFilter',
      iscorrection: 1,
      privilegefilter: 0,
      area_code: 1,
      dopicfull: 1,
    },
    clientverOverride: 201,
  })
  return Array.isArray(result?.data?.lists) ? result.data.lists : []
}

/** 歌单曲目（分页）。 */
export async function playlistTracks(context: ProviderContext, listid: string): Promise<any[]> {
  const creds = await ensureDevice(context)
  const songs: any[] = []
  let page = 1
  for (let i = 0; i < 200; i++) {
    const result = await apiRequest(context, '/v4/get_list_all_file_v3', {
      router: 'cloudlist.service.kugou.com',
      body: { listid, userid: creds.userid, type: 0, page, pagesize: 300, area_code: 1, allplatform: 1, show_cover: 1, token: creds.token },
    })
    // 该接口的曲目数组在 data.info（不是 data.songs），实测字段为 hash/name/timelen 等。
    const batch = Array.isArray(result?.data?.info) ? result.data.info : []
    songs.push(...batch)
    const total = Number(result?.data?.count ?? 0)
    if (!batch.length || songs.length >= total) return songs
    page++
  }
  throw new Error('酷狗歌单超过读取上限')
}

/** 添加歌曲到指定歌单。 */
export async function addToPlaylist(context: ProviderContext, listid: string, track: { name: string, hash: string, albumId: string | number, mixsongid: string | number }): Promise<void> {
  const creds = await ensureDevice(context)
  const result = await apiRequest(context, '/cloudlist.service/v6/add_song', {
    query: { last_time: Math.floor(Date.now() / 1000), last_area: 'gztx' },
    body: {
      userid: Number(creds.userid) || 0,
      token: creds.token,
      listid: Number(listid),
      list_ver: 0,
      type: 0,
      slow_upload: 1,
      scene: 'false;null',
      data: [{ number: 1, name: track.name, hash: track.hash, size: 0, sort: 0, timelen: 0, bitrate: 0, album_id: Number(track.albumId) || 0, mixsongid: Number(track.mixsongid) || 0 }],
    },
  })
  if (Number(result?.status) !== 1) throw new Error(`酷狗加歌失败 (${Number(result?.error_code ?? -1)})`)
}

/** 领取每日畅听会员（服务端把广告观看时长折算成会员）。 */
export async function claimDayVip(context: ProviderContext): Promise<{ received: boolean, message: string, rewardedHours: number }> {
  const now = Date.now()
  // 先上报一次广告播放，服务端据此累计观看时长与可领取次数。
  let rewardedHours = 0
  const report = await apiRequest(context, '/youth/v1/ad/play_report', {
    body: { ad_id: 12307537187, play_end: now, play_start: now - 30000 },
  }).catch(() => null)
  if (report) rewardedHours = Number(report?.data?.award_vip_hour) || 0
  const result = await apiRequest(context, '/youth/v1/recharge/receive_vip_listen_song', {
    query: { source_id: 90139, receive_day: 1 },
    // 304001 = 今日已领取；这是业务状态而非失败。
    allowCodes: [304001],
  })
  const code = Number(result?.error_code ?? result?.status)
  if (code === 304001) return { received: false, message: '今天已经领过了，明天再来', rewardedHours }
  const received = Number(result?.status) === 1
  return { received, message: String(result?.data?.msg ?? result?.error_msg ?? (received ? '已领取畅听会员' : '领取失败')), rewardedHours }
}

/** 升级每日概念会员。 */
export async function upgradeDayVip(context: ProviderContext): Promise<{ upgraded: boolean, message: string }> {
  const creds = await ensureDevice(context)
  const result = await apiRequest(context, '/youth/v1/listen_song/upgrade_vip_reward', {
    query: { kugouid: Number(creds.userid) || 0, ad_type: 1 },
    // 297002 = 升级条件未满足（如当日听歌时长不足），同样按业务状态返回。
    allowCodes: [297002],
  })
  const code = Number(result?.error_code ?? result?.status)
  if (code === 297002) return { upgraded: false, message: '升级条件未满足，多听几首歌再试' }
  return { upgraded: Number(result?.status) === 1, message: String(result?.data?.msg ?? result?.error_msg ?? '') }
}
