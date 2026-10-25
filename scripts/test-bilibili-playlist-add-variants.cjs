// 逆向验证（B站第二轮）：success_num=0 原因排查。
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
    const mid = nav.data?.mid
    const folders = await get('/x/v3/fav/folder/created/list', { up_mid: mid, pn: 1, ps: 20 })
    const folder = (folders.data?.list ?? [])[0]
    console.log('[0] 收藏夹:', folder?.id, folder?.title, 'media_count=', folder?.media_count)

    // 拿几个不同类型的视频
    const search = await get('/x/web-interface/search/type', { search_type: 'video', keyword: '音乐', page: 1, page_size: 5 })
    const videos = (search.data?.result ?? []).slice(0, 4)
    for (const v of videos) {
      console.log('[候选]', v.bvid, 'aid=', v.aid, 'type=', v.type, v.type_name ?? '', 'title=', String(v.title ?? '').replace(/<[^>]*>/g, '').slice(0, 30))
    }

    for (const v of videos) {
      const clip = String(v.title ?? '').replace(/<[^>]*>/g, '').slice(0, 20)
      // 变体1：原样
      const a = await post('/x/v3/fav/resource/deal', { rid: v.aid, type: 2, add_media_ids: folder.id, del_media_ids: '', csrf })
      const listA = await get('/x/v3/fav/resource/list', { media_id: folder.id, pn: 1, ps: 5, platform: 'web' })
      const okA = (listA.data?.medias ?? []).some(m => String(m.id) === String(v.aid))
      console.log(`[${clip}] 变体1 success_num=${a.data?.success_num} 实际收藏=${okA}`)
      if (okA) {
        // 清理
        await post('/x/v3/fav/resource/deal', { rid: v.aid, type: 2, add_media_ids: '', del_media_ids: folder.id, csrf })
        console.log('  → 成功，已清理。停止排查。')
        break
      }
      // 变体2：带 platform & eab_x
      const b = await post('/x/v3/fav/resource/deal', { rid: v.aid, type: 2, add_media_ids: folder.id, del_media_ids: '', csrf, platform: 'web', eab_x: 1 })
      const listB = await get('/x/v3/fav/resource/list', { media_id: folder.id, pn: 1, ps: 5, platform: 'web' })
      const okB = (listB.data?.medias ?? []).some(m => String(m.id) === String(v.aid))
      console.log(`[${clip}] 变体2(platform/eab_x) success_num=${b.data?.success_num} 实际收藏=${okB}`)
      if (okB) {
        await post('/x/v3/fav/resource/deal', { rid: v.aid, type: 2, add_media_ids: '', del_media_ids: folder.id, csrf })
        console.log('  → 成功，已清理。停止排查。')
        break
      }
    }

    // 额外：读取默认收藏夹内容，验证 list 接口本身能用
    const list = await get('/x/v3/fav/resource/list', { media_id: folder.id, pn: 1, ps: 5, platform: 'web' })
    console.log('[现有默认夹] media_count=', list.data?.info?.media_count, '前几条=', (list.data?.medias ?? []).map(m => `${m.id}:${String(m.title).slice(0, 12)}`).join(' | '))
  } catch (error) {
    console.error('验证失败:', error.message)
  } finally {
    app.quit()
  }
})
