// 诊断：用账号 session 实测咪咕 profile 三个接口的响应结构（复刻 provider 的请求方式）。
const { app, session } = require('electron')
const path = require('node:path')

app.setPath('userData', path.join(__dirname, '..', 'artifacts', 'user-test-data'))

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:linkline-account-migu')
    const cookies = Object.fromEntries((await ses.cookies.get({ url: 'https://music.migu.cn/' })).map(c => [c.name, c.value]))
    console.log('mg_auth_uid:', cookies.mg_auth_uid, '| pacmtoken:', cookies.mg_auth_pacmtoken ? `${cookies.mg_auth_pacmtoken.slice(0, 12)}…` : '(无)')
    const headers = new Headers({
      Referer: 'https://music.migu.cn/', Origin: 'https://music.migu.cn',
      channel: '014X031', subchannel: '014X031', appId: 'h5', platform: 'H5',
      ua: 'Android_migu', version: '6.8.8', IMEI: 'h5page', IMSI: 'h5page',
      uid: cookies.mg_auth_uid ?? '', pacmtoken: cookies.mg_auth_pacmtoken ?? '',
      timestamp: String(Date.now()), 'Content-Type': 'application/json;charset=UTF-8',
    })
    for (const [label, url] of [
      ['user-info/v1.0', 'https://c.musicapp.migu.cn/user/h5/user-info/v1.0'],
      ['member/icon/v1.0', 'https://c.musicapp.migu.cn/pc/open/api/member/icon/v1.0'],
      ['trust-uid/v1.0', 'https://c.musicapp.migu.cn/pc/user/api/user-info/trust-uid/v1.0'],
    ]) {
      try {
        const response = await ses.fetch(url, { headers, credentials: 'include', signal: AbortSignal.timeout(20000) })
        const json = await response.json()
        const text = JSON.stringify(json)
        console.log(`\n=== ${label} === HTTP ${response.status}`)
        console.log(text.slice(0, 700))
      } catch (error) {
        console.log(`\n=== ${label} === 请求失败: ${error.message}`)
      }
    }
  } catch (error) {
    console.error('诊断失败:', error)
  } finally {
    app.quit()
  }
})
