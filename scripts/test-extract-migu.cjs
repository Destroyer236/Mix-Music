// 逆向（咪咕第三轮）：定位「addSongs / 已添加至」附近的实际请求与参数名。
const { app, session } = require('electron')

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:linkline-account-migu')
  try {
    const response = await ses.fetch('https://music.migu.cn/v5/static/js/main-4f72ecaf.js', { signal: AbortSignal.timeout(30000) })
    const text = await response.text()

    // 1. 找"已添加至"所在函数完整实现
    for (const keyword of ['已添加至', 'addSongs', 'fail2RepeatContentIdList']) {
      console.log(`\n########## ${keyword} ##########`)
      let i = 0, c = 0
      while (c < 3) {
        i = text.indexOf(keyword, i)
        if (i < 0) break
        console.log(text.slice(Math.max(0, i - 800), i + 700).replace(/\s+/g, ' '))
        console.log('\n----------\n')
        i += keyword.length; c++
      }
    }

    // 2. 找所有 post 且路径含 add 的
    console.log('\n########## 所有含 add 的 post 端点 ##########')
    for (const m of text.matchAll(/ce\.post\(([^)]{0,200})\)/g)) {
      const call = m[1]
      if (/add|Add/.test(call)) console.log(call.replace(/\s+/g, ' ').slice(0, 200))
    }
    console.log('\n########## 所有含 music-list 的 post ##########')
    for (const m of text.matchAll(/ce\.post\(["'`]([^"'`]+)["'`]/g)) {
      if (/music-list|playlist|list/i.test(m[1])) console.log(m[1])
    }
  } catch (error) { console.log('失败:', error.message) }
  app.quit()
})
