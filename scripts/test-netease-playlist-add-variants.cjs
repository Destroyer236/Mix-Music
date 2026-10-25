// 逆向验证（第三轮）：改用 /api/playlist/manipulate/tracks + trackIds 参数。
const { app, session } = require('electron')
const path = require('node:path')

app.setPath('userData', path.join(process.env.APPDATA, 'LinkLine'))

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:linkline-account-netease')
    const cookies = Object.fromEntries((await ses.cookies.get({ url: 'https://music.163.com/' })).map(c => [c.name, c.value]))
    const csrf = cookies.__csrf ?? ''
    const cryptoMod = require('NeteaseCloudMusicApi/util/crypto')
    const weapi = cryptoMod.weapi ?? cryptoMod.default?.weapi

    // 通用 weapi 请求
    const weapiRequest = async (path, data) => {
      const body = new URLSearchParams(weapi({ ...data, csrf_token: csrf })).toString()
      const response = await ses.fetch(`https://music.163.com/weapi/${path}?csrf_token=${encodeURIComponent(csrf)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
        body,
      })
      return { status: response.status, json: await response.json().catch(() => ({})) }
    }

    // 明文 api 请求（表单）
    const apiRequest = async (path, data) => {
      const body = new URLSearchParams({ ...data, csrf_token: csrf }).toString()
      const response = await ses.fetch(`https://music.163.com/api/${path}?csrf_token=${encodeURIComponent(csrf)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
        body,
      })
      return { status: response.status, json: await response.json().catch(() => ({})) }
    }

    const me = await weapiRequest('nuser/account/get', {})
    console.log('[1] 用户:', me.json.profile?.nickname)

    const search = await weapiRequest('cloudsearch/pc', { s: '晴天 周杰伦', type: 1, limit: 5, offset: 0, total: true })
    const song = search.json.result?.songs?.[0]
    const song2 = search.json.result?.songs?.[1]
    console.log('[2] 测试歌曲:', song?.name, song?.id, '/', song2?.name, song2?.id)

    const created = await weapiRequest('playlist/create', { name: `LinkLine接口验证-${Date.now() % 100000}` })
    const pid = created.json.id
    console.log('[3] 创建测试歌单 id=', pid)

    try {
      const trackIds = (ids) => JSON.stringify(ids.map(String))

      // 4. 明文 api 路由 + trackIds
      const addA = await apiRequest('playlist/manipulate/tracks', { op: 'add', pid, trackIds: trackIds([song.id]), imme: 'true' })
      console.log('[4a] api路由 add:', JSON.stringify(addA.json).slice(0, 200))

      // 5. weapi 路由 + trackIds
      const addB = await weapiRequest('playlist/manipulate/tracks', { op: 'add', pid, trackIds: trackIds([song.id]), imme: 'true' })
      console.log('[4b] weapi路由 add:', JSON.stringify(addB.json).slice(0, 200))

      const detail = await weapiRequest('v6/playlist/detail', { id: pid, n: 1000, s: 0 })
      const ids = (detail.json.playlist?.trackIds ?? []).map(item => item.id)
      console.log('[5] 核对: trackCount=', detail.json.playlist?.trackCount, 'ids=', JSON.stringify(ids), '包含?', ids.includes(song.id))

      // 6. 重复加（观察 512 与去重语义）
      const dup = await apiRequest('playlist/manipulate/tracks', { op: 'add', pid, trackIds: trackIds([song.id]), imme: 'true' })
      console.log('[6] 重复加同一首:', JSON.stringify(dup.json).slice(0, 200))

      // 7. 批量两首
      if (song2) {
        const batch = await apiRequest('playlist/manipulate/tracks', { op: 'add', pid, trackIds: trackIds([song.id, song2.id]), imme: 'true' })
        console.log('[7a] 批量加两首(含已存在):', JSON.stringify(batch.json).slice(0, 200))
        const afterBatch = await weapiRequest('v6/playlist/detail', { id: pid, n: 1000, s: 0 })
        console.log('[7b] 批量后 ids=', JSON.stringify((afterBatch.json.playlist?.trackIds ?? []).map(item => item.id)))

        // 8. 删一首
        const del = await apiRequest('playlist/manipulate/tracks', { op: 'del', pid, trackIds: trackIds([song.id]), imme: 'true' })
        console.log('[8a] 删歌:', JSON.stringify(del.json).slice(0, 200))
        const afterDel = await weapiRequest('v6/playlist/detail', { id: pid, n: 1000, s: 0 })
        console.log('[8b] 删后 ids=', JSON.stringify((afterDel.json.playlist?.trackIds ?? []).map(item => item.id)))
      }

      // 9. 越权：对官方热歌榜加歌
      const foreign = await apiRequest('playlist/manipulate/tracks', { op: 'add', pid: 3778678, trackIds: trackIds([song.id]), imme: 'true' })
      console.log('[9] 非本人歌单加歌:', JSON.stringify(foreign.json).slice(0, 200))
    } finally {
      const removed = await weapiRequest('playlist/delete', { pid })
      console.log('[10] 删除测试歌单 code=', removed.json.code)
    }
  } catch (error) {
    console.error('验证失败:', error.message)
  } finally {
    app.quit()
  }
})
