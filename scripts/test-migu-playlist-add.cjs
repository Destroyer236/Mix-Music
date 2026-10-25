// 逆向验证：咪咕 add-music-list-song 带 id（歌单ID）参数的响应。
const { app, session } = require('electron')

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:linkline-account-migu')
  const call = async (path, params, post = true) => {
    const url = new URL(path, 'https://c.musicapp.migu.cn')
    if (!post) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    const headers = new Headers({
      Referer: 'https://music.migu.cn/', Origin: 'https://music.migu.cn',
      channel: '014X031', subchannel: '014X031', appId: 'h5', platform: 'H5',
      ua: 'Android_migu', version: '6.8.8', IMEI: 'h5page', IMSI: 'h5page',
      uid: '', pacmtoken: '', timestamp: String(Date.now()),
      'Content-Type': 'application/json;charset=UTF-8',
    })
    try {
      const response = await ses.fetch(url.toString(), { method: post ? 'POST' : 'GET', headers, body: post ? JSON.stringify(params) : undefined, signal: AbortSignal.timeout(15000) })
      const text = await response.text()
      return { status: response.status, body: text.slice(0, 300) }
    } catch (error) { return { error: error.message } }
  }

  console.log('=== 未登录下各参数组合的响应（用于确认结构）===')
  const variants = [
    ['仅 contentIds（红心式）', '/pc/user/api/add-music-list-song/v1.0', { contentIds: ['600907000006254992'] }],
    ['id + contentIds（加歌单）', '/pc/user/api/add-music-list-song/v1.0', { id: '123456789', contentIds: ['600907000006254992'] }],
    ['musicListId + contentIds', '/pc/user/api/add-music-list-song/v1.0', { musicListId: '123456789', contentIds: ['600907000006254992'] }],
    ['创建歌单（对照）', '/pc/open/api/music-list/add/v2.0', { title: 'LinkLine接口验证', channel: '23', type: 'self_build' }],
    ['删除歌单（对照）', '/pc/v1.0/user/deleteMusicList.do', { musicListId: '1' }, false],
  ]
  for (const [label, path, params, post] of variants) {
    console.log(`[${label}]`, JSON.stringify(await call(path, params, post !== false)))
  }

  // 歌词/歌单读取等只读接口作为端点存在性对照
  console.log('\n=== 端点存在性对照（只读）===')
  for (const [label, path, params] of [
    ['歌单曲目（真实）', '/MIGUM3.0/resource/playlist/song/v2.0', { playlistId: '1', pageNo: 1, pageSize: 1 }],
    ['首页（需登录）', '/pc/user/home-page/v2.0', {}],
  ]) console.log(`[${label}]`, JSON.stringify(await call(path, params, false)))

  app.quit()
})
