// 逆向（第二轮）：精确提取平台 Web bundle 中的 API 路径与请求参数。
const { app, session } = require('electron')

const targets = [
  { name: '咪咕音乐', home: 'https://music.migu.cn/v5/', partition: 'persist:linkline-account-migu' },
  { name: '酷我音乐', home: 'https://www.kuwo.cn/', partition: 'persist:linkline-account-kuwo' },
  { name: '酷狗音乐', home: 'https://www.kugou.com/', partition: 'persist:linkline-account-kugou' },
]

app.whenReady().then(async () => {
  for (const target of targets) {
    console.log(`\n########## ${target.name} ##########`)
    try {
      const ses = session.fromPartition(target.partition)
      const response = await ses.fetch(target.home, { signal: AbortSignal.timeout(20000) })
      const html = await response.text()
      const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1])
      console.log('首页:', html.length, 'bytes, scripts:', scripts.length)

      const endpoints = new Set()
      const bodies = []
      for (const src of scripts.slice(0, 30)) {
        const url = new URL(src, target.home).toString()
        try {
          const res = await ses.fetch(url, { signal: AbortSignal.timeout(25000) })
          if (!res.ok) continue
          const text = await res.text()
          bodies.push(text)
          console.log('  bundle', url.split('/').pop()?.slice(0, 45), text.length)
        } catch (error) { console.log('  bundle 失败:', src.slice(0, 50)) }
      }
      const all = bodies.join('\n')

      // 精确匹配：以 / 开头的 API 路径字面量
      const patterns = [
        /["'`](\/(?:api|MIGUM\d?\.\d|pc|user|resource|cgi-bin|mobi|v\d|www)\/[a-z0-9_\-\/\.]{3,80})["'`]/gi,
        /["'`](\/[a-z0-9_\-\/\.]*(?:playlist|musiclist|add|collect)[a-z0-9_\-\/\.]*)["'`]/gi,
      ]
      for (const text of bodies) {
        for (const pattern of patterns) {
          for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
            const path = match[1]
            if (path.length > 5 && path.length < 100) endpoints.add(path)
          }
        }
      }
      const relevant = [...endpoints].filter(p => /playlist|musiclist|add|collect|fav/i.test(p)).sort()
      console.log(`>>> 相关路径 ${relevant.length} 条:`)
      for (const path of relevant.slice(0, 60)) console.log('   ', path)

      // 找加歌相关的关键词上下文
      for (const keyword of ['addSong', 'addMusic', 'addTrack', 'add_song', 'addMusicList', 'add-music-list', 'playlist/add', 'collect/add', 'addToPlaylist']) {
        const index = all.indexOf(keyword)
        if (index < 0) continue
        console.log(`\n[关键词 ${keyword}] 上下文:`)
        console.log('   ', all.slice(Math.max(0, index - 200), index + 300).replace(/\s+/g, ' '))
      }
    } catch (error) { console.log('失败:', error.message) }
  }
  app.quit()
})
