// 逆向验证（B站第三轮）：删除收藏为何未生效，并清理上一轮误加的一条。
const { app, session } = require('electron')
const path = require('node:path')

app.setPath('userData', path.join(process.env.APPDATA, 'LinkLine'))

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:linkline-account-bilibili')
    const cookies = Object.fromEntries((await ses.cookies.get({ url: 'https://www.bilibili.com/' })).map(c => [c.name, c.value]))
    const csrf = cookies.bili_jct ?? ''
    const cookieHeader = Object.entries(cookies).filter(([k, v]) => k && v).map(([k, v]) => `${k}=${v}`).join('; ')
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

    const get = async (route, params = {}) => {
      const url = new URL(route, 'https://api.bilibili.com')
      url.search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
      const response = await ses.fetch(url.toString(), { headers: new Headers({ Referer: 'https://www.bilibili.com/', Cookie: cookieHeader, 'User-Agent': UA }), credentials: 'include' })
      return await response.json().catch(() => ({}))
    }
    const post = async (route, params = {}) => {
      const url = new URL(route, 'https://api.bilibili.com')
      const body = new URLSearchParams(Object.entries({ ...params, csrf }).map(([k, v]) => [k, String(v)])).toString()
      const response = await ses.fetch(url.toString(), { method: 'POST', headers: new Headers({ Referer: 'https://www.bilibili.com/', Cookie: cookieHeader, 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }), body, credentials: 'include' })
      return await response.json().catch(() => ({}))
    }

    const nav = await get('/x/web-interface/nav')
    const folders = await get('/x/v3/fav/folder/created/list', { up_mid: nav.data.mid, pn: 1, ps: 20 })
    const folder = (folders.data?.list ?? [])[0]
    console.log('[0] 默认收藏夹:', folder.id, 'media_count=', folder.media_count)

    const aid = 114000863954184 // 上一轮误加的视频
    // 尝试多种删除参数组合
    const variants = [
      ['del_media_ids 仅此', { rid: aid, type: 2, add_media_ids: '', del_media_ids: folder.id }],
      ['加 platform=web', { rid: aid, type: 2, add_media_ids: '', del_media_ids: folder.id, platform: 'web' }],
      ['加 eab_x=1', { rid: aid, type: 2, add_media_ids: '', del_media_ids: folder.id, eab_x: 1 }],
      ['使用 resources 格式', { rid: String(aid), type: 2, add_media_ids: '', del_media_ids: folder.id, resources: `${aid}:2` }],
    ]
    for (const [label, params] of variants) {
      const result = await post('/x/v3/fav/resource/deal', params)
      await new Promise(r => setTimeout(r, 1200))
      const list = await get('/x/v3/fav/resource/list', { media_id: folder.id, pn: 1, ps: 20, platform: 'web' })
      const still = (list.data?.medias ?? []).some(m => String(m.id) === String(aid))
      console.log(`[${label}] code=${result.code} msg=${result.message} data=${JSON.stringify(result.data)} 仍存在=${still} media_count=${list.data?.info?.media_count}`)
      if (!still) { console.log('  → 删除成功'); break }
    }

    // 备选：旧的 v2 批量接口
    const legacy = await post('/x/v2/fav/video/del', { aid, csrf })
    console.log('[备选 v2/fav/video/del]', JSON.stringify(legacy).slice(0, 200))
    await new Promise(r => setTimeout(r, 1200))
    const final = await get('/x/v3/fav/resource/list', { media_id: folder.id, pn: 1, ps: 20, platform: 'web' })
    console.log('[最终] media_count=', final.data?.info?.media_count, '测试视频仍在=', (final.data?.medias ?? []).some(m => String(m.id) === String(aid)))
  } catch (error) {
    console.error('验证失败:', error.message)
  } finally {
    app.quit()
  }
})
