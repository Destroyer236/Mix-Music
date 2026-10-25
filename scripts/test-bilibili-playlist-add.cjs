// 逆向验证：B站「添加到收藏夹」接口 /x/v3/fav/resource/deal。
// 流程：建测试收藏夹 → 取一个视频 aid → 加收藏 → 读收藏夹核对 → 删收藏 → 删测试收藏夹。
const { app, session } = require('electron')
const path = require('node:path')

app.setPath('userData', path.join(process.env.APPDATA, 'LinkLine'))

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:linkline-account-bilibili')
    const cookies = Object.fromEntries((await ses.cookies.get({ url: 'https://www.bilibili.com/' })).map(c => [c.name, c.value]))
    if (!cookies.SESSDATA) throw new Error('B站未登录')
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
    console.log('[1] 账号:', nav.data?.uname, 'mid=', nav.data?.mid)

    // 2. 现有收藏夹
    const folders = await get('/x/v3/fav/folder/created/list', { up_mid: nav.data.mid, pn: 1, ps: 20 })
    console.log('[2] 现有收藏夹:', (folders.data?.list ?? []).map(f => `${f.id}:${f.title}(默认=${f.is_default})`).join(' | '))
    const defaultFolder = (folders.data?.list ?? []).find(f => f.is_default) ?? folders.data?.list?.[0]

    // 3. 搜索拿一个视频
    const search = await get('/x/web-interface/search/type', { search_type: 'video', keyword: '晴天 周杰伦', page: 1, page_size: 3 })
    const video = (search.data?.result ?? [])[0]
    console.log('[3] 测试视频:', video?.title?.replace(/<[^>]*>/g, ''), 'bvid=', video?.bvid, 'aid=', video?.aid)
    const aid = video?.aid
    if (!aid) throw new Error('搜索无结果')

    // 4. 创建测试收藏夹
    const created = await post('/x/v3/fav/folder/add', { title: `LinkLine接口验证${Date.now() % 100000}`, privacy: 0, csrf })
    const folderId = created.data?.id ?? created.data?.media_id
    console.log('[4] 创建测试收藏夹: code=', created.code, 'msg=', created.message, 'id=', folderId)
    if (!folderId) throw new Error('创建收藏夹失败: ' + JSON.stringify(created).slice(0, 200))

    try {
      // 5. 加收藏到测试收藏夹
      const add = await post('/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: folderId, del_media_ids: '', csrf })
      console.log('[5] 加收藏到测试夹:', JSON.stringify(add).slice(0, 300))

      // 6. 读测试收藏夹核对
      const list = await get('/x/v3/fav/resource/list', { media_id: folderId, pn: 1, ps: 20, platform: 'web' })
      const ids = (list.data?.medias ?? []).map(m => m.id)
      console.log('[6] 核对: media_count=', list.data?.info?.media_count, 'ids=', JSON.stringify(ids), '包含?', ids.includes(aid))

      // 7. 重复收藏同一视频（观察返回码）
      const dup = await post('/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: folderId, del_media_ids: '', csrf })
      console.log('[7] 重复收藏:', JSON.stringify(dup).slice(0, 200))

      // 8. 一次加到两个收藏夹
      const both = await post('/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: `${folderId},${defaultFolder.id}`, del_media_ids: '', csrf })
      console.log('[8] 一次加两个夹:', JSON.stringify(both).slice(0, 250))

      // 9. 从测试夹移除（保留默认夹里的，稍后单独清理，避免污染用户默认收藏夹）
      const del = await post('/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: '', del_media_ids: folderId, csrf })
      console.log('[9] 从测试夹移除:', JSON.stringify(del).slice(0, 200))
      const after = await get('/x/v3/fav/resource/list', { media_id: folderId, pn: 1, ps: 20, platform: 'web' })
      console.log('[9b] 移除后 media_count=', after.data?.info?.media_count)

      // 10. 清理：从默认收藏夹移除刚才误加的
      const delDefault = await post('/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: '', del_media_ids: defaultFolder.id, csrf })
      console.log('[10] 从默认夹清理:', JSON.stringify(delDefault).slice(0, 200))

      // 11. 越权测试：往别人的收藏夹加（用一个公开收藏夹 id）—— 先读一个公开收藏夹
      const publicFolder = (folders.data?.list ?? []).find(f => String(f.mid) !== String(nav.data.mid))
      if (publicFolder) {
        const foreign = await post('/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: publicFolder.id, del_media_ids: '', csrf })
        console.log('[11] 非本人收藏夹:', JSON.stringify(foreign).slice(0, 200))
      } else {
        console.log('[11] 无他人收藏夹可测（列表里全是自己的）')
      }
    } finally {
      // 12. 删除测试收藏夹
      const removed = await post('/x/v3/fav/folder/del', { media_ids: folderId, csrf })
      console.log('[12] 删除测试收藏夹: code=', removed.code, 'msg=', removed.message)
    }
  } catch (error) {
    console.error('验证失败:', error.message)
  } finally {
    app.quit()
  }
})
