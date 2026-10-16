/* Bodian adapter contracts. Synthetic accounts only; no real platform writes. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
let handler
const requests = []
const net = { request(options) {
  const emitter = new EventEmitter()
  const headers = {}
  emitter.setHeader = (name, value) => { headers[name] = value }
  emitter.abort = () => { emitter.cancelled = true }
  emitter.end = body => {
    const call = { ...options, url: new URL(options.url), body, headers }
    requests.push(call)
    Promise.resolve().then(() => handler(call)).then(result => {
      if (emitter.cancelled) return
      const response = new EventEmitter()
      response.statusCode = 200
      emitter.emit('response', response)
      response.emit('data', Buffer.from(JSON.stringify(result)))
      response.emit('end')
    }).catch(error => emitter.emit('error', error))
  }
  return emitter
} }
const loaded = new Map()
function load(file) {
  file = path.resolve(file)
  if (loaded.has(file)) return loaded.get(file).exports
  const instance = new Module(file, module)
  loaded.set(file, instance)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => name === 'electron' ? { net } : name.startsWith('./bodian') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : nativeRequire(name)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  instance._compile(code, file)
  return instance.exports
}
const dir = path.join(root, 'src/main/modules/platformAccounts/providers')
const api = load(path.join(dir, 'bodianApi.ts'))
const provider = load(path.join(dir, 'bodian.ts'))
const success = data => ({ code: 200, data })
const song = { id: 101, name: 'Test', artist: 'Singer', album: 'Album', duration: 180, audios: [{ format: 'mp3', bitrate: '128' }, { format: 'mp3', bitrate: '320' }, { format: 'flac', bitrate: '2000' }], payInfo: { play: '1111', feeType: { vip: '1' } } }
const profile = { id: '123', nickname: 'Synthetic account', avatar: '' }
const cookies = { linkline_bodian_device: 'a'.repeat(32), linkline_bodian_uid: '123', linkline_bodian_token: 'fixture-only', linkline_bodian_nickname: encodeURIComponent(profile.nickname) }
const context = { cookies: async() => ({ ...cookies }), session: { cookies: { set: async() => {} } } }

async function main() {
  assert.equal(api.toTrack(song).source, 'bo')
  assert.equal(api.toTrack(song).meta.isVip, true)
  assert.equal(api.toTrack({ ...song, payInfo: { play: '0111', feeType: { vip: '1' } } }).meta.isVip, false)
  assert.equal(api.itemId(2 ** 54), '')
  assert.equal(api.mediaUrl('file:///C:/test.mp3'), '')
  assert.equal(api.mediaUrl('https://name:pass@example.com/test.mp3'), '')
  const first = new URLSearchParams({ uid: '-1', token: '', timestamp: '123' })
  assert.notEqual(api.signRequest('/api/test', first, '{"id":1}'), api.signRequest('/api/test', first, '{"id":2}'))
  handler = call => {
    assert.equal(call.method, 'GET')
    assert.equal(call.body, '{"musicId":101,"freeSign":""}')
    assert.equal(call.url.searchParams.get('uid'), '123')
    assert.equal(call.headers.token, 'fixture-only')
    const query = new URLSearchParams(call.url.searchParams)
    const signature = query.get('sign')
    query.delete('sign')
    assert.equal(signature, api.signRequest(call.url.pathname, query, call.body))
    return success({ status: 1 })
  }
  await api.request(context, '/api/play/music/v2/checkRight', { query: { musicId: 101, freeSign: '' }, body: { musicId: 101, freeSign: '' }, signed: true })
  handler = call => { assert.equal(call.url.searchParams.get('uid'), '-1'); assert.equal(call.headers.token, undefined); return success({ qrCode: 'synthetic' }) }
  await api.request(context, '/api/ucenter/login/qrCode', { anonymous: true, signed: true })
  handler = () => ({ code: 11012 })
  await assert.rejects(api.request(context, '/api/test'), /登录状态已失效/)
  handler = () => ({ code: 407 })
  await assert.rejects(api.request(context, '/api/test'), /中国大陆/)
  handler = call => success({ resultList: [{ id: 333, name: 'Playlist', source: 5 }], total: 1 })
  const catalog = await provider.searchCatalog(context, 'Test', 'playlist')
  assert.equal(catalog.list[0].id, '5:333')
  assert.equal(catalog.totalExact, false, 'a page-sized total is not advertised as the platform total')
  handler = () => success({ resultList: Array.from({ length: 30 }, (_, index) => ({ ...song, id: index + 101 })), total: 30 })
  const firstSearchPage = await provider.searchCatalog(context, 'Test', 'track', 1)
  assert.equal(firstSearchPage.total, 31)
  assert.equal(firstSearchPage.totalExact, false)
  const secondSearchPage = await provider.searchCatalog(context, 'Test', 'track', 2)
  assert.equal(secondSearchPage.total, 61)
  assert.equal(secondSearchPage.totalExact, false)
  handler = () => success({ resultList: [song], total: 90 })
  const knownSearchTotal = await provider.searchCatalog(context, 'Test', 'track')
  assert.equal(knownSearchTotal.total, 90)
  assert.equal(knownSearchTotal.totalExact, true)
  const beforeEmptySearch = requests.length
  assert.deepEqual(await provider.searchCatalog(context, '', 'track'), { list: [], total: 0, totalExact: true, page: 1, limit: 30, limited: false })
  assert.equal(requests.length, beforeEmptySearch)
  const pageCalls = []
  handler = call => {
    assert.equal(call.url.searchParams.get('source'), '5')
    if (call.url.pathname.includes('/info/')) return success({ id: 333, name: 'Playlist' })
    const page = Number(call.url.searchParams.get('pn'))
    pageCalls.push(page)
    // Missing/hidden entries do not change the next upstream page number.
    return success({ list: page === 1 ? [song] : [{ ...song, id: 102 }], total: 101 })
  }
  assert.equal((await provider.publicPlaylist(context, '5:333')).list.length, 2)
  assert.deepEqual(pageCalls, [1, 2])
  let unknownPages = 0
  handler = call => {
    if (call.url.pathname.includes('/info/')) return success({ id: 333 })
    unknownPages++
    return success({ list: unknownPages < 3 ? [{ ...song, id: 100 + unknownPages }] : [] })
  }
  assert.equal((await provider.publicPlaylist(context, '333')).list.length, 2)
  assert.equal(unknownPages, 3)
  handler = call => call.url.pathname.includes('/info/') ? success({ id: 333 }) : success({ list: [song], total: 201 })
  await assert.rejects(provider.publicPlaylist(context, '333'), /分页重复/)
  handler = call => call.url.pathname.endsWith('/checkRight') ? success({ status: 3, audition: { https: 'https://audio.example/preview.mp3', start: 0, end: 29 } }) : assert.fail('Preview must not call the full-stream endpoint')
  const preview = await provider.default.musicUrl(context, api.toTrack(song), 'auto')
  assert.equal(preview.isTrial, true)
  assert.equal(preview.type, '128k')
  handler = call => {
    if (call.url.pathname.endsWith('/checkRight')) return success({ status: 1 })
    assert.equal(call.method, 'GET')
    assert.equal(JSON.parse(call.body).format, 'flac')
    assert.equal(JSON.parse(call.body).br, '2000kflac')
    return success({ audioHttpsUrl: 'https://audio.example/full.flac', format: 'flac', bitrate: 2000 })
  }
  const full = await provider.default.musicUrl(context, api.toTrack(song), 'auto')
  assert.equal(full.quality, 'flac')
  assert.notEqual(full.isTrial, true)
  handler = () => success({ status: 7 })
  await assert.rejects(provider.default.musicUrl(context, api.toTrack(song), 'auto'), /完整播放权限/)
  let writes = 0
  handler = call => {
    if (call.url.pathname.endsWith('/fond')) return success({ id: 444 })
    if (call.url.pathname.endsWith('/musicList')) return success({ list: [song], total: 1 })
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/api/service/playlist/music')
    assert.deepEqual(JSON.parse(call.body), { playListId: 444, musicIdList: [101] })
    writes++
    return success({})
  }
  await provider.default.like(context, profile, api.toTrack(song), true)
  assert.equal(writes, 1)
  await assert.rejects(provider.default.like(context, { ...profile, id: '999' }, api.toTrack(song), true), /账号已变化/)
  assert.equal(writes, 1)
  handler = call => call.url.pathname.endsWith('/fond') ? success({ id: 444 }) : call.url.pathname.endsWith('/musicList') ? success({ list: [], total: 0 }) : success({})
  await assert.rejects(provider.default.like(context, profile, api.toTrack(song), true), /尚未确认红心更改/)
  handler = () => ({ code: -101 })
  await assert.rejects(provider.default.profile(context), /登录状态已失效/)
  handler = call => call.url.pathname.endsWith('/checkRight') ? success({ status: 1 }) : success({ audioHttpsUrl: 'https://audio.example/fallback.mp3', format: 'mp3', bitrate: 320 })
  assert.equal((await provider.default.musicUrl(context, api.toTrack(song), 'auto')).quality, '320k')
  const shared = await provider.resolveShare(context, 'https://h5app.kuwo.cn/m/bodian/collection.html?playlistId=333&source=5')
  assert.deepEqual(shared, { kind: 'playlist', id: '5:333' })
  await assert.rejects(provider.resolveShare(context, 'https://evil.example/bodian/?playlistId=333'), /官方分享/)
  handler = () => success({ content: Buffer.from('[kuwo:046]\n[00:01.20]<100,-100>Hello').toString('base64') })
  assert.equal((await provider.getLyrics(context, '101')).lyric, '[00:01.20]Hello')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(api.request(context, '/api/test', { signal: controller.signal }), /取消/)
  console.log('Bodian contracts passed: protocol signing, QR anonymity, pagination/source, rights/preview, quality, safe likes and lyrics.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
