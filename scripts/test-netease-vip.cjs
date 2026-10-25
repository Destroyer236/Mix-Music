// 一次性诊断：用 LinkLine 的网易云账号 session 调 nuser/account/get，打印会员相关字段。
// 用法：node_modules/.bin/electron scripts/diag-netease-vip.cjs （需先关闭 LinkLine 主程序）
const { app, session } = require('electron')
const path = require('node:path')

app.setPath('userData', path.join(__dirname, '..', 'artifacts', 'user-test-data'))

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:linkline-account-netease')
    const cookies = Object.fromEntries((await ses.cookies.get({ url: 'https://music.163.com/' })).map(c => [c.name, c.value]))
    console.log('has MUSIC_U:', Boolean(cookies.MUSIC_U), '| has __csrf:', Boolean(cookies.__csrf))
    const encryption = require('NeteaseCloudMusicApi/util/crypto')
    const csrf = cookies.__csrf ?? ''
    const body = new URLSearchParams(encryption.weapi({ csrf_token: csrf })).toString()
    const response = await ses.fetch(`https://music.163.com/weapi/nuser/account/get?csrf_token=${encodeURIComponent(csrf)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
      body,
    })
    const json = await response.json()
    console.log('code:', json.code)
    const profile = json.profile ?? {}
    console.log('nickname:', profile.nickname)
    const vipEntries = Object.entries(profile).filter(([key]) => /vip|red/i.test(key))
    console.log('profile 会员相关字段:', JSON.stringify(Object.fromEntries(vipEntries)))
    console.log('account 对象完整内容:', JSON.stringify(json.account))
  } catch (error) {
    console.error('诊断失败:', error)
  } finally {
    app.quit()
  }
})
