/* Membership metadata contracts: no network, real account or collection writes. */
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
    if (name === '../musicAccess') return load('src/common/musicAccess.ts')
    return nativeRequire(name)
  }
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file)
  return instance.exports
}
const { songVip } = load('src/common/musicAccess.ts')
const { toNewMusicInfo, toOldMusicInfo } = load('src/common/utils/tools.ts')
for (const [source, song, expected] of [
  ['wy', { fee: 1 }, true], ['wy', { privilege: { fee: 1 } }, true],
  ['wy', { fee: 0, privilege: { fee: 1 } }, false],
  ['wy', { fee: 8, hr: { size: 99 } }, false], ['wy', { fee: 4 }, false],
  ['wy', { privilege: { maxbr: 999000, chargeInfoList: [{ chargeType: 1 }] } }, undefined],
  ['tx', { pay: { pay_play: 1 } }, true], ['tx', { pay: { pay_play: 0, pay_down: 1 } }, false],
  ['tx', { file: { size_hires: 99 } }, undefined],
  ['kg', { Privilege: 10, PayType: 3 }, true], ['kg', { Privilege: 8 }, true],
  ['kg', { Privilege: 0, SQPrivilege: 10 }, false], ['kg', { HQPrivilege: 10 }, undefined],
  ['kw', { payInfo: { feeType: { vip: '1' }, play: '1111' } }, true],
  ['kw', { payInfo: { feeType: { vip: '1' }, play: '0111' } }, false],
  ['kw', { isListenFee: false }, false], ['kw', { PAY: '16711935' }, undefined],
  ['mg', { isVip: '1' }, true], ['mg', { audioFormats: [{ isVip: 1 }] }, undefined],
  ['qs', { label_info: { only_vip_playable: true } }, true],
  ['qs', { label_info: { only_vip_playable: 'false' }, playable_range: { end: 3 } }, false],
  ['bi', {}, undefined],
]) assert.equal(songVip(source, song), expected, `${source}: ${JSON.stringify(song)}`)
assert.equal(songVip('wy', {}, { fee: 1 }), true)

for (const isVip of [true, false, undefined]) {
  const old = { source: 'wy', songmid: 1, name: 'Test', singer: 'Singer', interval: '03:00', albumName: 'Album', img: '', types: [], _types: {}, ...(isVip == null ? {} : { isVip }) }
  const current = toNewMusicInfo(old)
  assert.equal(current.meta.isVip, isVip)
  assert.equal(toOldMusicInfo(current).isVip, isVip)
  if (isVip == null) assert.equal(Object.hasOwn(current.meta, 'isVip'), false, 'unknown metadata stays absent')
}

const helpers = { formatPlayTime: value => String(value), sizeFormate: value => String(value), decodeName: value => value }
const sdkDependencies = {
  '../../index': helpers,
  '../utils': { formatSingerName: list => (list ?? []).map(value => value.name).join('、') },
  '../../request': {}, './util': { formatSinger: value => value }, './utils': {}, './utils/index': {}, './utils/crypto': {},
}
const sdk = (source, file) => load(`src/renderer/utils/musicSdk/${source}/${file}.js`, sdkDependencies)
const qqSong = { id: 1, mid: 'mid', title: 'Test', singer: [{ name: 'Singer' }], album: { id: 2, mid: 'album', name: 'Album' }, file: { media_mid: 'media', size_128mp3: 1, size_320mp3: 0, size_flac: 0, size_hires: 0 }, pay: { pay_play: 1 } }
assert.equal(toNewMusicInfo(sdk('tx', 'musicSearch').default.handleResult([qqSong])[0]).meta.isVip, true)
assert.equal(sdk('tx', 'singer').filterMusicInfoItem(qqSong).isVip, true)
const wySong = { id: 1, name: 'Test', ar: [{ name: 'Singer' }], al: { id: 2, name: 'Album' }, dt: 180000, privilege: { maxbr: 128000, fee: 1 } }
assert.equal(sdk('wy', 'musicSearch').default.handleResult([{ baseInfo: { simpleSongData: wySong } }])[0].isVip, true)
assert.equal(sdk('wy', 'musicDetail').default.filterList({ songs: [{ ...wySong, privilege: undefined }], privileges: [{ id: 1, maxbr: 128000, fee: 1 }] })[0].isVip, true)
const kgSong = { Audioid: 1, OriSongName: 'Test', Singers: [], FileHash: 'hash', FileSize: 1, HQFileSize: 0, SQFileSize: 0, ResFileSize: 0, Privilege: 10 }
assert.equal(sdk('kg', 'musicSearch').default.filterData(kgSong).isVip, true)
const kwSong = { MUSICRID: 'MUSIC_1', SONGNAME: 'Test', ARTIST: 'Singer', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:1', DURATION: '180', payInfo: { feeType: { vip: '1' }, play: '1111' } }
assert.equal(sdk('kw', 'musicSearch').default.handleResult([kwSong])[0].isVip, true)
assert.equal(sdk('mg', 'musicInfo').filterMusicInfoListV5([{ songId: '1', songName: 'Test', isVIP: '1', singerList: [], audioFormats: [] }])[0].isVip, true)

async function favoritesMigration() {
  const track = (source, id, isVip) => ({ id, source, name: 'Test', singer: 'Singer', interval: '03:00', meta: { songId: id, albumName: 'Keep local album', qualitys: [], _qualitys: {}, ...(isVip == null ? {} : { isVip }) } })
  let saved = [track('wy', 'wy_1'), track('tx', 'tx_2', true), track('kw', 'kw_3', true)]
  const updates = []
  const remote = [track('wy', 'wy_1', true), track('tx', 'tx_2', false), track('kg', 'kg_3', false), track('kw', 'kw_3')]
  const ref = value => ({ value })
  const listeners = new Map()
  const oldLocalStorage = global.localStorage
  const oldWindow = global.window
  global.localStorage = { getItem: () => null, setItem() {} }
  global.window = { app_event: { on() {}, off() {} } }
  try {
    const service = load('src/renderer/ui/services/platformAccounts.ts', {
      electron: { ipcRenderer: { on: (name, listener) => listeners.set(name, listener), removeListener() {}, invoke: async() => ({ accounts: [], favorites: remote.map(track => ({ track })) }) } },
      vue: { ref, shallowRef: ref, computed: fn => ({ get value() { return fn() } }) },
      '@common/platformMatching': { sameRecording: (a, b) => a.name === b.name },
      '@renderer/store/list/state': { loveList: { id: 'love' } },
      '@renderer/store/list/action': {
        getListMusics: async() => saved,
        removeListMusics: async() => assert.fail('no removal expected'),
        addListMusics: async() => assert.fail('same recording must remain deduplicated'),
        updateListMusics: async items => { updates.push(...items); saved = saved.map(track => items.find(item => item.musicInfo.id === track.id)?.musicInfo ?? track) },
      },
      './qishuiLogin': { closeQishuiLogin() {} },
    })
    await service.initializePlatformAccounts()
    assert.deepEqual(updates.map(item => [item.musicInfo.id, item.musicInfo.meta.isVip]), [['wy_1', true], ['tx_2', false]])
    assert.equal(service.favoriteTracks.value[2].meta.isVip, true, 'unknown remote and matching other-platform records must not erase or copy membership')
    assert.equal(saved[0].meta.albumName, 'Keep local album')
    service.disposePlatformAccounts()
  } finally { global.localStorage = oldLocalStorage; global.window = oldWindow }
}
favoritesMigration().then(() => console.log('Music membership metadata, SDK conversion and favorites migration contracts passed.')).catch(error => { console.error(error); process.exitCode = 1 })
