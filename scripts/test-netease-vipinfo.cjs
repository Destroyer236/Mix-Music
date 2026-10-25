// 一次性诊断：实测网易云 VIP 到期接口的响应结构（music-vip-membership/front + client 两个版本）。
// 用法：关闭 LinkLine 后运行 node_modules/.bin/electron scripts/test-netease-vipinfo.cjs
const { app, session } = require('electron')
const path = require('node:path')

app.setPath('userData', path.join(__dirname, '..', 'artifacts', 'user-test-data'))

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:linkline-account-netease')
    const cookies = Object.fromEntries((await ses.cookies.get({ url: 'https://music.163.com/' })).map(c => [c.name, c.value]))
    const uid = Number(process.env.DIAG_UID || 0)
    const encryption = require('NeteaseCloudMusicApi/util/crypto')
    const csrf = cookies.__csrf ?? ''
    for (const route of ['/api/music-vip-membership/front/vip/info', '/api/music-vip-membership/client/vip/info']) {
      const body = new URLSearchParams(encryption.weapi({ userId: uid, csrf_token: csrf })).toString()
      const response = await ses.fetch(`https://music.163.com/weapi${route.substr(4)}?csrf_token=${encodeURIComponent(csrf)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
        body,
      })
      const json = await response.json()
      const flat = JSON.stringify(json, (key, value) => (key === 'users' || key === 'redVipList' ? undefined : value))
      console.log(route, '->', 'code:', json.code, '|', flat.slice(0, 900))
    }
  } catch (error) {
    console.error('诊断失败:', error)
  } finally {
    app.quit()
  }
})
