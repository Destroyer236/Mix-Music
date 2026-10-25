// 官网登录检测诊断 v3：支持 kugou/kuwo，登录后自动实测上游验证接口并记录原始响应。
// 用法：node_modules/.bin/electron scripts/test-weblogin-diag.cjs <kugou|kuwo|migu|bilibili|qq>
const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.setPath('userData', path.join(__dirname, '..', 'artifacts', 'user-test-data'))

// 酷我 www API 的 Secret 头算法（与 src/main/modules/platformAccounts/providers/kuwo.ts 一致）
const kuwoSecretCookie = 'Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324'
function kuwoWebSecret(value) {
  let digits = [...kuwoSecretCookie].map(char => char.charCodeAt(0)).join('')
  const split = Math.floor(digits.length / 5)
  const multiplier = Number([1, 2, 3, 4, 5].map(index => digits.charAt(split * index)).join(''))
  const increment = Math.ceil(kuwoSecretCookie.length / 2)
  const modulus = 2 ** 31 - 1
  const salt = Math.round(1e9 * Math.random()) % 1e8
  digits += salt
  while (digits.length > 10) digits = String(Number(digits.slice(0, 10)) + Number(digits.slice(10)))
  let seed = (multiplier * Number(digits) + increment) % modulus
  let encoded = ''
  for (const char of value) {
    encoded += (char.charCodeAt(0) ^ Math.floor(seed / modulus * 255)).toString(16).padStart(2, '0')
    seed = (multiplier * seed + increment) % modulus
  }
  return encoded + salt.toString(16).padStart(8, '0')
}

const PLATFORMS = {
  migu: { loginUrl: 'https://music.migu.cn/v5/#/favorite', cookieUrl: 'https://music.migu.cn/', authNames: ['mg_auth_pacmtoken', 'mg_auth_uid'] },
  bilibili: { loginUrl: 'https://passport.bilibili.com/login', cookieUrl: 'https://www.bilibili.com/', authNames: ['SESSDATA'] },
  qq: { loginUrl: 'https://y.qq.com/', cookieUrl: 'https://y.qq.com/', authNames: ['qqmusic_key', 'qm_keyst'] },
  kugou: {
    loginUrl: 'https://www.kugou.com/', cookieUrl: 'https://www.kugou.com/', authNames: ['KuGoo'],
    profileTest: async(ses, cookies, log) => {
      const decode = value => { const unicode = String(value ?? '').replace(/%u([\da-f]{4})/gi, (_m, code) => String.fromCharCode(parseInt(code, 16))); try { return decodeURIComponent(unicode) } catch { return unicode } }
      const values = Object.fromEntries((cookies.KuGoo ?? '').split('&').map(part => { const i = part.indexOf('='); return i < 0 ? [part, ''] : [part.slice(0, i), decode(part.slice(i + 1))] }))
      log(`[kugou] KuGoo 字段: ${Object.keys(values).join(',')} | KugooID=${values.KugooID ?? ''} a_id=${values.a_id ?? ''} token=${values.t ? '有' : '无'}`)
      const url = new URL('https://login-user.kugou.com/v1/autologin')
      for (const [k, v] of Object.entries({ a_id: values.a_id || '1014', userid: values.KugooID ?? '', t: values.t ?? '', ct: values.ct || String(Math.floor(Date.now() / 1000)), domain: 'kugou.com' })) url.searchParams.set(k, String(v))
      try {
        const response = await ses.fetch(url.toString(), { headers: new Headers({ Referer: 'https://www.kugou.com/' }), credentials: 'include', signal: AbortSignal.timeout(20000) })
        log(`[kugou autologin] HTTP ${response.status} ${JSON.stringify((await response.text()).slice(0, 600))}`)
      } catch (error) { log(`[kugou autologin] 失败: ${error.message}`) }
    },
  },
  kuwo: {
    loginUrl: 'https://www.kuwo.cn/?login=open', cookieUrl: 'https://www.kuwo.cn/', authNames: ['userid'],
    profileTest: async(ses, cookies, log) => {
      for (const name of ['userid', 'sid', 'username', 'uname3', 'pic3', 'websid', 'logintype']) {
        const all = await ses.cookies.get({ name })
        log(`[kuwo] cookie ${name}: ${all.map(c => `domain=${c.domain} hostOnly=${c.hostOnly} session=${!c.expirationDate} value=${String(c.value).slice(0, 40)}`).join(' || ') || '(无)'}`)
      }
      const uid = cookies.userid ?? ''
      const cookieHeader = Object.entries(cookies).filter(([key, value]) => key && value).map(([key, value]) => `${key}=${value}`).join('; ')
      try {
        const vip = await ses.fetch(`https://vip1.kuwo.cn/vip/v2/user/vip?op=gvi&uid=${encodeURIComponent(uid)}`, { headers: new Headers({ Referer: 'https://www.kuwo.cn/', Cookie: cookieHeader }), credentials: 'include', signal: AbortSignal.timeout(20000) })
        log(`[kuwo vip gvi] HTTP ${vip.status} ${(await vip.text()).slice(0, 800)}`)
      } catch (error) { log(`[kuwo vip gvi] 失败: ${error.message}`) }
      try {
        const headers = new Headers({ Referer: 'https://www.kuwo.cn/', Origin: 'https://www.kuwo.cn', csrf: cookies.kw_token ?? '', Secret: kuwoWebSecret(cookies[kuwoSecretCookie] ?? ''), 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' })
        const response = await ses.fetch(`https://www.kuwo.cn/api/www/user/userInfo?httpsStatus=1&reqId=${Date.now()}&plat=web_www`, { headers, credentials: 'include', signal: AbortSignal.timeout(20000) })
        const json = await response.json().catch(() => null)
        log(`[kuwo userInfo] HTTP ${response.status} ${JSON.stringify(json).slice(0, 800)}`)
      } catch (error) { log(`[kuwo userInfo] 失败: ${error.message}`) }
    },
  },
}

app.whenReady().then(async () => {
  const platform = process.argv[2] && PLATFORMS[process.argv[2]] ? process.argv[2] : 'migu'
  const config = PLATFORMS[platform]
  const logPath = path.join(__dirname, 'weblogin-diag.log')
  const log = line => { fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`) }
  fs.writeFileSync(logPath, `=== ${platform} 诊断v3 ${new Date().toISOString()} ===\n`)
  const ses = session.fromPartition(`persist:linkline-account-${platform}`)

  const win = new BrowserWindow({
    width: 1080, height: 760, autoHideMenuBar: true,
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  let profileDone = false
  const interval = setInterval(() => {
    void (async() => {
      const visible = await ses.cookies.get({ url: config.cookieUrl })
      const authOk = config.authNames.every(name => visible.some(c => c.name === name))
      log(`[check] hasAuthentication=${authOk} visible=[${visible.map(c => c.name).join(',')}]`)
      if (authOk && !profileDone) {
        profileDone = true
        log(`=== 检测到登录 Cookie，开始 ${platform} profile 实测 ===`)
        const cookies = Object.fromEntries(visible.map(c => [c.name, c.value]))
        try {
          if (config.profileTest) await config.profileTest(ses, cookies, log)
        } catch (error) { log(`[profileTest 异常] ${error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : error}`) }
        log(`=== profile 实测完成，窗口可关闭 ===`)
      }
    })()
  }, 3000)
  win.on('closed', () => { clearInterval(interval); log('=== 窗口关闭，15 秒后退出 ==='); setTimeout(() => app.quit(), 15000) })
  await win.loadURL(config.loginUrl)
  log(`loginUrl 已加载: ${config.loginUrl}`)
})
