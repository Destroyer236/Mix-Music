import { app, BrowserWindow, session } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PlatformAccount, PlatformHeartbeatRequest, PlatformHeartbeatResult, PlatformId, PlatformLikeResult, PlatformPlaylist, PlatformPlaylistAddResult, PlatformPlaylistDetail, PlatformSnapshot } from '@common/platformAccounts'
import { mainHandle } from '@common/mainIpc'
import { sendEvent, showWindow } from '@main/modules/winMain/main'
import { aggregateFavorites, chooseMatch } from './matching'
import { qqProvider } from './providers/qq'
import { getNeteaseHeartbeat, neteaseProvider } from './providers/netease'
import { miguProvider } from './providers/migu'
import { bilibiliProvider } from './providers/bilibili'
import { kugouProvider } from './providers/kugou'
import { kugouConceptProvider } from './providers/kugouConceptProvider'
import { kuwoProvider } from './providers/kuwo'
import qishuiProvider, { searchCatalog, publicPlaylist, resolveShare, getLyrics, getAlbumTracks, getArtistTracks } from './providers/qishui'
import { createQishuiLogin } from './qishuiLogin'
import { createQishuiPassport } from './qishuiPassport'
import { createQishuiLoginDiagnosticWriter } from './qishuiLoginDiagnostics'
import bodianProvider, { searchCatalog as searchBodianCatalog, publicPlaylist as bodianPlaylist, resolveShare as resolveBodianShare, getLyrics as getBodianLyrics, getAlbumTracks as getBodianAlbumTracks, getArtistTracks as getBodianArtistTracks } from './providers/bodian'
import { createBodianLogin } from './bodianLogin'
import { createMiguPhoneLogin, type MiguPhoneLoginResult } from './miguPhoneLogin'
import { createKugouLogin } from './kugouLogin'
import { claimDayVip, upgradeDayVip } from './providers/kugouConcept'
import { createNativeLogin, type NativeLoginPlatform } from './nativeLogin'
import type { PlatformProvider, ProviderContext } from './providers/types'
import { canNavigateAccount, registerAccountSession } from './navigation'
import { createPlaybackResolver } from './playback'
import type { PlatformQuality, ResolvedPlatformStream } from '@common/platformPlayback'
import { getImportedPlaybackSources } from '../userApi/playback'

interface ProviderState {
  provider: PlatformProvider
  context: ProviderContext
  account: PlatformAccount
  tracks: LX.Music.MusicInfoOnline[]
  playlists: Array<{ playlist: PlatformPlaylist, tracks: LX.Music.MusicInfoOnline[] }>
  window: BrowserWindow | null
  busy: Promise<unknown>
  generation: number
}
const providers = [qqProvider, neteaseProvider, qishuiProvider, bodianProvider, kugouProvider, kugouConceptProvider, kuwoProvider, miguProvider, bilibiliProvider]
const states = new Map<PlatformId, ProviderState>()
let initialized: Promise<void> | undefined
let baseInitialized: Promise<void> | undefined
const accountChecks = new Map<PlatformId, { generation: number, promise: Promise<void> }>()
const playbackAccountChecks = new Map<PlatformId, { generation: number, promise: Promise<void> }>()
let saveQueue = Promise.resolve()
const cachePath = () => path.join(app.getPath('userData'), 'platform-favorites.json')
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '平台请求失败，请重试'
const hasAuthentication = (provider: PlatformProvider, cookies: Record<string, string>) => provider.authenticated?.(cookies) ?? Boolean(provider.id === 'qq' ? cookies.qqmusic_key || cookies.qm_keyst : provider.id === 'netease' ? cookies.MUSIC_U : Object.keys(cookies).length)
const playback = createPlaybackResolver(() => [...states.values()], () => global.lx.appSetting['player.preferredSource'], getImportedPlaybackSources)
const snapshot = (): PlatformSnapshot => ({
  accounts: [...states.values()].map(state => ({ ...state.account })),
  favorites: aggregateFavorites([...states.values()].map(state => ({ platform: state.provider.id, tracks: state.tracks }))),
  playlists: [...states.values()].flatMap(state => state.playlists.map(item => ({ ...item.playlist }))),
})
const notify = () => sendEvent('platform_accounts_changed', snapshot())
const save = async() => {
  const data = JSON.stringify([...states.values()].map(state => ({ platform: state.provider.id, profile: state.account.profile, lastSync: state.account.lastSync, tracks: state.tracks, playlists: state.playlists })))
  saveQueue = saveQueue.catch(() => {}).then(async() => {
    const target = cachePath()
    await fs.writeFile(`${target}.tmp`, data, 'utf8')
    await fs.rename(`${target}.tmp`, target)
  }).catch(error => { console.warn('Mix Music platform favorites cache could not be saved:', error) })
  return saveQueue
}
const initBase = async() => {
  baseInitialized ??= (async() => {
    for (const provider of providers) {
      // 分区名必须全小写：Electron 把 persist 分区名转成小写目录，但同名不同大小写
      // 会创建两个独立 session 共用同一磁盘目录，导致 cookie 互相覆盖、重启后丢失。
      const ses = session.fromPartition(`persist:linkline-account-${provider.id.toLowerCase()}`)
      registerAccountSession(ses, provider.domains)
      ses.setPermissionRequestHandler((_contents, _permission, allow) => { allow(false) })
      states.set(provider.id, {
        provider,
        context: { session: ses, playbackSession: provider.id === 'qishui' ? session.fromPartition('persist:win-main') : undefined, cookies: async() => Object.fromEntries((await ses.cookies.get({ url: provider.cookieUrl ?? `${new URL(provider.loginUrl).origin}/` })).map(cookie => [cookie.name, cookie.value])) },
        account: { platform: provider.id, name: provider.name, connected: false, profile: null, lastSync: null, count: 0, error: '', canSync: !provider.webOnly && provider.syncSupported !== false, canAddToPlaylist: Boolean(provider.addToPlaylist), notice: provider.notice ?? '' },
        tracks: [],
        playlists: [],
        window: null,
        busy: Promise.resolve(),
        generation: 0,
      })
    }
    try {
      const cached = JSON.parse(await fs.readFile(cachePath(), 'utf8'))
      if (Array.isArray(cached)) {
        for (const item of cached) {
          if (item == null || typeof item !== 'object') continue
          const state = states.get(item.platform)
          if (!state || !Array.isArray(item.tracks)) continue
          state.tracks = item.tracks.filter((track: any) => track != null && typeof track === 'object' && typeof track.id === 'string' && typeof track.name === 'string' && typeof track.singer === 'string' && track.meta != null && typeof track.meta.songId !== 'undefined')
          state.account.profile = item.profile && typeof item.profile.id === 'string' ? item.profile : null
          if (Array.isArray(item.playlists) && state.account.profile) {
            state.playlists = item.playlists.filter((entry: any) => {
              const playlist = entry?.playlist
              return playlist && playlist.platform === state.provider.id && playlist.ownerId === state.account.profile?.id && typeof playlist.remoteId === 'string' && playlist.id === `${state.provider.id}:${playlist.remoteId}` && typeof playlist.name === 'string' && Array.isArray(entry.tracks)
            }).map((entry: any) => ({
              playlist: { ...entry.playlist, loaded: Boolean(entry.playlist.loaded), count: Math.max(0, Number(entry.playlist.count) || 0), lastSync: typeof entry.playlist.lastSync === 'number' ? entry.playlist.lastSync : null },
              tracks: entry.tracks.filter((track: any) => track && typeof track.id === 'string' && typeof track.name === 'string' && typeof track.singer === 'string' && track.meta && typeof track.meta.songId !== 'undefined'),
            }))
          }
          state.account.lastSync = typeof item.lastSync === 'number' ? item.lastSync : null
          state.account.count = state.tracks.length
        }
      }
    } catch {}
  })()
  await baseInitialized
}
const checkAccount = async(state: ProviderState): Promise<void> => {
  const generation = state.generation
  const existing = accountChecks.get(state.provider.id)
  if (existing?.generation === generation) return existing.promise
  const check = (async() => {
    try {
      const cookies = await state.context.cookies()
      if (state.generation !== generation || state.provider.webOnly === true || !hasAuthentication(state.provider, cookies)) return
      try {
        const profile = await state.provider.profile(state.context)
        if (state.generation !== generation) return
        acceptProfile(state, profile)
        state.account.connected = true
      } catch (error) { if (state.generation === generation) state.account.error = errorMessage(error) }
    } catch (error) { if (state.generation === generation) state.account.error = errorMessage(error) }
  })()
  accountChecks.set(state.provider.id, { generation, promise: check })
  return check
}
const init = async() => {
  initialized ??= (async() => {
    await initBase()
    await Promise.all([...states.values()].map(checkAccount))
    await save()
  })()
  await initialized
}
/**
 * Playback only needs the account owning the current track to be checked.
 * Loading profile endpoints for every unrelated platform makes the first
 * play wait on the slowest provider, while the resolver can already probe
 * the remaining providers itself when fallback is needed.
 */
const initForPlayback = async(source?: LX.OnlineSource) => {
  await initBase()
  if (!source) return
  const state = [...states.values()].find(item => item.provider.source === source)
  if (!state || state.account.connected) return
  const existing = playbackAccountChecks.get(state.provider.id)
  if (existing?.generation === state.generation) return existing.promise
  // A slow profile endpoint must not prevent requesting the actual stream.
  // The existing check can finish in the background for later account views.
  const promise = (async() => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([checkAccount(state), new Promise<void>(resolve => { timeout = setTimeout(resolve, 2000) })])
    } finally { clearTimeout(timeout) }
  })()
  playbackAccountChecks.set(state.provider.id, { generation: state.generation, promise })
  await promise
}
const getState = async(id: PlatformId) => {
  await init()
  const state = states.get(id)
  if (!state) throw new Error('不支持的音乐平台')
  return state
}
const exclusive = async<T>(state: ProviderState, action: () => Promise<T>): Promise<T> => {
  const operation = state.busy.catch(() => {}).then(action)
  state.busy = operation.catch(() => {})
  return operation
}
const acceptProfile = (state: ProviderState, profile: PlatformAccount['profile']) => {
  if (state.account.profile?.id !== profile?.id) {
    state.tracks = []
    state.playlists = []
    state.account.count = 0
    state.account.lastSync = null
  }
  state.account.profile = profile
}
const refreshState = async(state: ProviderState, generation: number) => {
  try {
    const profile = await state.provider.profile(state.context)
    if (generation !== state.generation) return
    acceptProfile(state, profile)
    state.account.connected = true
    const [favorites, playlists] = await Promise.allSettled([
      state.provider.likes(state.context, profile),
      state.provider.playlists?.(state.context, profile) ?? Promise.resolve(null),
    ])
    if (generation !== state.generation) return
    if (favorites.status === 'fulfilled') {
      state.tracks = favorites.value
      state.account.lastSync = Date.now()
    }
    if (playlists.status === 'fulfilled' && playlists.value) {
      state.playlists = playlists.value.filter(playlist => playlist.platform === state.provider.id && playlist.ownerId === profile.id).map(playlist => {
        const previous = state.playlists.find(item => item.playlist.id === playlist.id && item.playlist.ownerId === profile.id)
        return { playlist: { ...playlist, loaded: false, lastSync: previous?.playlist.lastSync ?? null }, tracks: previous?.tracks ?? [] }
      })
    }
    state.account.count = state.tracks.length
    state.account.error = [favorites, playlists].flatMap(result => result.status === 'rejected' ? [errorMessage(result.reason)] : []).join('；')
    if (/登录|login/i.test(state.account.error)) state.account.connected = false
  } catch (error) {
    if (generation !== state.generation) return
    state.account.error = errorMessage(error)
    if (/登录|login/i.test(state.account.error)) state.account.connected = false
  }
  await save()
  notify()
}
const syncState = async(state: ProviderState) => {
  if (state.account.canSync === false) return
  const generation = state.generation
  await exclusive(state, async() => { if (generation === state.generation) await refreshState(state, generation) })
}

const getPlaylist = async(params: { id: string, refresh?: boolean }): Promise<PlatformPlaylistDetail> => {
  await init()
  if (!params || typeof params.id !== 'string') throw new Error('无效的平台歌单')
  const state = [...states.values()].find(item => item.playlists.some(entry => entry.playlist.id === params.id))
  if (!state) throw new Error('歌单不存在，请先同步平台歌单')
  const generation = state.generation
  return exclusive(state, async() => {
    if (generation !== state.generation) throw new Error('平台账号已更改，请重新打开歌单')
    try {
      if (state.account.connected) {
        const profile = await state.provider.profile(state.context)
        if (generation !== state.generation) throw new Error('平台账号已更改，请重新打开歌单')
        acceptProfile(state, profile)
      }
      const entry = state.playlists.find(item => item.playlist.id === params.id && item.playlist.ownerId === state.account.profile?.id)
      if (!entry) throw new Error('歌单不属于当前账号，请重新同步')
      if (!params.refresh && entry.playlist.loaded) return { ...entry, cached: true }
      if (!state.account.connected) {
        if (entry.playlist.lastSync != null && !params.refresh) return { ...entry, cached: true }
        throw new Error('请重新登录平台后加载此歌单')
      }
      if (!state.provider.playlistTracks) throw new Error('此平台暂不支持读取歌单')
      const profile = state.account.profile
      if (!profile) throw new Error('请重新登录平台后加载此歌单')
      const tracks = await state.provider.playlistTracks(state.context, profile, entry.playlist)
      if (generation !== state.generation) throw new Error('平台账号已更改，请重新打开歌单')
      entry.tracks = tracks
      entry.playlist = { ...entry.playlist, count: tracks.length, loaded: true, lastSync: Date.now() }
      await save()
      notify()
      return { ...entry, cached: false }
    } catch (error) {
      await save()
      notify()
      throw error
    }
  })
}

const getHeartbeat = async(params: PlatformHeartbeatRequest = {}): Promise<PlatformHeartbeatResult> => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('无效的心动模式参数')
  const state = await getState('netease')
  const generation = state.generation
  const changed = () => generation !== state.generation
  return exclusive(state, async() => {
    if (changed()) throw new Error('网易云账号已更改，请重新开启心动模式')
    if (!state.account.connected) throw new Error('登录网易云音乐后才能使用心动模式')
    try {
      const previousId = state.account.profile?.id
      const profile = await state.provider.profile(state.context)
      if (changed()) throw new Error('网易云账号已更改，请重新开启心动模式')
      acceptProfile(state, profile)
      if (previousId && previousId !== profile.id) {
        await save()
        notify()
        throw new Error('网易云账号已更改，请重新开启心动模式')
      }
      const result = await getNeteaseHeartbeat(state.context, profile, params)
      if (changed() || state.account.profile?.id !== profile.id) throw new Error('网易云账号已更改，请重新开启心动模式')
      return result
    } catch (error) {
      if (changed()) throw new Error('网易云账号已更改，请重新开启心动模式')
      const message = errorMessage(error)
      if (/登录|login/i.test(message)) {
        state.account.connected = false
        state.account.error = message
        await save()
        notify()
      }
      throw error
    }
  })
}
const openLogin = async(id: PlatformId) => {
  // QQ 音乐的网页登录窗口内嵌官方站点（QQ 扫码 / 密码 / 微信扫码），扫码登录仍走原生二维码。
  if (id === 'netease') throw new Error('请使用平台账号的扫码登录入口')
  if (id === 'qishui') throw new Error('请使用汽水音乐的扫码登录入口')
  if (id === 'bodian') throw new Error('请使用波点音乐的扫码登录入口')
  const state = await getState(id)
  if (state.window && !state.window.isDestroyed()) { state.window.focus(); return snapshot() }
  const window = new BrowserWindow({
    title: `${state.provider.name} · 登录 Mix Music`,
    width: 1080,
    height: 760,
    minWidth: 780,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: { session: state.context.session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  state.window = window
  const generation = ++state.generation
  const loginStatus = { checking: false }
  let authenticated = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const checkLogin = async() => {
    if (state.provider.webOnly === true || loginStatus.checking || window.isDestroyed()) return
    loginStatus.checking = true
    try {
      await exclusive(state, async() => {
        if (generation !== state.generation || window.isDestroyed()) return
        if (!hasAuthentication(state.provider, await state.context.cookies())) return
        const profile = await state.provider.profile(state.context)
        if (generation !== state.generation || window.isDestroyed()) return
        acceptProfile(state, profile)
        state.account.connected = true
        state.account.error = ''
        authenticated = true
        window.close()
        showWindow()
        notify()
        if (state.account.canSync !== false) await refreshState(state, generation)
      })
    } catch (error) {
      if (generation === state.generation) {
        state.account.error = errorMessage(error)
        notify()
      }
    } finally { loginStatus.checking = false }
  }
  const onCookie = () => { clearTimeout(timer); timer = setTimeout(() => { void checkLogin() }, 1500) }
  state.context.session.cookies.on('changed', onCookie)
  window.webContents.on('did-finish-load', onCookie)
  window.webContents.on('will-navigate', (event, url) => { if (!canNavigateAccount(state.context.session, url)) event.preventDefault() })
  window.webContents.on('will-redirect', (event, url) => { if (!canNavigateAccount(state.context.session, url)) event.preventDefault() })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (canNavigateAccount(state.context.session, url)) void window.loadURL(url).catch(() => {})
    return { action: 'deny' }
  })
  const interval = setInterval(() => { void checkLogin() }, 5000)
  window.on('closed', () => {
    clearTimeout(timer)
    clearInterval(interval)
    state.context.session.cookies.removeListener('changed', onCookie)
    state.window = null
    // A successful login continues syncing after its window closes.
    if (!authenticated) ++state.generation
  })
  await window.loadURL(state.provider.loginUrl).catch(() => { state.account.error = '登录页面加载失败，请检查网络后重试'; notify() })
  return snapshot()
}

const setLike = async(track: LX.Music.MusicInfo, liked: boolean): Promise<PlatformLikeResult[]> => {
  await init()
  if (!track || typeof track.id !== 'string' || typeof track.name !== 'string' || typeof track.singer !== 'string' || !track.meta) throw new Error('无效的歌曲信息')
  const connected = [...states.values()].filter(state => state.account.connected && state.account.canSync !== false)
  const offline: PlatformLikeResult[] = [...states.values()].filter(state => (!state.account.connected || state.account.canSync === false) && state.account.profile).map(state => ({ platform: state.provider.id, status: 'failed', message: state.account.canSync === false ? state.account.notice || '平台未提供网页收藏同步接口' : '账号未连接，请重新登录后同步红心' }))
  const results = await Promise.all(connected.map(async(state): Promise<PlatformLikeResult> => exclusive(state, async() => {
    const platform = state.provider.id
    try {
      const profile = await state.provider.profile(state.context)
      acceptProfile(state, profile)
      await save()
      const source = state.provider.source
      const cached = chooseMatch(track, state.tracks)
      const match = track.source === source ? { status: 'matched' as const, track } : cached.status === 'matched' ? cached : chooseMatch(track, await state.provider.search(state.context, track))
      if (match.status !== 'matched') { await save(); notify(); return { platform, status: match.status, message: match.status === 'ambiguous' ? '有多个同名版本，未自动操作' : '没有找到可确认的同版本歌曲' } }
      if (!await state.provider.available(state.context, match.track)) { await save(); notify(); return { platform, status: 'unavailable', message: '该平台暂无此歌曲版权' } }
      await state.provider.like(state.context, profile, match.track, liked)
      state.tracks = state.tracks.filter(item => item.id !== match.track.id)
      if (liked) state.tracks.unshift(match.track)
      state.account.count = state.tracks.length
      state.account.error = ''
      await save()
      notify()
      return { platform, status: 'success', message: liked ? '已加红心' : '已取消红心', track: match.track }
    } catch (error) {
      state.account.error = errorMessage(error)
      if (/登录|login/i.test(state.account.error)) state.account.connected = false
      await save()
      notify()
      return { platform, status: 'failed', message: state.account.error }
    }
  })))
  return [...results, ...offline]
}

/**
 * 把歌曲加入指定平台歌单。与 setLike 共用歌曲匹配和版权检查：
 * 目标歌单锁定了唯一平台，因此只在该平台匹配，不做全平台分发。
 */
const addToPlaylist = async(params: { playlistId: string, track: LX.Music.MusicInfo }): Promise<PlatformPlaylistAddResult> => {
  await init()
  const { playlistId, track } = params
  if (typeof playlistId !== 'string' || !playlistId) throw new Error('无效的平台歌单')
  if (!track || typeof track.id !== 'string' || typeof track.name !== 'string' || typeof track.singer !== 'string' || !track.meta) throw new Error('无效的歌曲信息')
  const state = [...states.values()].find(item => item.playlists.some(entry => entry.playlist.id === playlistId))
  if (!state) throw new Error('歌单不存在，请先同步平台歌单')
  const platform = state.provider.id
  const entry = state.playlists.find(item => item.playlist.id === playlistId)
  if (!entry) throw new Error('歌单不存在，请先同步平台歌单')
  const addTrack = state.provider.addToPlaylist
  if (!addTrack) throw new Error(state.account.notice || `${state.provider.name}暂不支持添加歌曲到歌单`)
  if (state.account.canSync === false) throw new Error(state.account.notice || `${state.provider.name}暂不支持写入歌单`)
  if (!state.account.connected) throw new Error('账号未连接，请重新登录后重试')
  if (entry.playlist.ownerId !== state.account.profile?.id) throw new Error('歌单不属于当前账号，请重新同步')

  const generation = state.generation
  return exclusive(state, async(): Promise<PlatformPlaylistAddResult> => {
    const fail = (status: PlatformPlaylistAddResult['status'], message: string): PlatformPlaylistAddResult => ({ platform, playlistId, status, message })
    try {
      if (generation !== state.generation) throw new Error('平台账号已更改，请重新打开歌单')
      const profile = await state.provider.profile(state.context)
      if (generation !== state.generation) throw new Error('平台账号已更改，请重新打开歌单')
      acceptProfile(state, profile)
      if (entry.playlist.ownerId !== profile.id) throw new Error('歌单不属于当前账号，请重新同步')
      const source = state.provider.source
      const cached = chooseMatch(track, state.tracks)
      const match = track.source === source ? { status: 'matched' as const, track } : cached.status === 'matched' ? cached : chooseMatch(track, await state.provider.search(state.context, track))
      if (match.status !== 'matched') {
        await save(); notify()
        return fail(match.status, match.status === 'ambiguous' ? '有多个同名版本，未自动操作' : '没有找到可确认的同版本歌曲')
      }
      if (!await state.provider.available(state.context, match.track)) {
        await save(); notify()
        return fail('unavailable', '该平台暂无此歌曲版权')
      }
      await addTrack(state.context, profile, entry.playlist, match.track)
      // 歌单曲目缓存已过期：标记未加载，下次打开时重新拉取服务端内容。
      // 曲目数不在这里 +1——重复歌曲会被平台静默忽略，猜测的计数会长期偏高。
      entry.playlist = { ...entry.playlist, loaded: false }
      state.account.error = ''
      await save()
      notify()
      return { platform, playlistId, status: 'success', message: `已加入「${entry.playlist.name}」`, track: match.track }
    } catch (error) {
      state.account.error = errorMessage(error)
      if (/登录|login/i.test(state.account.error)) state.account.connected = false
      await save()
      notify()
      return fail('failed', state.account.error)
    }
  })
}

const getMusicUrl = async(params: { source: LX.OnlineSource, songId: string | number, mediaMid?: string, albumId?: string, id?: number, quality?: PlatformQuality, qishuiMediaType?: 'track' | 'ugc_clip' }) => {
  await initBase()
  const state = [...states.values()].find(state => state.provider.source === params.source)
  if (!state) throw new Error('此平台暂不支持直接播放')
  if (!state.provider.musicUrl) throw new Error(`${state.provider.name}暂不支持直接播放`)
  const songId = String(params.songId ?? '')
  if (!songId) throw new Error('歌曲缺少平台 ID')
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const track = {
    id: `${params.source}_${songId}`,
    source: params.source,
    name: '',
    singer: '',
    interval: null,
    meta: { songId, albumName: '', qualitys: [], _qualitys: {}, strMediaMid: params.mediaMid ?? '', albumId: params.albumId ?? '', id: params.id, ...(params.source === 'qs' && (params.qishuiMediaType === 'track' || params.qishuiMediaType === 'ugc_clip') ? { qishuiMediaType: params.qishuiMediaType } : {}) },
  } as LX.Music.MusicInfoOnline
  const stream = await state.provider.musicUrl(state.context, track, params.quality ?? '128k')
  // The legacy SDK contract carries only url/type. Reject previews here so
  // they cannot lose isTrial, get cached as full audio, or skip custom sources.
  // Official previews are still available through platform_playback_resolve.
  if (stream.isTrial) throw new Error(`${state.provider.name}仅返回试听音频，继续尝试其他完整音源`)
  return stream
}

export default () => {
  const nativeLogins = new Map<NativeLoginPlatform, ReturnType<typeof createNativeLogin>>()
  const nativeOwners = new Map<NativeLoginPlatform, WeakSet<Electron.WebContents>>()
  const nativePlatform = (value: unknown): NativeLoginPlatform => {
    if (value !== 'qq' && value !== 'netease') throw new Error('不支持的扫码登录平台')
    return value
  }
  const getNativeLogin = async(platform: NativeLoginPlatform) => {
    await initBase()
    const state = states.get(platform)!
    let login = nativeLogins.get(platform)
    if (!login) {
      login = createNativeLogin(state.context, platform, async() => {
        const generation = state.generation
        const cookies = await state.context.cookies()
        if (!hasAuthentication(state.provider, cookies)) throw new Error('平台未完成音乐登录授权，请重新扫码')
        const profile = await state.provider.profile(state.context)
        if (generation !== state.generation || !nativeLogins.get(platform)?.isActive()) throw new Error('登录已取消或过期，请重新扫码')
        return () => {
          if (generation !== state.generation) throw new Error('平台账号已更改，请重新扫码')
          // Requests started while the QR was waiting still belong to the old
          // account, even though the QR itself shares their generation.
          ++state.generation
          acceptProfile(state, profile)
          state.account.connected = true
          state.account.error = ''
          void save()
          notify()
          void syncState(state)
        }
      })
      nativeLogins.set(platform, login)
    }
    return { state, login }
  }
  mainHandle<{ platform: NativeLoginPlatform }, Awaited<ReturnType<ReturnType<typeof createNativeLogin>['start']>>>('platform_native_login_start', async({ event, params }) => {
    const platform = nativePlatform(params?.platform)
    const { state, login } = await getNativeLogin(platform)
    let owners = nativeOwners.get(platform)
    if (!owners) nativeOwners.set(platform, owners = new WeakSet())
    if (!owners.has(event.sender)) {
      owners.add(event.sender)
      const owner = event.sender.id
      event.sender.once('destroyed', () => { try { if (login.cancel(owner)) ++state.generation } catch {} })
    }
    state.window?.close()
    ++state.generation
    return login.start(event.sender.id)
  })
  mainHandle<{ platform: NativeLoginPlatform, flowId: string }, Awaited<ReturnType<ReturnType<typeof createNativeLogin>['check']>>>('platform_native_login_check', async({ event, params }) => {
    const platform = nativePlatform(params?.platform)
    if (typeof params?.flowId !== 'string' || !params.flowId || params.flowId.length > 100) throw new Error('无效的登录会话')
    const { login } = await getNativeLogin(platform)
    return login.check(event.sender.id, params.flowId)
  })
  mainHandle<{ platform: NativeLoginPlatform, flowId?: string }>('platform_native_login_cancel', async({ event, params }) => {
    const platform = nativePlatform(params?.platform)
    if (params?.flowId != null && (typeof params.flowId !== 'string' || !params.flowId || params.flowId.length > 100)) throw new Error('无效的登录会话')
    const { state, login } = await getNativeLogin(platform)
    if (login.cancel(event.sender.id, params?.flowId)) ++state.generation
  })
  let bodianLogin: ReturnType<typeof createBodianLogin> | undefined
  const bodianOwners = new WeakSet<Electron.WebContents>()
  const getBodianLogin = async() => {
    const state = await getState('bodian')
    bodianLogin ??= createBodianLogin(state.context, async() => {
      const generation = state.generation
      const profile = await state.provider.profile(state.context)
      if (generation !== state.generation || !bodianLogin?.isActive()) throw new Error('登录已取消或过期，请重新扫码')
      acceptProfile(state, profile)
      state.account.connected = true
      state.account.error = ''
      void save()
      notify()
      void syncState(state)
    })
    return { state, login: bodianLogin }
  }
  mainHandle('platform_bodian_login_start', async({ event }) => {
    const { state, login } = await getBodianLogin()
    if (!bodianOwners.has(event.sender)) {
      bodianOwners.add(event.sender)
      const owner = event.sender.id
      event.sender.once('destroyed', () => {
        try { if (login.cancel(owner)) ++state.generation } catch {}
      })
    }
    ++state.generation
    return login.start(event.sender.id)
  })
  mainHandle<{ flowId: string }, Awaited<ReturnType<ReturnType<typeof createBodianLogin>['check']>>>('platform_bodian_login_check', async({ event, params }) => {
    const { login } = await getBodianLogin()
    if (!params || typeof params.flowId !== 'string') throw new Error('无效的登录会话')
    return login.check(event.sender.id, params.flowId)
  })
  mainHandle<{ flowId?: string }>('platform_bodian_login_cancel', async({ event, params }) => {
    const { state, login } = await getBodianLogin()
    if (login.cancel(event.sender.id, params?.flowId)) ++state.generation
  })
  mainHandle<{ query: string, kind: 'track' | 'album' | 'artist' | 'playlist', page?: number }, Awaited<ReturnType<typeof searchBodianCatalog>>>('platform_bodian_search', async({ params }) => {
    if (!params || typeof params.query !== 'string' || !['track', 'album', 'artist', 'playlist'].includes(params.kind)) throw new Error('无效的波点搜索')
    return searchBodianCatalog((await getState('bodian')).context, params.query, params.kind, params.page ?? 1)
  })
  mainHandle<{ id: string }, Awaited<ReturnType<typeof bodianPlaylist>>>('platform_bodian_playlist', async({ params }) => bodianPlaylist((await getState('bodian')).context, params?.id))
  mainHandle<{ id: string, page?: number, limit?: number }, Awaited<ReturnType<typeof getBodianAlbumTracks>>>('platform_bodian_album', async({ params }) => getBodianAlbumTracks((await getState('bodian')).context, params?.id, params?.page, params?.limit))
  mainHandle<{ id: string, page?: number, limit?: number }, Awaited<ReturnType<typeof getBodianArtistTracks>>>('platform_bodian_artist', async({ params }) => getBodianArtistTracks((await getState('bodian')).context, params?.id, params?.page, params?.limit))
  mainHandle<{ id: string }, Awaited<ReturnType<typeof getBodianLyrics>>>('platform_bodian_lyric', async({ params }) => getBodianLyrics((await getState('bodian')).context, params?.id))
  mainHandle<{ text: string }, Awaited<ReturnType<typeof resolveBodianShare>>>('platform_bodian_share', async({ params }) => resolveBodianShare((await getState('bodian')).context, params?.text))
  let qrLogin: ReturnType<typeof createQishuiLogin> | undefined
  const qrDiagnostic = createQishuiLoginDiagnosticWriter(path.join(app.getPath('userData'), 'qishui-login-diagnostic.json'))
  const qrOwners = new WeakSet<Electron.WebContents>()
  const getQrLogin = async() => {
    const state = await getState('qishui')
    qrLogin ??= createQishuiLogin(state.context, async() => {
      const generation = state.generation
      const profile = await state.provider.profile(state.context)
      if (generation !== state.generation || !qrLogin?.isActive()) throw new Error('登录已取消或过期，请重新扫码')
      // Cookie persistence finishes inside the controller before this callback.
      // Accept the verified profile without another await so cancel cannot split
      // the account commit from the controller's confirmed state.
      acceptProfile(state, profile)
      state.account.connected = true
      state.account.error = ''
      void save()
      notify()
      void syncState(state)
    }, createQishuiPassport, qrDiagnostic)
    return { state, login: qrLogin }
  }
  mainHandle('platform_qishui_login_start', async({ event }) => {
    const { state, login } = await getQrLogin()
    if (!qrOwners.has(event.sender)) {
      qrOwners.add(event.sender)
      const owner = event.sender.id
      event.sender.once('destroyed', () => {
        try { if (login.cancel(owner)) ++state.generation } catch {}
      })
    }
    ++state.generation
    return login.start(event.sender.id)
  })
  mainHandle<{ flowId: string }, Awaited<ReturnType<ReturnType<typeof createQishuiLogin>['check']>>>('platform_qishui_login_check', async({ event, params }) => {
    const { login } = await getQrLogin()
    if (!params || typeof params.flowId !== 'string') throw new Error('无效的登录会话')
    return login.check(event.sender.id, params.flowId)
  })
  mainHandle<{ flowId?: string }>('platform_qishui_login_cancel', async({ event, params }) => {
    const { state, login } = await getQrLogin()
    if (login.cancel(event.sender.id, params?.flowId)) ++state.generation
  })
  let kugouLogin: ReturnType<typeof createKugouLogin> | undefined
  const kugouOwners = new WeakSet<Electron.WebContents>()
  const getKugouLogin = async() => {
    const state = await getState('kugouConcept')
    kugouLogin ??= createKugouLogin(state.context, async() => {
      const generation = state.generation
      const profile = await state.provider.profile(state.context)
      // 只以 generation 判定账号是否已切换。这里不能再查 isActive()：
      // 凭据此时已写入，若因关窗/状态位变化而丢弃，用户扫码就白扫了。
      if (generation !== state.generation) throw new Error('登录已取消或过期，请重新扫码')
      acceptProfile(state, profile)
      state.account.connected = true
      state.account.error = ''
      void save()
      notify()
      void syncState(state)
    })
    return { state, login: kugouLogin }
  }
  mainHandle<Record<string, never>, Awaited<ReturnType<ReturnType<typeof createKugouLogin>['start']>>>('platform_kugou_login_start', async({ event }) => {
    const { state, login } = await getKugouLogin()
    if (!kugouOwners.has(event.sender)) {
      kugouOwners.add(event.sender)
      const owner = event.sender.id
      event.sender.once('destroyed', () => {
        try { if (login.cancel(owner)) ++state.generation } catch {}
      })
    }
    ++state.generation
    return login.start(event.sender.id)
  })
  mainHandle<{ flowId: string }, Awaited<ReturnType<ReturnType<typeof createKugouLogin>['check']>>>('platform_kugou_login_check', async({ event, params }) => {
    const { login } = await getKugouLogin()
    if (!params || typeof params.flowId !== 'string') throw new Error('无效的登录会话')
    return login.check(event.sender.id, params.flowId)
  })
  mainHandle<{ flowId?: string }, undefined>('platform_kugou_login_cancel', async({ event, params }) => {
    const { state, login } = await getKugouLogin()
    if (login.cancel(event.sender.id, params?.flowId)) ++state.generation
  })
  // 每日会员领取：概念版把「看广告」折算成畅听会员，可再升级为概念会员。
  mainHandle<{ upgrade?: boolean }, { received: boolean, message: string, upgraded: boolean, upgradeMessage: string, rewardedHours: number }>('platform_kugou_claim_vip', async({ params }) => {
    const state = await getState('kugouConcept')
    return exclusive(state, async() => {
      if (!state.account.connected) throw new Error('请先登录酷狗概念版')
      const claimed = await claimDayVip(state.context)
      if (!params?.upgrade) return { ...claimed, upgraded: false, upgradeMessage: '' }
      const upgraded = await upgradeDayVip(state.context).catch(error => ({ upgraded: false, message: errorMessage(error) }))
      return { ...claimed, upgraded: upgraded.upgraded, upgradeMessage: upgraded.message }
    })
  })
  mainHandle<{ query: string, kind: 'track' | 'album' | 'artist' | 'playlist', page?: number }, Awaited<ReturnType<typeof searchCatalog>>>('platform_qishui_search', async({ params }) => {
    const state = await getState('qishui')
    if (!params || typeof params.query !== 'string' || !['track', 'album', 'artist', 'playlist'].includes(params.kind)) throw new Error('无效的汽水搜索')
    return searchCatalog(state.context, params.query, params.kind, params.page ?? 1)
  })
  mainHandle<{ id: string }, Awaited<ReturnType<typeof publicPlaylist>>>('platform_qishui_playlist', async({ params }) => publicPlaylist((await getState('qishui')).context, params?.id))
  mainHandle<{ id: string }, Awaited<ReturnType<typeof getAlbumTracks>>>('platform_qishui_album', async({ params }) => getAlbumTracks((await getState('qishui')).context, params?.id))
  mainHandle<{ id: string }, Awaited<ReturnType<typeof getArtistTracks>>>('platform_qishui_artist', async({ params }) => getArtistTracks((await getState('qishui')).context, params?.id))
  mainHandle<{ id: string, mediaType?: 'track' | 'ugc_clip' }, Awaited<ReturnType<typeof getLyrics>>>('platform_qishui_lyric', async({ params }) => getLyrics((await getState('qishui')).context, params?.id, params?.mediaType))
  mainHandle<{ text: string }, Awaited<ReturnType<typeof resolveShare>>>('platform_qishui_share', async({ params }) => resolveShare((await getState('qishui')).context, params?.text))
  mainHandle<{ track: LX.Music.MusicInfoOnline, quality?: PlatformQuality, isRefresh?: boolean, allowToggleSource?: boolean, rejectedUrls?: string[], qualityFallback?: boolean }, ResolvedPlatformStream>('platform_playback_resolve', async({ params }) => {
    if (params.allowToggleSource !== false && global.lx.appSetting['player.preferredSource'] === 'auto') await initForPlayback(params?.track?.source)
    else await initBase()
    const rejectedUrls = Array.isArray(params.rejectedUrls) ? params.rejectedUrls.filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= 2048).slice(0, 16) : []
    return playback.resolve(params.track, params.quality ?? 'auto', Boolean(params.isRefresh), params.allowToggleSource !== false, { rejectedUrls, qualityFallback: Boolean(params.qualityFallback) })
  })
  mainHandle<LX.Music.MusicInfoOnline, PlatformQuality[]>('platform_playback_qualitys', async({ params }) => { await initBase(); return playback.qualitys(params) })
  mainHandle<PlatformSnapshot>('platform_accounts_snapshot', async() => { await init(); return snapshot() })
  let miguPhoneLogin: ReturnType<typeof createMiguPhoneLogin> | undefined
  const getMiguPhoneLogin = async() => {
    const state = await getState('migu')
    miguPhoneLogin ??= createMiguPhoneLogin(state.context, async() => {
      const generation = state.generation
      const profile = await state.provider.profile(state.context)
      if (generation !== state.generation) throw new Error('咪咕账号已更改，请重新登录')
      acceptProfile(state, profile)
      state.account.connected = true
      state.account.error = ''
      void save()
      notify()
      void syncState(state)
    })
    return { state, login: miguPhoneLogin }
  }
  mainHandle<{ phone: string }, MiguPhoneLoginResult>('platform_migu_phone_send', async({ params }) => {
    const { login } = await getMiguPhoneLogin()
    if (typeof params?.phone !== 'string' || params.phone.length > 20) throw new Error('无效的手机号')
    return login.sendCode(params.phone.trim())
  })
  mainHandle<{ phone: string, code: string }, MiguPhoneLoginResult>('platform_migu_phone_login', async({ params }) => {
    const { state, login } = await getMiguPhoneLogin()
    if (typeof params?.phone !== 'string' || params.phone.length > 20 || typeof params?.code !== 'string' || params.code.length > 10) throw new Error('无效的登录参数')
    ++state.generation
    const result = await login.login(params.phone.trim(), params.code.trim())
    if (!result.ok) ++state.generation
    return result
  })
  mainHandle<PlatformId, PlatformSnapshot>('platform_accounts_login', async({ params }) => openLogin(params))
  mainHandle<PlatformId | null, PlatformSnapshot>('platform_accounts_sync', async({ params }) => {
    await init()
    await Promise.all((params ? [await getState(params)] : [...states.values()].filter(state => state.account.connected || state.account.profile != null)).map(syncState))
    return snapshot()
  })
  mainHandle<{ id: string, refresh?: boolean }, PlatformPlaylistDetail>('platform_accounts_playlist', async({ params }) => getPlaylist(params))
  mainHandle<PlatformHeartbeatRequest, PlatformHeartbeatResult>('platform_netease_heartbeat', async({ params }) => getHeartbeat(params))
  mainHandle<PlatformId, PlatformSnapshot>('platform_accounts_logout', async({ params }) => {
    const state = await getState(params)
    ++state.generation
    if (params === 'qq' || params === 'netease') {
      const login = nativeLogins.get(params)
      login?.cancelAll()
      await login?.settled()
    }
    if (params === 'qishui' && qrLogin) {
      qrLogin.cancelAll()
      await qrLogin.settled()
    }
    if (params === 'bodian' && bodianLogin) {
      bodianLogin.cancelAll()
      await bodianLogin.settled()
    }
    state.window?.close()
    await exclusive(state, async() => {
      await state.provider.logout?.(state.context)
      await state.context.session.clearStorageData()
      state.account = { platform: state.provider.id, name: state.provider.name, connected: false, profile: null, lastSync: null, count: 0, error: '', canSync: !state.provider.webOnly && state.provider.syncSupported !== false, canAddToPlaylist: Boolean(state.provider.addToPlaylist), notice: state.provider.notice ?? '' }
      state.tracks = []
      state.playlists = []
      await save()
      notify()
    })
    return snapshot()
  })
  mainHandle<{ track: LX.Music.MusicInfo, liked: boolean }, PlatformLikeResult[]>('platform_accounts_like', async({ params }) => setLike(params.track, Boolean(params.liked)))
  mainHandle<{ playlistId: string, track: LX.Music.MusicInfo }, PlatformPlaylistAddResult>('platform_accounts_playlist_add', async({ params }) => addToPlaylist(params))
  mainHandle<{ source: LX.OnlineSource, songId: string | number, mediaMid?: string, albumId?: string, id?: number, quality?: PlatformQuality, qishuiMediaType?: 'track' | 'ugc_clip' }, { url: string, type: LX.Quality }>('platform_accounts_music_url', async({ params }) => getMusicUrl(params))
}
