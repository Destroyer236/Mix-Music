const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/ui/services/localLibraryGroups.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleUnderTest = { exports: {} }
vm.runInNewContext(compiled, { module: moduleUnderTest, exports: moduleUnderTest.exports })
const { buildLocalLibraryIndex, filterLocalLibraryTracks } = moduleUnderTest.exports
const plain = value => JSON.parse(JSON.stringify(value))
const ids = value => Array.from(value, track => track.id)
const track = (id, name, singer, albumName, filePath) => ({ id, name, singer, source: 'local', interval: '03:50', meta: { albumName, filePath, songId: filePath, ext: 'flac' } })

test('artist classification separates collaborators while preserving AC/DC and deduplicating names', () => {
  const tracks = [
    track('duet', '合作曲', ' 周杰伦 、  Ｆｅｉ / 周杰伦，张靓颖；陈奕迅', '合作', 'D:\\Music\\duet.flac'),
    track('band', 'Thunderstruck', 'AC/DC', 'The Razors Edge', 'D:\\Music\\band.flac'),
    track('same', '另一首', '周 杰伦', '合作', 'D:\\Music\\other.flac'),
  ]
  const index = buildLocalLibraryIndex(tracks)
  assert.deepEqual(Array.from(index.artist.find(group => group.name === '周杰伦').trackIds), ['duet', 'same'])
  assert.deepEqual(Array.from(index.artist.find(group => group.name === 'AC/DC').trackIds), ['band'])
  assert.equal(index.artist.filter(group => group.name === 'AC' || group.name === 'DC').length, 0)
  assert.equal(index.artist.find(group => group.name === 'Fei').trackIds.length, 1)
})

test('albums distinguish the same title by artist and normalize collaborator order and Unicode', () => {
  const tracks = [
    track('a', 'One', 'Alice', 'Greatest Hits', '/music/a.flac'),
    track('b', 'Two', 'Bob', 'Greatest Hits', '/music/b.flac'),
    track('c', 'Three', 'Ａｌｉｃｅ / Bob', ' Ｓｈａｒｅｄ ', '/music/c.flac'),
    track('d', 'Four', 'Bob、Alice', 'Shared', '/music/d.flac'),
  ]
  const index = buildLocalLibraryIndex(tracks)
  assert.equal(index.album.length, 3)
  assert.deepEqual(Array.from(index.album.find(group => group.name === 'Shared').trackIds), ['c', 'd'])
  assert.deepEqual(Array.from(index.album.filter(group => group.name === 'Greatest Hits'), group => group.subtitle).sort(), ['Alice', 'Bob'])
})

test('folders identify full normalized Windows paths, including UNC and roots, rather than just basename', () => {
  const tracks = [
    track('a', 'One', 'A', 'Album', 'C:\\Music\\Live\\one.flac'),
    track('b', 'Two', 'A', 'Album', 'c:/music/temp/../Live/./two.flac'),
    track('c', 'Three', 'A', 'Album', 'D:\\Archive\\Live\\three.flac'),
    track('d', 'Four', 'A', 'Album', '\\\\SERVER\\Share\\Music\\four.flac'),
    track('e', 'Five', 'A', 'Album', '//server/share/music/five.flac'),
    track('f', 'Six', 'A', 'Album', 'C:\\six.flac'),
  ]
  const folders = buildLocalLibraryIndex(tracks).folder
  assert.equal(folders.length, 4)
  const duplicateNames = folders.filter(group => group.name.toLowerCase() === 'live')
  assert.equal(duplicateNames.length, 2)
  assert.deepEqual(Array.from(duplicateNames.find(group => group.subtitle.startsWith('C:')).trackIds), ['a', 'b'])
  assert.notEqual(duplicateNames[0].id, duplicateNames[1].id)
  assert.deepEqual(Array.from(folders.find(group => group.subtitle.startsWith('\\\\')).trackIds), ['d', 'e'])
  assert.equal(folders.find(group => group.trackIds.includes('f')).subtitle, 'C:\\')
})

test('POSIX directories remain case sensitive and normalize dot segments and root files', () => {
  const tracks = [
    track('a', 'One', 'A', 'Album', '/Music/Live/one.flac'),
    track('b', 'Two', 'A', 'Album', '/Music/temp/../Live/two.flac'),
    track('c', 'Three', 'A', 'Album', '/music/Live/three.flac'),
    track('d', 'Four', 'A', 'Album', '/four.flac'),
  ]
  const folders = buildLocalLibraryIndex(tracks).folder
  assert.equal(folders.length, 3)
  assert.deepEqual(Array.from(folders.find(group => group.subtitle === '/Music/Live').trackIds), ['a', 'b'])
  assert.equal(folders.find(group => group.trackIds.includes('d')).subtitle, '/')
})

test('missing tags and incomplete persisted data receive useful unknown groups', () => {
  const tracks = [track('empty', '', '  ', '', ''), { id: 'missing', source: 'local', name: undefined, singer: undefined }]
  const index = buildLocalLibraryIndex(tracks)
  assert.deepEqual(plain(index.artist.map(group => ({ name: group.name, trackIds: group.trackIds }))), [{ name: '未知歌手', trackIds: ['empty', 'missing'] }])
  assert.equal(index.album[0].name, '未知专辑')
  assert.equal(index.folder[0].name, '未知文件夹')
  assert.equal(filterLocalLibraryTracks(tracks, index, 'all', null, '不存在').length, 0)
})

test('local search matches title, artist, album, filename and directory with Unicode and whitespace normalization', () => {
  const tracks = [
    track('night', '夜 曲', '周杰伦', '十一月的萧邦', 'D:\\我的音乐\\Favorites\\ＨｉＲｅｓ_01.flac'),
    track('live', '现场', 'AC/DC', 'Live', '/music/Live Set/02.wav'),
  ]
  const index = buildLocalLibraryIndex(tracks)
  for (const query of ['夜曲', '周杰伦', '十一月的萧邦', 'hires_01', '我的音乐', ' favorites ', '夜 曲 周杰伦']) {
    assert.deepEqual(ids(filterLocalLibraryTracks(tracks, index, 'all', null, query)), ['night'], query)
  }
  for (const query of ['AC/DC', 'live set', '02.wav', ' ＡＣ／ＤＣ ']) {
    assert.deepEqual(ids(filterLocalLibraryTracks(tracks, index, 'all', null, query)), ['live'], query)
  }
  assert.deepEqual(ids(filterLocalLibraryTracks(tracks, index, 'all', null, '夜曲 AC/DC')), [])
})

test('group filtering preserves source order and track references and intersects search terms', () => {
  const tracks = [track('a', 'One', 'Alice', 'A', '/music/one.mp3'), track('b', 'Two', 'Bob', 'B', '/music/two.mp3'), track('c', 'Three', 'Alice', 'C', '/music/three.mp3')]
  const index = buildLocalLibraryIndex(tracks)
  const alice = index.artist.find(group => group.name === 'Alice')
  const filtered = filterLocalLibraryTracks(tracks, index, 'artist', alice.id, '')
  assert.deepEqual(ids(filtered), ['a', 'c'])
  assert.equal(filtered[0], tracks[0])
  assert.equal(filtered[1], tracks[2])
  assert.deepEqual(ids(filterLocalLibraryTracks(tracks, index, 'artist', alice.id, 'Three')), ['c'])
  assert.deepEqual(ids(filterLocalLibraryTracks(tracks, index, 'artist', alice.id, 'Bob')), [])
  assert.equal(filterLocalLibraryTracks(tracks, index, 'all', alice.id, ''), tracks)
  assert.equal(filterLocalLibraryTracks(tracks, index, 'artist', null, ''), tracks)
  assert.equal(filterLocalLibraryTracks(tracks, index, 'album', 'deleted-group', '').length, 0)
})

test('large libraries retain only IDs in groups without a song count limit or duplicate entries', () => {
  const tracks = Array.from({ length: 20001 }, (_, i) => track(String(i), `Track ${i}`, 'Alice / Bob', 'Collection', 'D:\\Music\\' + i + '.flac'))
  const index = buildLocalLibraryIndex([...tracks, tracks[0]])
  assert.equal(index.album[0].trackIds.length, 20001)
  assert.equal(index.folder[0].trackIds.length, 20001)
  assert.equal(index.artist.length, 2)
  assert.equal(index.artist[0].trackIds.length, 20001)
  assert.equal(index.artist[0].trackIds.every(id => typeof id === 'string'), true)
  assert.deepEqual(ids(filterLocalLibraryTracks(tracks, index, 'folder', index.folder[0].id, 'Track 20000')), ['20000'])
})
