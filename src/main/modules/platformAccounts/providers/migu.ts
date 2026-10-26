import type { PlatformPlaylist, PlatformProfile } from '@common/platformAccounts'
import type { PlatformQuality, PlatformStream } from '@common/platformPlayback'
import { legacyQuality } from '@common/platformPlayback'
import { chooseMatch } from '@common/platformMatching'
import { songVip } from '@common/musicAccess'
import type { PlatformProvider, ProviderContext } from './types'

// The current music.migu.cn/v5 web SDK uses these same API paths and
// session headers. The stream endpoint returns the SDK's binary envelope.
const API = 'https://app.c.nf.migu.cn'
const ENVELOPE_KEY = Buffer.from('Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP')
const toneFlags: Partial<Record<PlatformQuality, string>> = { '128k': 'PQ', '320k': 'HQ', flac: 'SQ', flac24bit: 'ZQ', sky: 'Z3D' }
interface MiguMeta extends LX.Music.MusicInfoMeta_mg { upstreamSongId?: string, contentId?: string, resourceType?: string, platformQualitys?: PlatformQuality[], formatResourceTypes?: Partial<Record<PlatformQuality, string>> }
const qualityRank: Record<PlatformQuality, number> = { auto: 100, '64k': 0, '128k': 1, '192k': 2, dolby: 2, '320k': 3, flac: 4, ape: 4, wav: 4, flac24bit: 5, jyeffect: 6, sky: 7, jymaster: 8, vivid: 8 }
const record = (value: any): Record<string, any> => value && typeof value === 'object' ? value : {}
const image = (value: unknown) => typeof value === 'string' && value ? value.startsWith('http') ? value : `https://d.musicapp.migu.cn${value}` : ''

async function request(context: ProviderContext, endpoint: string, params: Record<string, unknown> = {}, options: { post?: boolean, encrypted?: boolean } = {}): Promise<any> {
  const cookies = await context.cookies()
  const url = new URL(endpoint.startsWith('https://') ? endpoint : `${API}${endpoint}`)
  if (!options.post) for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, String(value))
  const headers = new Headers({
    Referer: 'https://music.migu.cn/',
    Origin: 'https://music.migu.cn',
    channel: '014X031',
    subchannel: '014X031',
    appId: 'h5',
    platform: 'H5',
    ua: 'Android_migu',
    version: '6.8.8',
    IMEI: 'h5page',
    IMSI: 'h5page',
    uid: cookies.mg_auth_uid ?? '',
    pacmtoken: cookies.mg_auth_pacmtoken ?? '',
    timestamp: String(Date.now()),
    'Content-Type': 'application/json;charset=UTF-8',
  })
  if (options.encrypted) { headers.set('birth', 'h5page'); headers.set('signature', '1') }
  const response = await context.session.fetch(url.toString(), {
    method: options.post ? 'POST' : 'GET',
    headers,
    ...(options.post ? { body: JSON.stringify(params) } : {}),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`咪咕音乐请求失败 (${response.status})`)
  let body: any
  if (response.headers.get('signature') === '1') {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length < 4 || bytes[0] !== 171 || bytes[1] !== 205 || bytes[2] !== 1) throw new Error('咪咕音乐音频响应格式无效')
    const decoded = Buffer.alloc(bytes.length - 4)
    for (let index = 0; index < decoded.length; index++) decoded[index] = bytes[index + 4] + bytes[3] - ENVELOPE_KEY[index % ENVELOPE_KEY.length]
    body = JSON.parse(decoded.toString('utf8'))
  } else body = await response.json()
  if (!Array.isArray(body) && body.code !== '000000') throw new Error(['290001', '290002', '290003'].includes(String(body.code)) ? '咪咕音乐登录已失效，请重新登录' : String(body.info ?? `咪咕音乐接口返回错误 (${String(body.code)})`))
  return body
}

function toTrack(value: any): (LX.Music.MusicInfo_mg & { meta: MiguMeta }) | null {
  const song = record(value)
  const upstreamSongId = String(song.songId ?? '')
  const songId = String(song.copyrightId ?? song.songId ?? '')
  const name = String(song.songName ?? song.name ?? '')
  if (!songId || !name) return null
  const formats: any[] = Array.isArray(song.audioFormats) ? song.audioFormats : []
  const platformQualitys: PlatformQuality[] = Object.entries(toneFlags).filter(([, flag]) => formats.some(format => format.formatType === flag)).map(([quality]) => quality as PlatformQuality)
  const qualitys = platformQualitys.filter((quality): quality is LX.Quality => quality !== 'sky').map(type => ({ type, size: null }))
  const seconds = Number(song.duration ?? 0)
  const meta: MiguMeta = {
    songId,
    isVip: songVip('mg', song),
    upstreamSongId,
    copyrightId: String(song.copyrightId ?? ''),
    contentId: String(song.contentId ?? ''),
    resourceType: String(song.resourceType ?? '2'),
    platformQualitys,
    formatResourceTypes: Object.fromEntries(Object.entries(toneFlags).map(([quality, flag]) => [quality, String(formats.find(format => format.formatType === flag)?.resourceType ?? song.resourceType ?? '2')])),
    albumName: String(song.album ?? ''),
    albumId: String(song.albumId ?? ''),
    picUrl: image(song.img3 ?? song.img2 ?? song.img1 ?? song.imgItems?.[0]?.img),
    qualitys,
    _qualitys: Object.fromEntries(qualitys.map(item => [item.type, { size: null }])),
    lrcUrl: String(song.lrcUrl ?? song.ext?.lrcUrl ?? ''),
    mrcUrl: String(song.mrcUrl ?? song.ext?.mrcUrl ?? ''),
    trcUrl: String(song.trcUrl ?? song.ext?.trcUrl ?? ''),
  }
  return { id: `mg_${songId}`, source: 'mg', name, singer: (song.singerList ?? song.singers ?? []).map((singer: any) => singer.name).filter(Boolean).join(' / '), interval: seconds ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : null, meta }
}

async function detail(context: ProviderContext, track: LX.Music.MusicInfoOnline): Promise<MiguMeta> {
  const current = track.meta as MiguMeta
  if (current.contentId && current.copyrightId) return current
  if (current.upstreamSongId) {
    const body = await request(context, '/MIGUM3.0/resource/song/by-songids/v2.0', { songId: current.upstreamSongId })
    const songs: any[] = Array.isArray(body.data) ? body.data : []
    const info = toTrack(songs.find(item => String(item.songId) === current.upstreamSongId))
    if (info?.meta.contentId) return info.meta
  }
  // Existing LX tracks identify Migu songs by copyrightId, whereas the v5
  // song detail route accepts the internal songId. Resolve the same recording.
  const candidates = await search(context, track)
  const copyright = String(current.copyrightId || current.songId)
  const exact = candidates.find(item => String(item.meta.copyrightId) === copyright)
  const match = exact ? { status: 'matched' as const, track: exact } : chooseMatch(track, candidates)
  if (match.status !== 'matched' || !(match.track.meta as MiguMeta).contentId) throw new Error('咪咕音乐未找到同一录音的完整歌曲标识')
  return match.track.meta as MiguMeta
}

async function search(context: ProviderContext, track: LX.Music.MusicInfo): Promise<LX.Music.MusicInfo_mg[]> {
  const body = await request(context, 'https://app.u.nf.migu.cn/pc/resource/song/item/search/v1.0', { text: `${track.name} ${track.singer}`, pageNo: 1, pageSize: 20 })
  const songs = Array.isArray(body) ? body : body.data
  if (!Array.isArray(songs)) throw new Error('咪咕音乐未返回搜索结果')
  return songs.map(toTrack).filter((song): song is LX.Music.MusicInfo_mg => song != null)
}

async function readPlaylist(context: ProviderContext, id: string): Promise<LX.Music.MusicInfoOnline[]> {
  const songs = new Map<string, LX.Music.MusicInfoOnline>()
  let offset = 0
  for (let page = 1; page <= 400; page++) {
    const body = await request(context, '/MIGUM3.0/resource/playlist/song/v2.0', { playlistId: id, pageNo: page, pageSize: 100 })
    if (!Array.isArray(body.data?.songList)) throw new Error('咪咕音乐未返回歌单曲目')
    const batch = body.data.songList
    for (const song of batch) { const track = toTrack(song); if (track) songs.set(track.id, track) }
    offset += batch.length
    if (offset >= Number(body.data.totalCount ?? offset)) return [...songs.values()]
    if (!batch.length) throw new Error('咪咕音乐歌单分页不完整')
  }
  throw new Error('咪咕音乐歌单超过同步上限')
}

export const miguProvider: PlatformProvider = {
  id: 'migu',
  source: 'mg',
  name: '咪咕音乐',
  loginUrl: 'https://music.migu.cn/v5/#/favorite',
  cookieUrl: 'https://music.migu.cn/',
  domains: ['migu.cn', 'cmpassport.com', 'chinamobile.com'],
  authenticated: cookies => Boolean(cookies.mg_auth_pacmtoken && cookies.mg_auth_uid),
  async profile(context): Promise<PlatformProfile> {
    const cookies = await context.cookies()
    if (!cookies.mg_auth_pacmtoken || !cookies.mg_auth_uid) throw new Error('请先登录咪咕音乐')
    const body = await request(context, 'https://c.musicapp.migu.cn/user/h5/user-info/v1.0')
    const user = record(body.data?.userInfo ?? body.data?.userInfoItem ?? body.data)
    const id = String(user.userId ?? user.uid ?? '')
    if (!id || id !== cookies.mg_auth_uid) throw new Error('咪咕音乐登录已失效，请重新登录')
    // 官网 SDK 写入的 mg_auth_* 是不带回话期的会话 Cookie，应用重启即失效。
    // profile 验证通过后统一升级为持久 Cookie，让登录态跨重启保留。
    const persistent: Array<[string, string]> = [
      ['mg_auth_pacmtoken', cookies.mg_auth_pacmtoken],
      ['mg_auth_sid', cookies.mg_auth_sid ?? ''],
      ['mg_auth_pid', cookies.mg_auth_pid ?? ''],
      ['mg_auth_msisdn', cookies.mg_auth_msisdn ?? ''],
      ['mg_auth_uid', cookies.mg_auth_uid],
      ['mg_auth_authType', cookies.mg_auth_authType ?? ''],
    ]
    const expirationDate = Date.now() / 1000 + 365 * 86400
    for (const [name, value] of persistent) {
      if (!value) continue
      await context.session.cookies.set({ url: 'https://music.migu.cn/', domain: '.migu.cn', path: '/', name, value, secure: true, sameSite: 'lax', expirationDate })
    }
    // 会员信息：官网会员中心的 memberCards[].identityItems[].memberItems[] 带
    // notInForce 与 validTime（YYYYMMDDHHmmss，2099 开头为连续包月）。取最新一档
    // 生效会员的名称与到期时间；member/icon 仅作为接口失败时的名称兜底。
    const memberCenter = await request(context, 'https://c.musicapp.migu.cn/user/member/center/v3.0').catch(() => null)
    let memberName = ''
    let bestTime = 0
    let continuous = false
    for (const card of Array.isArray(memberCenter?.data?.memberCards) ? memberCenter.data.memberCards : []) {
      for (const identity of card?.identityItems ?? []) {
        for (const memberItem of identity?.memberItems ?? []) {
          if (memberItem?.notInForce) continue
          const name = String(memberItem?.name ?? identity?.name ?? '').trim()
          const validTime = String(memberItem?.validTime ?? '')
          if (validTime.startsWith('2099')) {
            if (!continuous) { continuous = true; memberName = name || memberName }
            continue
          }
          const match = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(validTime)
          if (!match) continue
          const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 23), Number(match[5] ?? 59), Number(match[6] ?? 59)).getTime()
          if (!Number.isFinite(time) || time <= Date.now()) continue
          if (time > bestTime) { bestTime = time; memberName = name || memberName }
        }
      }
    }
    let dueDate: number | null = null
    if (!memberName && !continuous) {
      const member = await request(context, 'https://c.musicapp.migu.cn/pc/open/api/member/icon/v1.0').catch(() => null)
      memberName = Array.isArray(member?.data) ? String((member.data as any[])[0]?.memberTypeName ?? '').trim() : ''
    } else if (continuous) {
      dueDate = null
    } else if (bestTime > 0) {
      dueDate = bestTime
    } else {
      memberName = ''
    }
    // 咪咕主要以手机号登录；官网信任接口返回 userInfoItem.msisdn（手机号），
    // 老接口偶尔直接带在 userInfo 里。两处都取不到就不显示。
    const direct = [user.msisdn, user.mobile, user.phoneNumber, user.telephone].map(value => String(value ?? '').trim()).find(Boolean) ?? ''
    const phone = direct || await request(context, 'https://c.musicapp.migu.cn/pc/user/api/user-info/trust-uid/v1.0')
      .then(trust => {
        const info = record(record(trust?.data ?? trust).userInfoItem)
        return String(record(trust?.data ?? trust).userInfoItem?.msisdn ?? info.msisdn ?? '').trim()
      })
      .catch(() => '')
    return {
      id,
      nickname: String(user.nickName ?? user.nickname ?? '咪咕用户'),
      avatar: image(user.imageUrl ?? user.avatar ?? user.middleIcon),
      ...(memberName ? { vip: { label: memberName, dueDate } } : {}),
      ...(phone ? { extra: { phone } } : {}),
    }
  },
  async likes(context) {
    const body = await request(context, '/pc/user/home-page/v2.0')
    if (!Array.isArray(body.data?.userPrivateItems)) throw new Error('咪咕音乐未返回我喜欢的音乐')
    const favorite = body.data.userPrivateItems.find((item: any) => String(item.title ?? '').trim() === '喜欢的音乐')
    if (!favorite) return []
    const match = /(?:musicListId|playlistId)=([^&#]+)/.exec(String(favorite.actionUrl ?? ''))
    const id = String(favorite.musicListId ?? favorite.resId ?? match?.[1] ?? '')
    if (!id) throw new Error('咪咕音乐未返回红心歌单标识')
    return readPlaylist(context, id)
  },
  async playlists(context, user): Promise<PlatformPlaylist[]> {
    const body = await request(context, '/pc/user/home-page/v2.0')
    const created = body.data?.myCreatedMusicLists?.createdMusicLists
    const collected = body.data?.myCollectedMusicLists?.collectMusicLists
    if (!Array.isArray(created)) throw new Error('咪咕音乐未返回创建的歌单')
    const toPlaylist = (item: any, isCollected: boolean): PlatformPlaylist | null => {
      const remoteId = String(item.musicListId ?? '')
      if (!remoteId) return null
      return {
        id: `migu:${remoteId}`,
        platform: 'migu',
        ownerId: user.id,
        remoteId,
        name: String(item.title ?? '未命名歌单'),
        cover: image(item.imgItem?.img ?? item.img),
        count: Math.max(0, Number(item.musicNum ?? item.songNum) || 0),
        loaded: false,
        lastSync: null,
        collected: isCollected,
      }
    }
    // 自建歌单：只保留当前账号创建的条目（接口也可能返回协作歌单）。
    const own = created
      .filter((item: any) => !item.ownerId || String(item.ownerId) === user.id)
      .map((item: any) => toPlaylist(item, false))
    // 收藏歌单：别人创建、被当前账号收藏的列表。
    const saved = Array.isArray(collected) ? collected.map((item: any) => toPlaylist(item, true)) : []
    return [...own, ...saved].filter((item: PlatformPlaylist | null): item is PlatformPlaylist => item != null)
  },
  async playlistTracks(context, user, playlist) {
    const body = await request(context, '/resource/playlist/v2.0', { playlistId: playlist.remoteId })
    // 收藏歌单的 ownerId 是原作者，不能据此拒绝；只校验歌单确实存在。
    if (body.data == null) throw new Error('咪咕音乐未返回歌单内容，请重新同步')
    return readPlaylist(context, playlist.remoteId)
  },
  search,
  async available(context, track) {
    const meta = await detail(context, track)
    // A paid catalogue entry can still be liked. Playback privileges are
    // checked separately by the official stream endpoint.
    return Boolean(meta.contentId && meta.copyrightId)
  },
  async musicQualitys(context, track) { return (await detail(context, track)).platformQualitys ?? ['128k'] },
  async musicUrl(context, track, quality): Promise<PlatformStream> {
    const meta = await detail(context, track)
    const levels = meta.platformQualitys?.length ? meta.platformQualitys : ['128k' as const]
    const eligible = levels.filter(level => qualityRank[level] <= qualityRank[quality]).sort((a, b) => qualityRank[b] - qualityRank[a])
    if (!eligible.length) eligible.push(levels[0])
    let denied = '咪咕音乐当前账号没有此歌曲的完整播放权限'
    for (const selected of eligible) {
      const toneFlag = toneFlags[selected]
      if (!toneFlag) continue
      let body: any
      try {
        body = await request(context, '/strategy/pc/listen/v2.0', { contentId: meta.contentId, copyrightId: meta.copyrightId, resourceType: meta.formatResourceTypes?.[selected] ?? meta.resourceType ?? '2', netType: '01', toneFlag, scene: '' }, { encrypted: true })
      } catch (error) {
        if (!(error instanceof Error) || !/音质|会员|权限|版权|完整|试听/.test(error.message)) throw error
        denied = error.message
        continue
      }
      const data = record(body.data)
      if (data.cannotCode || Number(data.auditionsLength) > 0) { denied = String(data.dialogInfo?.text ?? denied); continue }
      if (typeof data.url !== 'string' || !/^https?:\/\//.test(data.url)) { denied = '咪咕音乐没有返回可播放音频'; continue }
      const actualFlag = String(data.audioFormatType ?? data.formatType ?? data.toneFlag ?? '')
      const actualQuality = Object.entries(toneFlags).find(([, flag]) => flag === actualFlag)?.[0] as PlatformQuality | undefined
      // Older responses omit format metadata: only label the confirmed basic
      // quality rather than reporting a requested premium tier as delivered.
      const actual = actualQuality ?? '128k'
      return { url: data.url, type: legacyQuality(actual), quality: actual }
    }
    throw new Error(denied)
  },
  async like(context, _user, track, liked) {
    const meta = await detail(context, track)
    const body = liked
      ? await request(context, '/pc/user/api/add-music-list-song/v1.0', { contentIds: [meta.contentId] }, { post: true })
      : await request(context, '/pc/user/h5-import-musiclist/v1.0', { channel: '23', contentId: meta.contentId, songflag: '2' }, { post: true })
    if (liked && !(Number(body.data?.successNum) > 0) && !(body.data?.fail2RepeatContentIdList?.includes(meta.contentId))) throw new Error('咪咕音乐没有确认红心操作成功')
  },
  async addToPlaylist(context, user, playlist, track) {
    if (playlist.platform !== 'migu' || playlist.ownerId !== user.id) throw new Error('歌单不属于当前咪咕音乐账号，请重新同步')
    const meta = await detail(context, track)
    if (!meta.contentId) throw new Error('咪咕音乐未找到歌曲的 contentId')
    // 同一个接口：红心只传 contentIds，加入指定歌单额外传 id（歌单 musicListId）。
    const body = await request(context, '/pc/user/api/add-music-list-song/v1.0', { id: playlist.remoteId, contentIds: [meta.contentId] }, { post: true })
    const success = Number(body.data?.successNum) > 0
    const repeated = (body.data?.fail2RepeatContentIdList ?? []).includes(meta.contentId)
    if (!success && !repeated) throw new Error('咪咕音乐没有确认加歌成功')
  },
}
