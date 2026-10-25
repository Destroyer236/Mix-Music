// 逆向：酷我 Web 端 bundle 中所有 /api/www 路径，重点找歌单写接口。
const { app, session } = require('electron')

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:linkline-account-kuwo')
  try {
    const home = await ses.fetch('https://www.kuwo.cn/', { signal: AbortSignal.timeout(20000) })
    const html = await home.text()
    const scripts = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => new URL(m[1], 'https://www.kuwo.cn/').toString()))]
    console.log('脚本数:', scripts.length)

    const allPaths = new Set()
    const writeHits = []
    for (const url of scripts) {
      try {
        const res = await ses.fetch(url, { signal: AbortSignal.timeout(25000) })
        if (!res.ok) continue
        const text = await res.text()
        for (const m of text.matchAll(/["'`](\/api\/[a-z0-9_\-\.\/]{2,90})["'`]/gi)) allPaths.add(m[1])
        // 写操作关键词
        for (const kw of ['addToPlayList', 'addMusicToPlayList', 'playlist/add', 'addSongTo', 'batchAdd', 'collect/add', 'add_music']) {
          const i = text.indexOf(kw)
          if (i >= 0) writeHits.push({ url: url.split('/').pop(), kw, ctx: text.slice(Math.max(0, i - 250), i + 320).replace(/\s+/g, ' ') })
        }
      } catch { /* skip */ }
    }
    console.log(`\n=== /api/ 路径 ${allPaths.size} 条 ===`)
    const relevant = [...allPaths].filter(p => /playlist|collect|fav|music/i.test(p)).sort()
    for (const p of relevant.slice(0, 50)) console.log('  ', p)
    console.log('\n=== 写操作命中 ===')
    for (const hit of writeHits.slice(0, 8)) console.log(`[${hit.kw}] (${hit.url})\n  ${hit.ctx}\n`)
  } catch (error) { console.log('失败:', error.message) }
  app.quit()
})
