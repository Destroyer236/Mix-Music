/* 收藏歌单可读性：收藏的他人歌单不属于当前账号，但必须能正常读取曲目。

   历史缺陷（两处，现象都是「收藏歌单打不开」）：
   1. 网易云把 creator.userId 当作归属校验，而收藏歌单的 creator 是原作者，
      导致所有收藏歌单直接报「歌单不属于当前网易云账号」。
   2. 酷狗概念版用收藏副本的 listid 调 cloudlist，服务端稳定返回空列表；
      必须改用 pubsongs 公开接口 + 原歌单的 global_collection_id。

   这里用假的 session 覆盖两条真实分支，不联网。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

function load(relative, dependencies = {}) {
  const file = path.join(root, relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('@common/')) return load(`src/common/${name.slice(8)}.ts`)
    return nativeRequire(name)
  }
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file)
  return instance.exports
}

const json = body => ({ ok: true, status: 200, json: async() => body })
const context = (routes, cookies = {}) => {
  const calls = []
  return {
    calls,
    session: {
      fetch: async(url, init = {}) => {
        const target = String(url)
        calls.push({ url: target, method: init.method ?? 'GET' })
        for (const [match, respond] of routes) if (target.includes(match)) return json(respond(target, init))
        throw new Error(`未预期的请求: ${target}`)
      },
    },
    cookies: async() => cookies,
  }
}

async function main() {
/* ---------- 网易云：收藏歌单的 creator 是原作者 ---------- */

const netease = load('src/main/modules/platformAccounts/providers/netease.ts').neteaseProvider
const profile = { id: '17572278443', nickname: 'Atlantic-W', avatar: '' }

const neteaseSong = (id) => ({ id, name: `song-${id}`, ar: [{ name: '歌手' }], al: { name: '专辑' }, dt: 200000 })
const detail = (subscribed, creatorId, ids) => ({ code: 200, playlist: { subscribed, creator: { userId: creatorId }, trackIds: ids.map(id => ({ id })), trackCount: ids.length } })

// 收藏的他人歌单：subscribed=1，creator 不是本人 → 必须能读。
{
  const ids = [11, 22, 33]
  const ctx = context([
    ['/weapi/v6/playlist/detail', () => detail(true, 2020860850, ids)],
    ['/weapi/v3/song/detail', () => ({ code: 200, songs: ids.map(neteaseSong), privileges: ids.map(id => ({ id })) })],
  ])
  const tracks = await netease.playlistTracks(ctx, profile, { remoteId: '13042940643', platform: 'netease', ownerId: profile.id, collected: true })
  assert.equal(tracks.length, 3, '收藏歌单应返回全部曲目')
  assert.deepEqual(tracks.map(track => track.id), ids.map(id => `wy_${id}`))
  assert.ok(ctx.calls.some(call => call.url.includes('v6/playlist/detail')), '应读取歌单详情')
}

// 自己创建的歌单：creator 是本人 → 正常读取。
{
  const ctx = context([
    ['/weapi/v6/playlist/detail', () => detail(false, Number(profile.id), [7])],
    ['/weapi/v3/song/detail', () => ({ code: 200, songs: [neteaseSong(7)], privileges: [{ id: 7 }] })],
  ])
  const tracks = await netease.playlistTracks(ctx, profile, { remoteId: '1', platform: 'netease', ownerId: profile.id })
  assert.deepEqual(tracks.map(track => track.id), ['wy_7'], '自建歌单仍可读取')
}

// 既不是本人创建、也没有订阅 → 仍然是明确的错误，不能静默放行。
{
  const ctx = context([
    ['/weapi/v6/playlist/detail', () => detail(false, 123456, [1])],
  ])
  await assert.rejects(
    () => netease.playlistTracks(ctx, profile, { remoteId: '2', platform: 'netease', ownerId: profile.id }),
    /歌单不属于当前网易云账号/,
    '无关歌单仍应拒绝',
  )
}

console.log('collected netease playlist: OK')

/* ---------- 酷狗概念版：收藏歌单必须走 pubsongs + 原歌单 gid ---------- */

const concept = load('src/main/modules/platformAccounts/providers/kugouConcept.ts')
const creds = {
  // 设备与登录凭据都从 cookie 读，避免测试触发设备注册。
  linkline_kugou_guid: 'test-guid',
  linkline_kugou_mid: '1234567890',
  linkline_kugou_dfid: 'test-dfid',
  linkline_kugou_dev: 'ABCDEFGHIJ',
  linkline_kugou_token: 'test-token',
  linkline_kugou_userid: '2500426482',
}
const conceptContext = (routes) => context(routes, creds)

// 收藏歌单：必须用原歌单 global_collection_id，且走 pubsongs 的 GET。
{
  const songs = [
    { hash: 'HASH-A', name: '142 - God killer', singerinfo: [{ name: '142' }], timelen: 130115, album_id: '71870852', mixsongid: 505289244, albuminfo: { name: 'God killer' } },
    { hash: 'HASH-B', name: '第二首', singerinfo: [{ name: '歌手B' }], timelen: 60000, album_id: '1', mixsongid: 2, albuminfo: { name: '专辑B' } },
  ]
  const ctx = conceptContext([
    ['/pubsongs/v2/get_other_list_file_nofilt', () => ({ status: 1, data: { count: songs.length, songs } })],
  ])
  const result = await concept.playlistTracks(ctx, '23', { collected: true, collectionId: 'collection_3_1450774758_205_0' })
  assert.equal(result.length, 2, '收藏歌单应读到原歌单曲目')
  const call = ctx.calls.find(item => item.url.includes('pubsongs'))
  assert.ok(call, '收藏歌单应走 pubsongs 接口')
  assert.equal(call.method, 'GET', 'pubsongs 必须是 GET，POST 会失败')
  assert.ok(call.url.includes(encodeURIComponent('collection_3_1450774758_205_0')), '应使用原歌单的集合 id')
  assert.ok(!call.url.includes('title=collection_3_2500426482_23_0'), '不能用收藏副本的集合 id')
}

// 自建歌单：保持原路径（cloudlist），不能因为改动而回归。
{
  const ctx = conceptContext([
    ['/v4/get_list_all_file_v3', () => ({ status: 1, data: { count: 1, info: [{ hash: 'OWN-A', name: '自建曲目', singerinfo: [{ name: '歌手C' }], timelen: 1000, album_id: '2', mixsongid: 3 }] } })],
  ])
  const result = await concept.playlistTracks(ctx, '5', { collected: false })
  assert.equal(result.length, 1, '自建歌单仍走 cloudlist')
  assert.ok(ctx.calls.every(item => !item.url.includes('pubsongs')), '自建歌单不应走 pubsongs')
}

// 收藏歌单缺少原集合 id 时应给出可操作错误，而不是返回空列表。
{
  const ctx = conceptContext([])
  await assert.rejects(
    () => concept.playlistTracks(ctx, '23', { collected: true }),
    /缺少原歌单标识/,
    '缺少集合 id 应显式报错',
  )
}

console.log('collected kugou concept playlist: OK')

}

main().catch(error => { console.error(error); process.exit(1) })
