/* Verify that the player preserves Bodian identities and account metadata across IPC. */
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
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name]
    : name === '../musicAccess' ? load('src/common/musicAccess.ts') : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file)
  return instance.exports
}
const conversions = load('src/common/utils/tools.ts')
const songId = '7694169592973822006'
const playlistId = '5:7694169592973822007'
const tracks = Array.from({ length: 401 }, (_, index) => ({
  source: 'bo',
  id: `bo_${index ? index : songId}`,
  name: `Test song ${index}`,
  singer: 'Singer',
  interval: '03:00',
  meta: {
    songId: index ? String(index) : songId,
    albumId: 'Test album', albumName: 'Album', picUrl: 'https://example.test/cover.jpg',
    isVip: true, subtitle: 'Official recording',
    qualitys: [{ type: '320k', size: null }], _qualitys: { '320k': { size: null } },
  },
}))
const requests = []
let shareKind = 'playlist'
const ipcRenderer = {
  async invoke(channel, argument) {
    requests.push({ channel, argument })
    if (channel === 'platform_bodian_search') return {
      list: argument.kind === 'track' ? [tracks[0]] : [{ id: playlistId, name: 'Playlist', cover: '', count: tracks.length }],
      total: 61, totalExact: false, page: argument.page, limit: argument.limit,
    }
    if (channel === 'platform_bodian_share') return { kind: shareKind, id: playlistId }
    if (channel === 'platform_bodian_playlist') return { name: 'Playlist', cover: '', list: tracks }
    if (channel === 'platform_bodian_lyric') return { lyric: '[00:01.00]Test lyric', tlyric: '[00:01.00]翻译' }
    if (channel === 'platform_bodian_album' || channel === 'platform_bodian_artist') return {
      list: tracks.slice((argument.page - 1) * argument.limit, argument.page * argument.limit),
      total: tracks.length, totalExact: true, page: argument.page, limit: argument.limit,
    }
    throw new Error(`Unexpected IPC: ${channel}`)
  },
}
const sdk = load('src/renderer/utils/musicSdk/bo/index.js', {
  '@common/utils/tools': conversions,
  '../platform': { getPlatformMusicUrl: async(source, songInfo, quality) => ({ source, id: songInfo.songmid, quality }) },
  electron: { ipcRenderer },
}).default
const catalog = load('src/renderer/utils/musicSdk/catalogSearch.js', {
  '../request': {}, '../index': { decodeName: value => value }, './wy/utils': {}, './tx/utils': {},
  './tx/musicSearch': {}, './kw/musicSearch': {}, './kw/util': {}, './kg/musicInfo': {}, './mg/musicInfo': {},
  '@common/utils/tools': conversions, '@common/musicAccess': {}, '@common/musicSubtitle': {}, electron: { ipcRenderer },
})

async function main() {
  const songs = await sdk.musicSearch.search('Test song', 2, 20)
  assert.deepEqual(requests.at(-1), { channel: 'platform_bodian_search', argument: { query: 'Test song', kind: 'track', page: 2, limit: 20 } })
  assert.equal(songs.allPage, 4)
  assert.equal(songs.total, 61)
  assert.equal(songs.totalExact, false)
  assert.equal(songs.list[0].songmid, songId)
  assert.deepEqual(conversions.toNewMusicInfo(songs.list[0]), tracks[0])
  const playlists = await sdk.songList.search('Playlist')
  assert.equal(playlists.totalExact, false)
  assert.equal(playlists.list[0].source, 'bo')
  assert.equal(playlists.list[0].id, playlistId)
  assert.equal(playlists.list[0].total, '401')
  const detail = await sdk.songList.getListDetail(playlistId)
  assert.equal(requests.at(-1).argument.id, playlistId)
  assert.equal(detail.total, 401)
  assert.equal(detail.limit, 401)
  assert.deepEqual(detail.list.map(conversions.toNewMusicInfo), tracks)
  assert.equal((await sdk.songList.getListDetail(playlistId, 2)).list.length, 0)
  shareKind = 'track'
  requests.length = 0
  await assert.rejects(sdk.songList.getListDetail('https://h5app.kuwo.cn/m/bodian/'), /歌单链接/)
  assert.equal(requests.some(item => item.channel === 'platform_bodian_playlist'), false)
  const lyric = await sdk.getLyric({ songmid: songId }).promise
  assert.equal(requests.at(-1).argument.id, songId)
  assert.match(lyric.lyric, /Test lyric/)
  assert.match(lyric.tlyric, /翻译/)
  assert.deepEqual(await sdk.getMusicUrl({ songmid: songId }, '320k').promise, { source: 'bo', id: songId, quality: '320k' })
  await assert.rejects(sdk.songList.getList(), /暂未提供/)
  for (const kind of ['album', 'artist']) {
    assert.ok(catalog.catalogSources[kind].includes('bo'))
    const entities = await catalog.searchCatalog('bo', kind, 'Test', 3, 18)
    assert.deepEqual(requests.at(-1).argument, { query: 'Test', kind, page: 3, limit: 18 })
    assert.equal(entities.list[0].source, 'bo')
    assert.equal(entities.list[0].id, playlistId)
    assert.equal(entities.total, 61)
    assert.equal(entities.totalExact, false)
    const works = await catalog.getCatalogTracks({ source: 'bo', kind, id: playlistId }, 2, 30)
    assert.equal(requests.at(-1).channel, `platform_bodian_${kind}`)
    assert.deepEqual(requests.at(-1).argument, { id: playlistId, page: 2, limit: 30 })
    assert.equal(works.total, 401)
    assert.equal(works.allPage, 14)
    assert.equal(works.totalExact, true)
    assert.deepEqual(works.list.map(conversions.toNewMusicInfo), tracks.slice(30, 60))
  }
  console.log('Bodian renderer contracts passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
