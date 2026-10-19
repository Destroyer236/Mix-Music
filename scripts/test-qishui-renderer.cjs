/* Renderer IPC contracts, with no network requests or account credentials. */
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
const id = '7694169592973822006'
const track = {
  source: 'qs',
  id: `qs_${id}`,
  name: 'Test song',
  singer: 'Singer',
  interval: '03:00',
  meta: { songId: id, albumId: '7694169592973822007', albumName: 'Album', picUrl: 'https://example.test/cover.jpg', qualitys: [{ type: '128k', size: null }], _qualitys: { '128k': { size: null } } },
}
let lastRequest
let lastPlaybackRequest
const requests = []
let shareKind = 'playlist'
const platform = load('src/renderer/utils/musicSdk/platform.js', {
  electron: {
    ipcRenderer: {
      async invoke(channel, argument) {
        lastPlaybackRequest = { channel, argument }
        return { source: argument.source, id: argument.songId, quality: argument.quality }
      },
    },
  },
})
const sdk = load('src/renderer/utils/musicSdk/qs/index.js', {
  '@common/utils/tools': conversions,
  '../platform': platform,
  electron: {
    ipcRenderer: {
      async invoke(channel, argument) {
        requests.push(channel)
        lastRequest = { channel, argument }
        if (channel === 'platform_qishui_search') return { list: argument.kind === 'track' ? [track] : [{ id, name: 'Playlist', cover: '', count: 500 }], total: 1, page: 1, limit: 30, limited: true }
        if (channel === 'platform_qishui_share') return { kind: shareKind, id }
        if (channel === 'platform_qishui_playlist') return { name: 'Playlist', cover: '', list: [track] }
        if (channel === 'platform_qishui_lyric') return { lyric: '[00:01.00]Test lyric' }
        throw new Error(`Unexpected IPC: ${channel}`)
      },
    },
  },
}).default

async function main() {
  const songs = await sdk.musicSearch.search('Test song')
  assert.equal(lastRequest.argument.kind, 'track')
  assert.equal(songs.list[0].songmid, id)
  assert.deepEqual(conversions.toNewMusicInfo(songs.list[0]), track)
  assert.match(songs.notice, /有限结果/)
  assert.equal(songs.allPage, 1)
  const playlists = await sdk.songList.search('Playlist')
  assert.equal(playlists.list[0].source, 'qs')
  assert.equal(playlists.list[0].id, id)
  assert.equal(playlists.list[0].total, '500')
  const detail = await sdk.songList.getListDetail(id)
  assert.equal(detail.total, 1)
  assert.equal(detail.limit, 1)
  assert.deepEqual(conversions.toNewMusicInfo(detail.list[0]), track)
  for (const mediaType of ['track', 'ugc_clip']) {
    const typedTrack = { ...track, meta: { ...track.meta, qishuiMediaType: mediaType } }
    const legacy = conversions.toOldMusicInfo(typedTrack)
    assert.equal(legacy.qishuiMediaType, mediaType)
    assert.deepEqual(conversions.toNewMusicInfo(legacy), typedTrack, 'Qishui media type must survive the catalog/player conversion')
  }
  assert.equal(Object.hasOwn(conversions.toOldMusicInfo(track), 'qishuiMediaType'), false, 'Old records must keep their existing shape')
  for (const mediaType of ['ugc_video', '', null, { type: 'ugc_clip' }]) {
    const typedTrack = { ...track, meta: { ...track.meta, qishuiMediaType: mediaType } }
    const legacy = conversions.toOldMusicInfo(typedTrack)
    assert.equal(Object.hasOwn(legacy, 'qishuiMediaType'), false)
    legacy.qishuiMediaType = mediaType
    assert.equal(Object.hasOwn(conversions.toNewMusicInfo(legacy).meta, 'qishuiMediaType'), false, 'Unsupported media types must not enter Qishui metadata')
  }
  const otherTrack = { ...track, source: 'wy', meta: { ...track.meta, qishuiMediaType: 'ugc_clip' } }
  const otherLegacy = conversions.toOldMusicInfo(otherTrack)
  assert.equal(Object.hasOwn(otherLegacy, 'qishuiMediaType'), false)
  otherLegacy.qishuiMediaType = 'ugc_clip'
  assert.equal(Object.hasOwn(conversions.toNewMusicInfo(otherLegacy).meta, 'qishuiMediaType'), false)
  assert.equal((await sdk.songList.getListDetail(id, 2)).list.length, 0)
  shareKind = 'track'
  requests.length = 0
  await assert.rejects(sdk.songList.getListDetail('https://www.qishui.com/share/track'), /歌单链接/)
  assert.equal(requests.includes('platform_qishui_playlist'), false)
  const lyric = await sdk.getLyric({ songmid: id }).promise
  assert.deepEqual(lastRequest.argument, { id })
  assert.match(lyric.lyric, /Test lyric/)
  for (const mediaType of ['track', 'ugc_clip']) {
    await sdk.getLyric({ songmid: id, qishuiMediaType: mediaType }).promise
    assert.deepEqual(lastRequest.argument, { id, mediaType })
  }
  assert.deepEqual(await sdk.getMusicUrl({ songmid: id }, '128k').promise, { source: 'qs', id, quality: '128k' })
  assert.deepEqual(lastPlaybackRequest, {
    channel: 'platform_accounts_music_url',
    argument: { source: 'qs', songId: id, mediaMid: undefined, albumId: undefined, id: undefined, quality: '128k' },
  })
  for (const mediaType of ['track', 'ugc_clip']) {
    const typedTrack = { ...track, meta: { ...track.meta, qishuiMediaType: mediaType } }
    await sdk.getMusicUrl(conversions.toOldMusicInfo(typedTrack), '128k').promise
    assert.equal(lastPlaybackRequest.channel, 'platform_accounts_music_url')
    assert.equal(lastPlaybackRequest.argument.songId, id)
    assert.equal(lastPlaybackRequest.argument.qishuiMediaType, mediaType, 'Playback IPC must preserve Qishui media type through the real legacy adapter')
  }
  for (const mediaType of ['ugc_video', '', null, undefined, { type: 'ugc_clip' }]) {
    await platform.getPlatformMusicUrl('qs', { songmid: id, qishuiMediaType: mediaType }, '128k')
    assert.equal(Object.hasOwn(lastPlaybackRequest.argument, 'qishuiMediaType'), false, 'Invalid Qishui media types must not cross playback IPC')
  }
  for (const source of ['wy', 'tx']) {
    for (const mediaType of ['track', 'ugc_clip']) {
      await platform.getPlatformMusicUrl(source, { songmid: id, qishuiMediaType: mediaType }, '128k')
      assert.equal(Object.hasOwn(lastPlaybackRequest.argument, 'qishuiMediaType'), false, 'Other sources must retain their existing playback payload')
    }
  }
  assert.equal(new URL(sdk.getMusicDetailPageUrl({ songmid: id })).searchParams.get('track_id'), id)
  await assert.rejects(sdk.songList.getList(), /暂未提供/)
  console.log('Qishui renderer contracts passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
