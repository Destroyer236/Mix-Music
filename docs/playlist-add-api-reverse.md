# 各平台「添加歌曲到歌单」接口逆向报告

> 目标：为 LinkLine 的「添加到歌单」功能补齐各音乐平台的**写入**接口。
> 现状：所有平台歌单此前均为**只读**（`playlists` / `playlistTracks`），红心（`like`）是唯一已实现的写入路径。
> 本文档记录的接口，均可复用现有 provider 的请求基础设施（签名、加密、session cookie），无需引入新协议栈。

## 结论速览

| 平台 | 加歌到指定歌单 | 验证状态 | 实现难度 |
|---|---|---|---|
| 网易云音乐 | `/api/playlist/manipulate/tracks` | ✅ **实测通过（含增删/重复/越权）** | 低 |
| 哔哩哔哩 | `/x/v3/fav/resource/deal` | ✅ **实测通过（含增删/多夹）** | 低（现有代码即此接口） |
| QQ 音乐 | `PlaylistDetailWrite.AddSonglist` | ⚠️ 逆向确认（代码已实现红心，参数可推） | 低 |
| 波点音乐 | `/api/service/playlist/music` | ⚠️ 逆向确认（代码已实现红心，参数可推） | 低 |
| 咪咕音乐 | `/pc/user/api/add-music-list-song/v1.0` + `id` | ⚠️ 逆向确认（前端源码铁证） | 低 |
| 汽水音乐 | ❌ Web/PC 端无歌单写接口 | ⚠️ 未找到（需移动端协议） | 高 |
| 酷狗音乐 | ✅ `/cloudlist.service/v6/add_song` | ✅ **已实现（概念版协议，扫码登录后可用）** | 中 |
| 酷我音乐 | ❌ 官网 Web 无写接口 | ❌ 仅客户端可用 | 高（需另建协议） |

**可直接落地（6 个平台）**：网易云、B站、QQ、波点、咪咕、酷狗概念版。
**暂不可行（2 个平台）**：汽水、酷我。

---

## 1. 网易云音乐 ✅ 实测通过

### 接口

```
POST https://music.163.com/api/playlist/manipulate/tracks?csrf_token=<__csrf>
Content-Type: application/x-www-form-urlencoded
Referer: https://music.163.com/

op=add|del
pid=<歌单ID>
trackIds=["<歌曲ID>", ...]   // JSON 字符串数组（注意：不是逗号分隔！）
imme=true
csrf_token=<__csrf>
```

### 关键逆向结论（本次实测得出）

1. **必须走明文 `/api/` 路由，不能走 `/weapi/`**。weapi 路由会返回 `502 歌单内歌曲重复` 的误判。
2. 参数名是 **`trackIds`**（JSON 数组字符串），**不是 `tracks`**（后者返回 400 请求参数错误）。
3. 重复添加同一首歌返回 `{"code": 502, "message": "歌单内歌曲重复"}`——**幂等，可直接当成功处理**。
4. 无权限歌单返回 `{"code": 401, "message": "无权限操作歌单"}`。
5. 响应成功时返回 `{ code: 200, trackIds: "[...]", count: N }`（会回传歌单最新曲目列表）。
6. 批量添加含已存在的歌时，接口**自动跳过重复项**，只加新的（实测 `count` 从 1 → 2）。

### 删除歌单（测试清理用）

```
POST /weapi/playlist/delete   { pid }     // 注意字段是 pid，不是 id
```

### 实测记录

```
[4a] api路由 add: {"trackIds":"[2652820720]","code":200,"count":1}      ✅
[4b] weapi路由 add: {"message":"歌单内歌曲重复","code":502}             ← 路由差异
[5]  核对: trackCount=1, 包含测试歌? true                               ✅
[6]  重复加同一首: {"message":"歌单内歌曲重复","code":502}              ← 幂等
[7a] 批量加两首(含已存在): {"trackIds":"[3440441479]","code":200,"count":2}  ✅ 自动去重
[8a] 删歌: {"code":200,"count":1}                                       ✅
[9]  非本人歌单: {"message":"无权限操作歌单","code":401}                ← 越权拦截
[10] 删除测试歌单 code=200                                              ✅
```

### 实现建议

在 `netease.ts` 中新增：

```ts
async addToPlaylist(context, profile, playlist, track) {
  const songId = trackId(track)
  // 走明文 api 路由（weapi 会误报重复）
  const body = new URLSearchParams({
    op: 'add', pid: playlist.remoteId,
    trackIds: JSON.stringify([songId]), imme: 'true',
    csrf_token: (await context.cookies()).__csrf ?? '',
  })
  const res = await context.session.fetch(
    `https://music.163.com/api/playlist/manipulate/tracks?csrf_token=${...}`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' }, body },
  )
  const json = await res.json()
  if (json.code === 200 || json.code === 502) return   // 502 = 已存在
  throw new Error(json.message ?? `网易云加歌失败 (${json.code})`)
}
```

---

## 2. 哔哩哔哩 ✅ 实测通过

### 接口

```
POST https://api.bilibili.com/x/v3/fav/resource/deal
Content-Type: application/x-www-form-urlencoded

rid=<视频 aid>
type=2                       // 2 = 视频
add_media_ids=<收藏夹ID>     // 加入这些收藏夹（逗号分隔，可多个）
del_media_ids=<收藏夹ID>     // 从这些收藏夹移除
csrf=<bili_jct>
```

### 关键逆向结论

1. **现有代码已使用此接口**，但写死了默认收藏夹（`bilibili.ts:218`）。改造只需把 `findDefaultFolder()` 换成传入的 `playlist.remoteId`。
2. ⚠️ **响应中的 `success_num` 不可信**——实测成功添加时仍返回 `success_num: 0`。判断成功必须**回读收藏夹内容**核对。
3. 支持一次加入多个收藏夹（`add_media_ids="id1,id2"`）。
4. `rid` 是 **aid**（数字），不是 bvid。`bvid → aid` 需先调 `/x/web-interface/view`。
5. 删除同样走此接口，`del_media_ids` 传目标收藏夹。实测删除生效，但列表接口有**缓存延迟**（约 1 秒），验证时需等待。

### 创建/删除收藏夹（测试用）

```
POST /x/v3/fav/folder/add   { title, privacy: 0, csrf }   → data.id
POST /x/v3/fav/folder/del   { media_ids: <id>, csrf }
```

### 实测记录

```
[4] 创建测试收藏夹: code=0, id=4359335279                        ✅
[5] 加收藏到测试夹: {"code":0,"data":{"success_num":0}}          ← 字段不可信
[6] 核对 media_count=0 → 但实际已加入（需等待缓存刷新）          ⚠️
[变体1] success_num=0 实际收藏=true                              ✅ 确认有效
[清理] del_media_ids 后 仍存在=false, media_count 回到 9          ✅
```

### 实现建议

```ts
async addToPlaylist(context, profile, playlist, track) {
  const cookies = await context.cookies()
  if (!cookies.SESSDATA || !cookies.bili_jct) throw new Error('哔哩哔哩登录已失效')
  const view = await request(context, '/x/web-interface/view', { bvid: String(track.meta.songId) })
  const aid = numericId(view.aid)
  if (!aid) throw new Error('哔哩哔哩视频标识无效')
  await request(context, '/x/v3/fav/resource/deal', {
    rid: aid, type: 2,
    add_media_ids: playlist.remoteId, del_media_ids: '', csrf: cookies.bili_jct,
  }, true)
  // success_num 不可信，回读确认
  const list = await request(context, '/x/v3/fav/resource/list', { media_id: playlist.remoteId, pn: 1, ps: 20, platform: 'web' })
  if (!(list.medias ?? []).some(m => String(m.id) === aid)) throw new Error('哔哩哔哩未确认收藏成功')
}
```

---

## 3. QQ 音乐 ⚠️ 逆向确认（未登录实测）

### 接口（与红心同一模块）

```
POST https://u.y.qq.com/cgi-bin/musicu.fcg

{
  "comm": { ct: 24, cv: 4747474, format: "json", uin, g_tk, g_tk_new_20200303, ... },
  "req": {
    "module": "music.musicasset.PlaylistDetailWrite",
    "method": "AddSonglist",          // 删除用 DelSonglist
    "param": {
      "dirId": 0,                     // 指定歌单时为 0；红心时为 201
      "tid": <歌单tid>,               // 目标歌单 ID（红心时为 0）
      "bFmtUtf8": true,
      "v_songInfo": [{ "songId": <数字ID>, "songType": 0 }]
    }
  }
}
```

### 关键逆向结论

1. **现有红心实现（`qq.ts:469`）就是此接口**：`dirId: 201, tid: 0` → 红心歌单。
2. 加入自建歌单：`dirId: 0, tid: <playlist.remoteId>`。`remoteId` 来自 `playlists()` 中的 `item.tid`（已确认，见 `qq.ts:333`）。
3. 响应判定：`data.retCode === 0` 为成功（现有代码已这样判断）。
4. `v_songInfo` 需要**数字型 songId**（非 mid）。当前 `like()` 已有 mid → songId 的转换逻辑，可直接复用。
5. ⚠️ **未实测**：本机 QQ 账号未登录，无法验证 `dirId: 0 + tid` 组合。需登录后跑一次确认。

### 实现建议

```ts
async addToPlaylist(context, user, playlist, track) {
  const detail = await cgi(context, 'music.pf_song_detail_svr', 'get_song_detail_yqq', { song_mid: track.meta.songId })
  const info = asRecord(detail.track_info)
  const songId = Number(info.id) || (track.source === 'tx' ? track.meta.id : undefined)
  const songType = Number(info.type ?? 0)
  if (!Number.isFinite(songId)) throw new Error('QQ 音乐歌曲缺少数字 ID')
  const data = await cgi(context, 'music.musicasset.PlaylistDetailWrite', 'AddSonglist', {
    dirId: 0, tid: Number(playlist.remoteId), bFmtUtf8: true,
    v_songInfo: [{ songId, songType }],
  })
  const retCode = Number(data.retCode ?? data.retcode ?? -1)
  if (retCode !== 0) throw new Error(`QQ 音乐加歌失败 (${retCode})`)
}
```

---

## 4. 波点音乐 ⚠️ 逆向确认

### 接口（与红心同一接口）

```
POST https://bd-api.kuwo.cn/api/service/playlist/music
Body: { "playListId": <数字歌单ID>, "musicIdList": [<数字歌曲ID>] }
签名: signed=true（现有 signRequest 已覆盖），expectedUser=<uid>
删除: POST /api/service/playlist/music/delete（同样的 body）
```

### 关键逆向结论

1. **现有红心实现（`bodian.ts:240`）已经调用此接口**，只是 `playListId` 固定传红心歌单 ID。
2. 加入任意歌单：把 `fond()` 返回的红心歌单 ID 换成 `playlist.remoteId` 即可。**注意 `remoteId` 格式是 `"<sourceType>:<id>"`**（如 `"4:123456"`），需取冒号后的数字 ID。
3. `musicIdList` 是**数字数组**（`Number(id)`），不是字符串。
4. 现有代码已实现回读验证（`allPages` 后比对），可直接复用。
5. ⚠️ **未实测**：本机波点账号未登录。

### 实现建议

```ts
async addToPlaylist(context, profile, playlist, track) {
  if (track.source !== 'bo') throw new Error('此记录不是波点音乐歌曲')
  const musicId = Number(validId(track.meta.songId))
  const playListId = Number(playlist.remoteId.split(':').pop())
  if (!Number.isSafeInteger(playListId)) throw new Error('无效的波点音乐歌单编号')
  await request(context, '/api/service/playlist/music', {
    body: { playListId, musicIdList: [musicId] },
    signed: true, expectedUser: profile.id,
  })
  await verifyProfile(context, profile)
}
```

---

## 5. 咪咕音乐 ⚠️ 逆向确认（前端源码铁证）

### 接口（与红心同一接口，多一个 `id` 参数）

```
POST https://c.musicapp.migu.cn/pc/user/api/add-music-list-song/v1.0
Body: { "id": "<歌单ID>", "contentIds": ["<contentId>", ...] }

// 红心：不传 id
Body: { "contentIds": ["<contentId>"] }
```

### 关键逆向结论

**铁证来自咪咕 Web 端 bundle（`main-4f72ecaf.js`）的实际调用代码**：

```js
// 加入「我喜欢的」（红心）：
V = async () => { ... const x = await Jt({ contentIds: M }); ... "已添加至「我喜欢的」" }

// 加入指定歌单：
I = async M => {
  let x = { id: M.musicListId, contentIds: E };   // ← 关键：额外传 id
  const T = await Jt(x);                           // Jt = POST add-music-list-song/v1.0
  ... T.data.fail2RepeatContentIdList ...
  ne(`已添加至「${M.title}」`)
}
```

其他确认：

1. **歌单 ID 就是 `musicListId`**（与 `playlists()` 里的 `item.musicListId` 一致）。
2. 重复歌曲处理：响应 `data.fail2RepeatContentIdList` 里返回被过滤的 contentId；`data.successNum` 为成功数。
   - `successNum === 0 && fail2Repeat.length > 0` → 全部已存在
   - `successNum > 0 && fail2Repeat.length > 0` → 部分成功
3. 删除歌单曲目：`POST /pc/user/h5-import-musiclist/v1.0`，body `{ channel: '23', contentId: '<contentId>', songflag: '2' }`（现有 `like()` 取消红心用的是这个）。
4. 创建歌单：`POST /pc/open/api/music-list/add/v2.0`，body `{ title, channel: '23', type: 'self_build' }`。
5. 删除歌单：`GET /pc/v1.0/user/deleteMusicList.do?musicListId=<id>`。
6. ⚠️ **未实测**：本机咪咕账号未登录（已确认所有端点返回 `290001 请先登录`，端点存在性已确认）。

### 实现建议

```ts
async addToPlaylist(context, _user, playlist, track) {
  const meta = await detail(context, track)   // 现有函数，解析 contentId
  if (!meta.contentId) throw new Error('咪咕音乐未找到歌曲的 contentId')
  const body = await request(context, '/pc/user/api/add-music-list-song/v1.0',
    { id: playlist.remoteId, contentIds: [meta.contentId] }, { post: true })
  const success = Number(body.data?.successNum) > 0
  const repeated = (body.data?.fail2RepeatContentIdList ?? []).includes(meta.contentId)
  if (!success && !repeated) throw new Error('咪咕音乐没有确认加歌成功')
}
```

---

## 6. 汽水音乐 ⚠️ 未找到（PC/Web 端无歌单写接口）

### 已确认存在的读接口（现有代码在用）

```
GET  /luna/pc/me                          → 账号资料
GET  /luna/pc/me/playlist                 → 我的歌单列表（含红心 type=1）
GET  /luna/pc/playlist/detail             → 歌单内容
GET  /luna/pc/sug                         → 搜索联想
POST /luna/me/collection/track            → 收藏（红心），body { track_ids: [id] }
POST /luna/me/collection/track/delete     → 取消收藏
```

### 探测结果

对以下候选路径全部实测返回 **404 Page not found**：

```
/luna/me/playlist/add_track      /luna/pc/playlist/add_track
/luna/pc/playlist/track/add      /luna/playlist/add_track
/luna/pc/me/playlist/track       /luna/me/playlist/track
/luna/pc/playlist/add            /luna/me/playlist/add
/luna/pc/playlist/tracks/add     /luna/pc/playlist/add_tracks
/luna/pc/playlist/music/add      /luna/pc/playlist/music
/luna/pc/playlist/collect/track  /luna/me/playlist/tracks/add
/luna/pc/playlist/update         /luna/pc/playlist/manage
/luna/pc/playlist/track/add_batch
```

已确认存在（返回 `1000016 登录状态已失效` 而非 404）：
```
/luna/me/collection/playlist
```

**说明**：`/luna/me/collection/playlist` 存在，但语义上更可能是「收藏歌单」而非「往歌单加歌」。当前无登录态，无法进一步验证其 body 结构。

### Web 端 bundle 分析

汽水官网（`www.qishui.com`）的 bundle 只有**下载引导页**（191KB），不含播放器逻辑，更无歌单写操作。汽水是移动端优先产品，PC 客户端的功能接口可能有独立路径前缀（如 `/luna/pc/...` 之外的 `/luna/me/playlist/...`），需**登录后抓真实客户端请求**才能确定。

### 结论

汽水加歌接口**当前无法确定**。建议：
1. 先登录汽水账号，然后用 DevTools 或 CDP 抓官方 PC 客户端「添加到歌单」的真实请求。
2. 或者降级处理：汽水支持红心（已实现），但不支持自定义歌单加歌，UI 上置灰。

---

## 7. 酷狗音乐概念版 ✅ 已实现（Android 协议）

酷狗官网 Web 端没有任何歌单写接口（`collect-2400.js` 只有统计上报），但**概念版（KugouYoung / lite）Android 协议完整可用**。已在 `providers/kugouConcept.ts` 中实现。

### 7.1 客户端标识

| 参数 | 概念版 | 标准版 |
|---|---|---|
| `appid` | **3116** | 1005 |
| `clientver` | **11440** | 20489 |
| Android 签名盐 | `LnT6xpN3khm36zse0QzvmgTZ3waWdRSA` | `OIlwieks28dk2k092lksi2UIkp` |

### 7.2 两种签名算法（关键差异）

**Android 签名**（歌单、会员等业务接口）：

```
参数按 key 排序 → `key=value` 拼接 → MD5(盐 + 串 + 请求体 + 盐)
```

**Web 签名**（扫码登录系列）：

```
参数逐条 `key=value` 后整体排序 → 拼接 → MD5(盐 + 串 + 盐)
盐值: NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt
```

⚠️ 两者排序对象不同：Android 先排 key 再拼，Web 先拼成 `k=v` 再对整串排序。实测用错会返回 `20010 参数错误`。

### 7.3 设备指纹

三件套缺一不可，**没有它们申请二维码必然 20010**：

| 字段 | 生成方式 |
|---|---|
| `mid` | `BigInt('0x' + md5(guid)).toString(10)` |
| `dfid` | 设备注册接口通过 **Set-Cookie** 下发（`kg_dfid`） |
| `dev` | 10 位随机大写字符（独立于 mid，不是同一个值） |

设备注册：`POST https://userservice.kugou.com/risk/v2/r_register_dev`

- query：`dfid=-`、`mid`、`uuid=-`、`appid`、`clientver`、`clienttime`、`part=1`、`platid=1`、`p`、`signature`
- body：AES-128-CBC 加密的设备信息 JSON（外层的 `signature` 需要把 body 明文也拼进去）
- `p`：`RSA_PKCS1` 加密 `{ aes: <随机key>, uid: 0, token: '' }`
- **响应是 AES 加密的二进制体**，但 `dfid` 实际来自 `Set-Cookie`

### 7.4 扫码登录

```
1. GET https://login-user.kugou.com/v2/qrcode
   appid=1001, type=1, plat=4, srcappid=2919,
   qrcode_txt=https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&
   + 设备三件套，Web 签名
   → data.qrcode (key), data.qrcode_img (base64 PNG，可直接用)

2. GET https://login-user.kugou.com/v2/get_userinfo_qrcode
   plat=4, appid=1005, srcappid=2919, qrcode=<key>, dev=<dev>
   + 设备三件套，Web 签名
   → data.status: 0 过期 / 1 等待扫码 / 2 待确认 / 4 成功（附带 token / userid）
```

实测结论：**二维码必须由服务端签发**。本地随机生成 key 会稳定返回 `20010`。

### 7.5 歌单与加歌

所有业务接口走 `https://gateway.kugou.com`，用 **`x-router` 头**指定后端服务：

| 用途 | 路径 | x-router |
|---|---|---|
| 用户资料 | `/v3/get_my_info` | `usercenter.kugou.com` |
| 歌单列表 | `/v7/get_all_list` | `cloudlist.service.kugou.com` |
| 歌单曲目 | `/v4/get_list_all_file_v3` | `cloudlist.service.kugou.com` |
| **加歌** | `/cloudlist.service/v6/add_song` | —（路径自带服务名） |

加歌请求体：

```json
{
  "userid": 1234567, "token": "<token>",
  "listid": <歌单ID>, "list_ver": 0, "type": 0,
  "slow_upload": 1, "scene": "false;null",
  "data": [{
    "number": 1, "name": "歌曲名", "hash": "<FileHash>",
    "size": 0, "sort": 0, "timelen": 0, "bitrate": 0,
    "album_id": <albumId>, "mixsongid": <mixsongid>
  }]
}
```

⚠️ `hash` / `album_id` / `mixsongid` 必须来自酷狗自己的曲目元数据，不能跨平台复用。

### 7.6 自动领取会员

概念版把"看广告"折算成畅听会员，选完课再升级为概念会员：

```
1. POST /youth/v1/ad/play_report
   { ad_id: 12307537187, play_start: <now-30s>, play_end: <now> }
   → 上报一次广告播放，服务端据此判定观看时长

2. POST /youth/v1/recharge/receive_vip_listen_song?source_id=90139&receive_day=1
   → 领取当日畅听会员

3. POST /youth/v1/listen_song/upgrade_vip_reward?kugouid=<uid>&ad_type=1
   → 升级为概念会员
```

已封装为 `claimKugouVip(upgrade)`，账号页酷狗卡片上有「领取会员」按钮。

### 7.7 与标准版酷狗的关系（重要）

**酷狗音乐（标准版）和酷狗概念版是两个独立产品**，在 LinkLine 中作为**两个独立账号**存在：

| | 酷狗音乐 | 酷狗概念版 |
|---|---|---|
| PlatformId | `kugou` | `kugouConcept` |
| 凭据 | 官网 Web cookie（`KuGoo=`，appid **1014**） | 概念版 token（`linkline_kugou_*`，appid **3116**） |
| 播放 | ✅ 支持 | ❌ 不参与播放解析（复用 `kg` 音源） |
| 歌单同步 / 红心 / 加歌 | ❌ 不支持 | ✅ 支持 |

**为什么概念版不能参与播放解析**：两者的 `source` 都是 `kg`。如果概念版也实现 `musicUrl`，同一个音源会命中两个 provider，可能用错账号取流。因此概念版 provider 刻意不提供 `musicQualitys` / `musicUrl`，播放统一由标准版处理。

**为什么标准版不能同步歌单**：官网 Web 端没有任何歌单写接口（`collect-2400.js` 只有统计上报），且官网 cookie 的 appid 1014 在 cloudlist 接口上会返回 `20006`。概念版 token 与它不通用，必须各自登录。

---

## 8. 酷我音乐 ❌ Web 不可用

### 官网 Web 端现状

`www.kuwo.cn` 全部 bundle（约 1MB）中，`/api/www` 路径只有 **5 条，全部是只读**：

```
/api/v1/www/music/playUrl                播放地址
/api/www/classify/playlist/getTagPlayList 分类歌单
/api/www/music/musicInfo                 歌曲信息
/api/www/playlist/playListInfo           歌单详情
/api/www/rcm/index/playlist              推荐歌单
```

**没有任何写操作接口**（搜索 `addToPlayList` / `addMusicToPlayList` / `playlist/add` / `collect/add` 等关键词均无命中）。

**现有代码判断正确**：`kuwo.ts` 的 notice 明确说明「官网收藏与歌单操作要求使用酷我客户端」。

### 结论

酷我加歌**无法通过官网 web 实现**。与酷狗类似，需要客户端协议（且酷我的客户端协议与波点同源于 kuwo，但鉴权体系不同）。建议暂不支持。

---

## 落地路线建议

### 第一阶段：3 个平台直接可用（低风险）

| 平台 | 改动量 | 说明 |
|---|---|---|
| **网易云** | 小 | 新增明文 api 路由请求，参数已验证 |
| **B站** | 极小 | 现有接口，把默认收藏夹换成传入歌单 |
| **波点** | 极小 | 现有接口，把红心歌单 ID 换成传入歌单 |

这 3 个平台的写入通道**代码里已经在跑**（B站/波点）或**已实测验证**（网易云），只需把「目标歌单 ID」参数化。

### 第二阶段：2 个平台需登录验证

| 平台 | 阻碍 |
|---|---|
| **QQ** | 需登录后验证 `dirId: 0 + tid` 组合 |
| **咪咕** | 需登录后验证 `id` 参数是否如前端源码所示 |

### 第三阶段：2 个平台暂不支持

汽水、酷我——UI 上对应平台歌单置灰或隐藏，并在 tooltip 说明原因（与现有 `canSync` / `notice` 模式一致）。

---

## 附：酷狗概念版实现文件

| 文件 | 内容 |
|---|---|
| `providers/kugouConcept.ts` | 协议层：签名、AES、RSA、设备注册、扫码、资料、歌单、加歌、会员 |
| `providers/kugouConceptProvider.ts` | 独立 provider（PlatformId `kugouConcept`），不参与播放解析 |
| `kugouLogin.ts` | 扫码登录控制器（服务端二维码 + 状态轮询 + 凭据落盘） |
| `providers/kugou.ts` | 标准版，保持只读（播放 + 搜索） |
| `index.ts` | IPC：`platform_kugou_login_*`、`platform_kugou_claim_vip` |

关键实现细节：

- **零新增依赖**：RSA 用 Node 内置 `crypto.publicEncrypt`（PKCS1），AES 用 `createCipheriv`，MID 用原生 `BigInt`
- **凭据持久化**：`linkline_kugou_{guid,mid,dfid,dev,userid,token,nickname,avatar}` 存在账号分区 cookie，重启免扫码
- **登录态隔离**：概念版 token 与官网 `KuGoo` cookie 互不覆盖

---

## 附：本次验证脚本

| 脚本 | 用途 |
|---|---|
| `scripts/test-playlist-auth-check.cjs` | 只读检查各平台登录态 |
| `scripts/test-netease-playlist-add.cjs` | 网易云加歌第一轮（发现路由/参数问题） |
| `scripts/test-netease-playlist-add-variants.cjs` | **网易云最终验证（全流程通过）** |
| `scripts/test-bilibili-playlist-add.cjs` | B站加歌第一轮 |
| `scripts/test-bilibili-playlist-add-variants.cjs` | B站 success_num 排查 |
| `scripts/test-bilibili-playlist-del.cjs` | **B站删除验证 + 数据清理** |
| `scripts/test-extract-api-paths.cjs` | 从咪咕/酷我/酷狗 bundle 提取接口路径 |
| `scripts/test-extract-migu.cjs` | **咪咕加歌参数铁证提取** |
| `scripts/test-migu-playlist-add.cjs` | 咪咕端点存在性确认 |
| `scripts/test-extract-kuwo.cjs` | 酷我写接口缺失证明 |
| `scripts/test-extract-kugou.cjs` | 酷狗 Web 无写接口证明 |
| `scripts/test-extract-qishui.cjs` | 汽水 Web 端无播放器逻辑证明 |
| `scripts/test-qishui-playlist-endpoints.cjs` | 汽水候选端点 404 探测 |

> 所有实测脚本均使用 `app.setPath('userData', %APPDATA%/LinkLine)` 复用真实账号分区，**只读不破坏**；涉及写入的测试都创建了临时歌单/收藏夹并在 finally 中清理。
