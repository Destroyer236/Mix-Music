// 一次性诊断：只读检查真实账号分区里各平台的登录 cookie 是否存在。
const { app, session } = require('electron')
const path = require('node:path')

app.setPath('userData', path.join(process.env.APPDATA, 'LinkLine'))

const checks = [
  ['qq', 'https://y.qq.com/', ['qqmusic_key', 'qm_keyst', 'uin']],
  ['netease', 'https://music.163.com/', ['MUSIC_U', '__csrf']],
  ['qishui', 'https://qishui.douyin.com/', []],
  ['bodian', 'https://fm.music.lava.cn/', []],
  ['kugou', 'https://www.kugou.com/', []],
  ['kuwo', 'https://www.kuwo.cn/', []],
  ['migu', 'https://music.migu.cn/', ['mg_auth_uid', 'mg_auth_pacmtoken']],
  ['bilibili', 'https://www.bilibili.com/', ['SESSDATA', 'bili_jct', 'DedeUserID']],
]

app.whenReady().then(async () => {
  for (const [id, url, names] of checks) {
    try {
      const ses = session.fromPartition(`persist:linkline-account-${id}`)
      const cookies = await ses.cookies.get({ url })
      const have = new Set(cookies.map(c => c.name))
      const interesting = names.length ? names.map(n => `${n}:${have.has(n) ? 'Y' : '-'}`).join(' ') : `${cookies.length} cookies`
      console.log(`${id.padEnd(9)} cookies=${String(cookies.length).padStart(3)}  ${interesting}`)
    } catch (error) {
      console.log(`${id.padEnd(9)} 读取失败: ${error.message}`)
    }
  }
  app.quit()
})
