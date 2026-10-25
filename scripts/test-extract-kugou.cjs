// 逆向：读取酷狗 collect-2400.js，提取收藏/歌单接口。
const { app, session } = require('electron')

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:linkline-account-kugou')
  try {
    const response = await ses.fetch('https://www.kugou.com/collect-2400.js', { signal: AbortSignal.timeout(20000) })
    const text = await response.text()
    console.log('size:', text.length)
    // 输出所有 URL / 路径字面量与接口调用
    const paths = new Set()
    for (const m of text.matchAll(/["'`](\/[a-z0-9_\-\.\/]{3,90})["'`]/gi)) paths.add(m[1])
    console.log('\n=== 路径字面量 ===')
    for (const p of [...paths].sort()) console.log('  ', p)
    // 找关键函数/参数名
    console.log('\n=== 关键片段 ===')
    for (const keyword of ['playlist', 'listid', 'collect', 'add_song', 'cloudlist', 'fav']) {
      let index = 0
      let count = 0
      while (count < 3) {
        index = text.toLowerCase().indexOf(keyword, index)
        if (index < 0) break
        console.log(`[${keyword}]`, text.slice(Math.max(0, index - 160), index + 220).replace(/\s+/g, ' '))
        console.log('---')
        index += keyword.length
        count++
      }
    }
  } catch (error) { console.log('失败:', error.message) }
  app.quit()
})
