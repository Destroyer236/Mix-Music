import { createPublicKey, publicEncrypt, constants, randomUUID, type JsonWebKey } from 'node:crypto'
import type { ProviderContext } from './providers/types'

/**
 * 咪咕音乐手机号验证码登录，复刻 passport.migu.cn 网页登录表单：
 * 1. GET  /login/dynamicpassword         发送短信验证码（明文手机号，实测可用）
 * 2. POST /password/publickey            获取 RSA 公钥（hex 模数/指数）
 * 3. POST /authn/dynamicpassword         手机号与验证码 RSA 加密后表单提交
 * 4. GET  c.musicapp.migu.cn/user/h5/token/v1.0?uSessionId=…  passport token
 *    换 mg_auth_* 音乐 Cookie（响应 Set-Cookie 写入账号 session）
 * securityCode 为网页端随机数，fingerPrint 允许为空（表单服务端渲染默认值）。
 */

const PASSPORT = 'https://passport.migu.cn'
const LOGIN_PAGE = `${PASSPORT}/login?sourceid=220001`
const SOURCE_ID = '220001'
// 官网 PC 站的登录回跳地址：passport 登录成功后 302 到此地址并附带 token/usession。
const LOGIN_CALLBACK = 'https://music.migu.cn/v5/'
const SUCCESS = 2000

type Json = Record<string, any>
const object = (value: unknown): Json => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const headers = (extra: Record<string, string> = {}) => new Headers({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: LOGIN_PAGE,
  Origin: PASSPORT,
  'X-Requested-With': 'XMLHttpRequest',
  ...extra,
})

const sendErrors: Record<string, string> = {
  4001: '手机号格式不正确',
  4005: '验证码错误，请重试',
  4023: '当前号码已被限制接收咪咕短信，可编辑短信 YC 发送至 106581062 解除限制',
  4024: '当前号码暂不能接收咪咕短信',
  4033: '当前号码在黑名单中，无法接收验证码',
  4034: '当前号码无法接收验证码',
  6123: '咪咕要求滑块安全验证，请在官网登录页完成后重试',
}

export interface MiguPhoneLoginResult {
  ok: boolean
  message: string
}

export function createMiguPhoneLogin(context: ProviderContext, onConfirmed: () => Promise<void>) {
  const request = async(path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await context.session.fetch(new URL(path, PASSPORT).toString(), {
      credentials: 'include',
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers: headers(init.headers as Record<string, string> | undefined),
    })
    return response
  }

  const rsaEncrypt = async(plain: string): Promise<string> => {
    const body = await request('/password/publickey', { method: 'POST' }).then(async response => response.json()).catch(() => null)
    const result = object(object(body).result)
    const modulus = String(result.modulus ?? '').replace(/^00/, '').trim()
    const exponent = String(result.publicExponent ?? '010001').trim()
    if (!/^[0-9a-f]+$/i.test(modulus) || !/^[0-9a-f]+$/i.test(exponent) || modulus.length < 128) throw new Error('咪咕登录服务暂不可用，请稍后重试')
    // 网页端 JSEncrypt 风格：PKCS#1 v1.5 填充，密文输出 hex。
    const jwk: JsonWebKey = { kty: 'RSA', n: Buffer.from(modulus, 'hex').toString('base64url'), e: Buffer.from(exponent, 'hex').toString('base64url') }
    const key = createPublicKey({ key: jwk, format: 'jwk' })
    return publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(plain, 'utf8')).toString('hex')
  }

  /** 发送短信验证码。成功返回 ok:true。 */
  const sendCode = async(phone: string): Promise<MiguPhoneLoginResult> => {
    if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, message: '请输入正确的手机号' }
    const response = await request(`/login/dynamicpassword?sourceID=${SOURCE_ID}&appType=0&msisdn=${encodeURIComponent(phone)}`)
    const body = object(await response.json().catch(() => null))
    const status = Number(body.status)
    if (status === SUCCESS) return { ok: true, message: '验证码已发送，请在短信中查收' }
    return { ok: false, message: sendErrors[String(status)] ?? String(body.message ?? `咪咕验证码发送失败 (${status || '网络异常'})`) }
  }

  /** 打开登录页：携带 callbackURL 让 passport 渲染 relayState，登录成功后据此回传 token/usession。 */
  const prepareRelayState = async(): Promise<string> => {
    const response = await request(`/login?sourceid=${SOURCE_ID}&callbackURL=${encodeURIComponent(LOGIN_CALLBACK)}`)
    const html = await response.text().catch(() => '')
    const match = /name="relayState"[^>]*value="([^"]*)"/.exec(html) ?? /value="([^"]*)"[^>]*name="relayState"/.exec(html)
    return match ? match[1] : ''
  }

  const paramFromLocation = (location: string, names: string[]): string => {
    try {
      const url = new URL(location, PASSPORT)
      for (const name of names) {
        const value = url.searchParams.get(name)
        if (value) return value
      }
      // token 可能放在 fragment（#token=…&usession=…）
      if (url.hash.length > 1) {
        const fragment = new URLSearchParams(url.hash.slice(1))
        for (const name of names) {
          const value = fragment.get(name)
          if (value) return value
        }
      }
    } catch {}
    return ''
  }

  // 设备标识：官网用 migu-device-uuid cookie（UUID），持久化在账号 session 里。
  const deviceUuid = async(): Promise<string> => {
    const existing = (await context.cookies()).linkline_migu_device
    if (/^[0-9a-f-]{36}$/i.test(existing ?? '')) return existing
    const value = randomUUID()
    await context.session.cookies.set({ url: 'https://music.migu.cn/', domain: '.migu.cn', path: '/', name: 'linkline_migu_device', value, secure: true, sameSite: 'lax', expirationDate: Date.now() / 1000 + 365 * 86400 })
    return value
  }

  /**
   * 用 passport 回传的 utoken 调官网同款凭证校验接口。SDK（loginByToken/e7）在浏览器里
   * 把响应写成 mg_auth_* Cookie（pacmtoken 来自响应头），服务端 fetch 拿不到 Set-Cookie，
   * 所以这里按官网字段显式写入账号 session。
   */
  const validateToken = async(utoken: string): Promise<MiguPhoneLoginResult> => {
    const deviceId = await deviceUuid()
    const response = await context.session.fetch(`https://c.musicapp.migu.cn/user/h5/token-validate/v3.0?token=${encodeURIComponent(utoken)}&type=2&sourceId=220029`, {
      credentials: 'include',
      headers: new Headers({ deviceId, Referer: 'https://music.migu.cn/', Origin: 'https://music.migu.cn', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null)
    if (!response || !response.ok) return { ok: false, message: '咪咕登录凭证校验失败，请重试' }
    const body = object(await response.json().catch(() => null))
    if (String(body.code) !== '000000') return { ok: false, message: String(body.info ?? '咪咕登录凭证校验未通过，请重试') }
    const data = object(body.data)
    const pacmtoken = response.headers.get('pacmtoken') ?? String(data.pacmtoken ?? '')
    const fields: Array<[string, unknown]> = [
      ['mg_auth_pacmtoken', pacmtoken],
      ['mg_auth_sid', data.usessionId],
      ['mg_auth_pid', data.passId],
      ['mg_auth_msisdn', data.msisdn],
      ['mg_auth_uid', data.userId],
      ['mg_auth_authType', data.authType],
    ]
    const expirationDate = Date.now() / 1000 + 365 * 86400
    for (const [name, raw] of fields) {
      const value = String(raw ?? '')
      if (!value) continue
      await context.session.cookies.set({ url: 'https://music.migu.cn/', domain: '.migu.cn', path: '/', name, value, secure: true, sameSite: 'lax', expirationDate })
    }
    const cookies = await context.cookies()
    if (!cookies.mg_auth_pacmtoken || !cookies.mg_auth_uid) return { ok: false, message: '咪咕登录未写入账号凭证，请重试' }
    return { ok: true, message: '登录成功，正在同步音乐库' }
  }
  const login = async(phone: string, code: string): Promise<MiguPhoneLoginResult> => {
    if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, message: '请输入正确的手机号' }
    if (!/^\d{4,8}$/.test(code)) return { ok: false, message: '请输入短信验证码' }
    let encryptedPhone: string
    let encryptedCode: string
    try {
      ;[encryptedPhone, encryptedCode] = await Promise.all([rsaEncrypt(phone), rsaEncrypt(code)])
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '咪咕登录服务暂不可用' }
    }
    const relayState = await prepareRelayState()
    const form = new URLSearchParams({
      sourceID: SOURCE_ID,
      appType: '0',
      relayState,
      msisdn: encryptedPhone,
      securityCode: String(Math.floor(1000 + Math.random() * 9000)),
      captcha: '',
      imgcodeType: '2',
      dynamicPassword: encryptedCode,
      fingerPrint: '',
      fingerPrintDetail: '',
    })
    // session.fetch 的 manual redirect 会直接取消重定向且不暴露 Location（参见 nativeLogin.ts 的
    // QQ OAuth 注释），因此这里让 fetch 自动跟随重定向：session 沿途自动写入 Set-Cookie，
    // 成功后从最终落地 URL（callbackURL?token=…&usession=…）提取凭证。
    const response = await request('/authn/dynamicpassword', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() })
    const finalUrl = response.url || ''
    let token = paramFromLocation(finalUrl, ['token', 'pacmtoken'])
    if (!token) {
      // 无重定向时响应是 JSON：成功含凭证，失败含业务错误码。
      const text = await response.text().catch(() => '')
      let body: Json = {}
      try { body = object(JSON.parse(text)) } catch {}
      const status = Number(body.status)
      if (status !== SUCCESS) {
        return { ok: false, message: sendErrors[String(status)] ?? String(body.message ?? `咪咕登录失败 (${status || response.status})`) }
      }
      token = String(body.token ?? object(body.result).token ?? '')
    }
    if (!token) return { ok: false, message: '咪咕登录未返回有效凭证（响应 200，无重定向参数），请稍后重试' }
    // passport token（utoken）→ 官网凭证校验 → 显式写入 mg_auth_* Cookie。
    const result = await validateToken(token)
    if (!result.ok) return result
    await onConfirmed()
    return { ok: true, message: result.message }
  }

  return { sendCode, login }
}
