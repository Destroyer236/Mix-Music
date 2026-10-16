/* Qishui adapter contract tests. No real account credentials or collection writes. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const loaded = new Map()
function load(file) {
  file = path.resolve(file)
  if (loaded.has(file)) return loaded.get(file).exports
  const instance = new Module(file, module)
  loaded.set(file, instance)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => name.startsWith('./qishui') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : nativeRequire(name)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  instance._compile(code, file)
  return instance.exports
}
const directory = path.join(root, 'src/main/modules/platformAccounts/providers')
const api = load(path.join(directory, 'qishuiApi.ts'))
const provider = load(path.join(directory, 'qishui.ts'))
const id = '7694169592973822006'
const playlistId = '7581510362882670630'
const track = { id, name: 'Test { track }', duration: 180000, artists: [{ id: '1234', name: 'Singer' }], album: { id: '5678', name: 'Album', url_cover: { urls: ['https://image.example/cover.jpg'] } } }
const json = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const context = handler => ({ cookies: async() => ({}), session: { fetch: async(url, options) => handler(new URL(url), options) } })
const html = option => `<script>window._ROUTER_DATA = ${JSON.stringify({ loaderData: { track_page: { audioWithLyricsOption: { status_code: 0, trackInfo: track, track_id: id, hasCopyright: true, encrypt: false, previewStart: 0, previewEnd: 0, url: 'https://v5.example.douyinvod.com/token/ffffffff/audio?mime_type=audio_mp4', ...option } } } })};</script>`

async function main() {
  assert.equal(api.itemId(id), id)
  assert.equal(api.itemId(Number(id)), '')
  assert.equal(api.toTrack({ entity: { track_wrapper: { track } } }).meta.songId, id)
  assert.equal(api.toTrack({ entity: { ranked_track: { track } } }).singer, 'Singer')
  const fixture = { nested: [{ value: 'a } \\" [ b' }], unicode: '歌曲' }
  assert.deepEqual(api.extractRouterData(`<script>window._ROUTER_DATA = ${JSON.stringify(fixture)};</script>`), fixture)
  assert.throws(() => api.extractRouterData('window._ROUTER_DATA = {x: process.exit()}'), /数据不完整/)
  assert.throws(() => api.extractRouterData('window._ROUTER_DATA = (() => ({}))()'), /数据格式错误/)
  await assert.rejects(api.request(context(() => new Response('')), '/luna/pc/me'), /暂未返回内容/)
  await assert.rejects(api.request(context(() => json({ status_code: 1000016 })), '/luna/pc/me'), /登录状态已失效/)
  await assert.rejects(api.request(context(() => json({}, 200, { 'bdturing-verify': 'challenge' })), '/luna/pc/me'), /安全验证/)

  const visited = []
  const paginated = context(url => {
    visited.push(url)
    const second = url.searchParams.get('cursor') === 'next'
    if (second) assert.equal(url.searchParams.get('session_id'), 'session-1')
    return json({ playlist: { id: playlistId, title: 'Shared playlist', count_tracks: 2 }, media_resources: [{ entity: { track_wrapper: { track: second ? { ...track, id: '7694169592973822007' } : track } } }], has_more: !second, next_cursor: second ? '' : 'next', session_id: 'session-1' })
  })
  const list = await provider.publicPlaylist(paginated, playlistId)
  assert.equal(visited.length, 2)
  assert.equal(list.list.length, 2)
  assert.equal(list.list[0].meta.songId, id)
  await assert.rejects(provider.publicPlaylist(context(() => json({ playlist: { id: playlistId }, tracks: [track], has_more: true, next_cursor: 'repeat' })), playlistId), /分页不完整/)
  let likedPlaylist = ''
  const library = context(url => {
    if (url.pathname === '/luna/pc/me/playlist') return json({ playlists: [{ id: playlistId, title: 'Like', type: 1 }, { id: '7581510362882670631', title: 'Created', type: 2 }], has_more: false })
    likedPlaylist = url.searchParams.get('playlist_id')
    return json({ playlist: { id: playlistId, count_tracks: 1 }, tracks: [track], has_more: false })
  })
  assert.equal((await provider.default.likes(library, { id: '123' })).length, 1)
  assert.equal(likedPlaylist, playlistId)
  assert.equal((await provider.default.playlists(library, { id: '123' }))[0].name, 'Created')

  // Authenticated fixtures span more than one 100-song/playlist page.
  const bulkTracks = Array.from({ length: 237 }, (_, index) => ({ ...track, id: String(7694169592973822000n + BigInt(index)) }))
  let bulkPages = 0
  const authenticatedBulk = context(url => {
    assert.equal(url.searchParams.get('count'), '100')
    const cursor = url.searchParams.get('cursor') || ''
    if (url.pathname === '/luna/pc/me/playlist') {
      if (!cursor) return json({ playlists: [{ id: playlistId, type: 1, title: 'Like' }, ...Array.from({ length: 99 }, (_, index) => ({ id: String(7581510362882671000n + BigInt(index)), type: 2, title: `Created ${index}` }))], has_more: true, next_cursor: 'folders-2' })
      assert.equal(cursor, 'folders-2')
      return json({ playlists: [{ id: '7581510362882671999', type: 2, title: 'Last' }], has_more: false })
    }
    const offset = Number(cursor) || 0
    if (offset) assert.equal(url.searchParams.get('session_id'), 'bulk-session')
    bulkPages++
    return json({ playlist: { id: playlistId, count_tracks: 237 }, tracks: bulkTracks.slice(offset, offset + 100), has_more: offset + 100 < bulkTracks.length, next_cursor: String(offset + 100), session_id: 'bulk-session' })
  })
  authenticatedBulk.cookies = async() => ({ sessionid: 'fixture-only' })
  const bulkLikes = await provider.default.likes(authenticatedBulk, { id: '123' })
  assert.equal(bulkLikes.length, 237)
  assert.equal(bulkPages, 3)
  assert.equal(bulkLikes.at(-1).meta.songId, bulkTracks.at(-1).id)
  assert.equal((await provider.default.playlists(authenticatedBulk, { id: '123' })).length, 100)

  const album = await provider.getAlbumTracks(context(url => {
    assert.equal(url.pathname, '/luna/pc/albums/5678')
    assert.equal(url.searchParams.get('ignore_tracks'), 'false')
    return json({ album_info: { id: '5678', name: 'Album fixture' }, tracks: [track] })
  }), '5678')
  assert.equal(album.name, 'Album fixture')
  assert.equal(album.list.length, 1)
  const artist = await provider.getArtistTracks(context(url => {
    if (url.pathname === '/luna/pc/artists/1234') return json({ artist_info: { id: '1234', name: 'Artist fixture' } })
    assert.equal(url.pathname, '/luna/pc/artists/1234/tracks')
    const second = url.searchParams.get('cursor') === 'artist-2'
    return json({ tracks: [second ? { ...track, id: '7694169592973822007' } : track], has_more: !second, next_cursor: 'artist-2' })
  }), '1234')
  assert.equal(artist.name, 'Artist fixture')
  assert.equal(artist.list.length, 2)

  const fullSearch = await provider.searchCatalog(context((url, options) => {
    assert.equal(url.pathname, '/luna/h5/search/track')
    assert.equal(url.searchParams.get('search_method'), 'track')
    assert.deepEqual(JSON.parse(options.body), {})
    assert.match(options.headers.get('x-ss-stub'), /^[A-F0-9]{32}$/)
    return json({ result_groups: [{ id: 'tracks', data: [{ entity: { track_wrapper: { track } } }], has_more: false }] })
  }), 'test', 'track')
  assert.equal(fullSearch.limited, false)
  assert.equal(fullSearch.list[0].meta.songId, id)
  const limited = await provider.searchCatalog(context(url => url.pathname.includes('/search/') ? json({ status_code: 1000016 }) : json({ sugs: [{ suggestion: 'Suggestion', content_type: 'track', entity: { track: { id } } }, { suggestion: 'not a track', content_type: 'query' }] })), 'test', 'track')
  assert.equal(limited.limited, true)
  assert.equal(limited.list.length, 1)
  assert.equal(limited.list[0].name, 'Suggestion')
  let activeShares = 0
  let maximumShares = 0
  let shareRequests = 0
  const enriched = await provider.searchCatalog(context(async url => {
    if (url.pathname.includes('/search/')) return json({ status_code: 1000016 })
    if (url.pathname === '/luna/pc/sug') return json({ sugs: Array.from({ length: 36 }, (_, index) => ({ suggestion: `Suggestion ${index}`, content_type: 'track', entity: { track: { id: String(BigInt(id) + BigInt(index)) } } })) })
    const sharedId = url.searchParams.get('track_id')
    shareRequests++
    activeShares++
    maximumShares = Math.max(maximumShares, activeShares)
    try {
      await new Promise(resolve => setTimeout(resolve, 5))
      if (sharedId === String(BigInt(id) + 1n)) throw Error('Metadata temporarily unavailable')
      return new Response(html({ trackInfo: { ...track, id: sharedId } }))
    } finally { activeShares-- }
  }), 'test', 'track')
  assert.equal(enriched.limited, true)
  assert.equal(enriched.list.length, 30)
  assert.equal(shareRequests, 30)
  assert.equal(maximumShares, 3)
  assert.equal(enriched.list[0].meta.songId, id)
  assert.equal(enriched.list[0].singer, 'Singer')
  assert.equal(enriched.list[0].interval, '03:00')
  assert.equal(enriched.list[0].meta.albumName, 'Album')
  assert.equal(enriched.list[0].meta.picUrl, 'https://image.example/cover.jpg')
  assert.equal(enriched.list[1].name, 'Suggestion 1')
  assert.equal(enriched.list[1].singer, '未知歌手')
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(20)])
  const basic = context(url => url.hostname === 'www.qishui.com' ? new Response(html({})) : new Response(mp4, { status: 206, headers: { 'Content-Type': 'audio/mp4' } }))
  assert.equal((await api.shareAudio(basic, id)).url.startsWith('https:'), true)
  for (const [option, reason] of [[{ encrypt: true }, /受保护/], [{ encrypt: '1' }, /受保护/], [{ kid: 'protected-key-id' }, /受保护/], [{ hasCopyright: false }, /版权/], [{ hasCopyright: 'false' }, /版权/], [{ is_digital_track: true }, /数字专辑授权/], [{ previewEnd: 30 }, /仅可试听/], [{ previewStart: 10 }, /仅可试听/], [{ trackInfo: { ...track, playable_range: { is_preview: true } } }, /仅可试听/], [{ trackInfo: { ...track, preview: '1' } }, /仅可试听/], [{ trackInfo: { ...track, label_info: { only_vip_playable: true } } }, /仅可试听/], [{ trackInfo: { ...track, audition_info: { is_trial: 'true' } } }, /仅可试听/], [{ trackInfo: { ...track, id: '111' } }, /编号不一致/], [{ url: 'https://unrelated.example/private' }, /未返回可用/], [{ url: 'https://v5.example.douyinvod.com/token/00000001/audio' }, /已过期/]]) {
    await assert.rejects(api.shareAudio(context(() => new Response(html(option))), id), reason)
  }
  // Official player does not use these clip ranges to restrict listening.
  await api.shareAudio(context(() => new Response(html({ trackInfo: { ...track, playable_range: { start: 12000, duration: 40000 }, preview: { start: 60000, duration: 30000 } } }))), id)
  const protectedMetadata = context(() => new Response(html({ encrypt: true, lyrics: { sentences: [{ text: 'Still readable', startMs: 0 }] } })))
  assert.equal((await provider.getShareTrack(protectedMetadata, id)).name, track.name)
  assert.match((await provider.getLyrics(protectedMetadata, id)).lyric, /Still readable/)
  assert.equal(await provider.default.available(protectedMetadata, api.toTrack(track)), true)
  const stream = await provider.default.musicUrl(basic, api.toTrack(track), 'auto')
  assert.ok(stream.expires > 0 && stream.expires <= 180)
  assert.equal(stream.qualityLabel, '分享音频（平台提供）')
  let cancelled = false
  await api.probeAudio(context((url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-1023')
    assert.equal(options.credentials, 'omit')
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.concat([mp4, Buffer.alloc(4096)])) }, cancel() { cancelled = true } }), { headers: { 'Content-Type': 'audio/mp4' } })
  }), 'https://v5.example.douyinvod.com/audio')
  assert.equal(cancelled, true)
  await assert.rejects(api.probeAudio(context(() => { throw Error('network failure') }), 'https://v5.example.douyinvod.com/audio'), /无法连接/)
  await assert.rejects(api.probeAudio(context(() => new Response('<html>Not audio</html>', { headers: { 'Content-Type': 'audio/mp4' } })), 'https://v5.example.douyinvod.com/audio'), /不是可识别音频/)
  await assert.rejects(provider.default.musicUrl(context(url => url.hostname === 'www.qishui.com' ? new Response(html({})) : new Response('denied', { status: 403 })), api.toTrack(track), 'auto'), /音频不可用/)
  assert.equal(api.toLyrics({ lyrics: { sentences: [{ text: 'First', startMs: 12345 }, { text: 'Second', startMs: 60000 }] } }).lyric, '[00:12.34]First\n[01:00.00]Second')
  assert.deepEqual(await provider.resolveShare(context(() => { throw Error('must not fetch') }), `https://www.qishui.com/share/playlist?playlist_id=${playlistId}`), { kind: 'playlist', id: playlistId })
  await assert.rejects(provider.resolveShare(context(() => json({})), 'https://qishui.douyin.com.evil.test/s/abc/'), /官方 HTTPS/)
  await assert.rejects(provider.resolveShare(context(() => new Response('', { status: 302, headers: { location: 'https://localhost/internal' } })), 'https://qishui.douyin.com/s/abc/'), /官方 HTTPS/)
  const profile = { id: '123', nickname: 'Test' }
  const ourTrack = api.toTrack(track)
  let mutation = null
  const writeContext = context((url, options) => {
    if (url.pathname === '/luna/pc/me') return json({ my_info: { id: profile.id, nickname: 'Test' } })
    mutation = { path: url.pathname, body: JSON.parse(options.body) }
    return json(url.pathname.endsWith('/delete') ? { deleted_tracks: [id] } : { track_ids: [id] })
  })
  await provider.default.like(writeContext, profile, ourTrack, true)
  assert.deepEqual(mutation, { path: '/luna/me/collection/track', body: { track_ids: [id] } })
  await provider.default.like(writeContext, profile, ourTrack, false)
  assert.equal(mutation.path, '/luna/me/collection/track/delete')
  await assert.rejects(provider.default.like(context(url => json(url.pathname === '/luna/pc/me' ? { my_info: { id: profile.id } } : {})), profile, ourTrack, true), /未确认收藏操作/)
  console.log('Qishui adapter regression tests passed (IDs, pagination, search fallback, receipts, share permissions and links).')
  if (process.argv.includes('--live')) {
    const live = { cookies: async() => ({}), session: { fetch } }
    const search = await provider.searchCatalog(live, '晴天', 'track')
    const audio = await api.sharePage(live, id)
    const lyrics = api.toLyrics(audio.option)
    let playback
    try { await api.probeAudio(live, audio.option.url); playback = { audioHost: new URL(audio.option.url).host } } catch (error) { playback = { error: error.message } }
    console.log(JSON.stringify({ publicSearchCount: search.list.length, limited: search.limited, searchTracks: search.list.map(item => ({ id: item.meta.songId, name: item.name, singer: item.singer, interval: item.interval, hasCover: Boolean(item.meta.picUrl) })), shareTitle: audio.info.name, copyright: audio.option.hasCopyright, encrypt: audio.option.encrypt, previewStart: audio.option.previewStart, previewEnd: audio.option.previewEnd, playableRange: audio.info.playable_range, lyricRows: lyrics.lyric.split('\n').length, playback }))
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
