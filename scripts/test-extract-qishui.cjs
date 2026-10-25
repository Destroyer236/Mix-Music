// 逆向（汽水第二轮）：找主 bundle 里的动态 chunk 并搜索 write 接口。
const { app, session } = require('electron')

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:linkline-account-qishui')
  const base = 'https://lf-luna.qishui.com/obj/music-luna-fe/luna/home/1.0.0.274/assets/'
  try {
    const main = await ses.fetch(`${base}index-4d21fa75.js`, { signal: AbortSignal.timeout(25000) })
    const text = await main.text()
    console.log('主 bundle:', text.length)
    // chunk 文件名
    const chunks = new Set()
    for (const m of text.matchAll(/["'`]([A-Za-z0-9_\-\.]+\.js)["'`]/g)) chunks.add(m[1])
    for (const m of text.matchAll(/([A-Za-z0-9_\-\.]+)-[a-f0-9]{8}\.js/g)) chunks.add(m[0])
    console.log('可疑 chunk:', [...chunks].slice(0, 40).join(', '))

    // 找 API 基础路径与应用名
    for (const kw of ['/luna/', 'api.qishui', 'playlist', 'track_ids', 'music_id']) {
      const i = text.indexOf(kw)
      if (i < 0) { console.log(`[${kw}] 未找到`); continue }
      console.log(`[${kw}]`, text.slice(Math.max(0, i - 150), i + 250).replace(/\s+/g, ' '))
    }
    // 找所有以 / 开头的短路径
    const paths = new Set()
    for (const m of text.matchAll(/["'`](\/(?:luna|api|music|v\d)[a-z0-9_\-\.\/]{2,70})["'`]/gi)) paths.add(m[1])
    console.log('\n路径:', [...paths].sort().join('\n  '))
  } catch (error) { console.log('失败:', error.message) }
  app.quit()
})
