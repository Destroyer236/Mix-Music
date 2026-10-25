// 逆向验证：网易云「添加歌曲到歌单」接口（weapi/playlist/manipulate/tracks）。
// 流程：建一次性测试歌单 → 搜索取歌曲 ID → 加歌 → 读歌单核对 → 删歌 → 删歌单。
const { app, session } = require('electron')
const path = require('node:path')

app.setPath('userData', path.join(process.env.APPDATA, 'LinkLine'))

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:linkline-account-netease')
    const cookies = Object.fromEntries((await ses.cookies.get({ url: 'https://music.163.com/' })).map(c => [c.name, c.value]))
    if (!cookies.MUSIC_U) throw new Error('网易云未登录')
    const csrf = cookies.__csrf ?? ''

    const cryptoMod = require('NeteaseCloudMusicApi/util/crypto')
    const weapi = cryptoMod.weapi ?? cryptoMod.default?.weapi
    const request = async (path, data) => {
      const body = new URLSearchParams(weapi({ ...data, csrf_token: csrf })).toString()
      const response = await ses.fetch(`https://music.163.com/weapi/${path}?csrf_token=${encodeURIComponent(csrf)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
        body,
      })
      const json = await response.json().catch(() => ({}))
      return { status: response.status, json }
    }

    // 1. 资料与歌单
    const me = await request('nuser/account/get', {})
    const uid = me.json.profile?.userId
    console.log('[1] 登录用户:', me.json.profile?.nickname, 'uid=', uid)

    // 2. 搜索一首已知歌曲
    const search = await request('cloudsearch/pc', { s: '晴天 周杰伦', type: 1, limit: 5, offset: 0, total: true })
    const song = search.json.result?.songs?.[0]
    console.log('[2] 测试歌曲:', song?.name, 'id=', song?.id)

    // 3. 创建一次性测试歌单
    const created = await request('playlist/create', { name: `LinkLine接口验证-${Date.now() % 100000}` })
    console.log('[3] 创建测试歌单: code=', created.json.code, 'id=', created.json.id)
    const pid = created.json.id
    if (!pid) throw new Error('创建歌单失败: ' + JSON.stringify(created.json).slice(0, 200))

    try {
      // 4. 加歌（带上下文参数与不带各试一次）
      const add = await request('playlist/manipulate/tracks', { op: 'add', pid, tracks: String(song.id), noloop: 'false', imme: 'false' })
      console.log('[4] 加歌响应:', JSON.stringify(add.json))

      // 5. 读歌单核对
      const detail = await request('v6/playlist/detail', { id: pid, n: 1000, s: 0 })
      const ids = (detail.json.playlist?.trackIds ?? []).map(item => item.id)
      console.log('[5] 歌单核对: trackCount=', detail.json.playlist?.trackCount, 'trackIds=', JSON.stringify(ids), '包含测试歌?', ids.includes(song.id))

      // 6. 重复加同一首，观察去重响应
      const dup = await request('playlist/manipulate/tracks', { op: 'add', pid, tracks: String(song.id), noloop: 'false', imme: 'false' })
      console.log('[6] 重复加歌响应:', JSON.stringify(dup.json))

      // 7. 批量加第二首 + 删除第一首
      const song2 = search.json.result?.songs?.[1]
      if (song2) {
        const add2 = await request('playlist/manipulate/tracks', { op: 'add', pid, tracks: `${song.id},${song2.id}`, noloop: 'false', imme: 'false' })
        console.log('[7a] 批量加歌(含重复):', JSON.stringify(add2.json))
        const del = await request('playlist/manipulate/tracks', { op: 'del', pid, tracks: String(song.id), noloop: 'false', imme: 'false' })
        console.log('[7b] 删歌响应:', JSON.stringify(del.json))
        const after = await request('v6/playlist/detail', { id: pid, n: 1000, s: 0 })
        console.log('[7c] 删歌后 trackIds=', JSON.stringify((after.json.playlist?.trackIds ?? []).map(item => item.id)))
      }

      // 8. 对别人的歌单加歌（越权验证，预期报错）——用「云音乐热歌榜」pid=3778678
      const foreign = await request('playlist/manipulate/tracks', { op: 'add', pid: 3778678, tracks: String(song.id), noloop: 'false', imme: 'false' })
      console.log('[8] 对非本人歌单加歌: code=', foreign.json.code, 'msg=', foreign.json.message ?? foreign.json.msg)
    } finally {
      // 9. 清理测试歌单
      const removed = await request('playlist/delete', { id: pid })
      console.log('[9] 删除测试歌单: code=', removed.json.code)
    }
  } catch (error) {
    console.error('验证失败:', error.message)
  } finally {
    app.quit()
  }
})
