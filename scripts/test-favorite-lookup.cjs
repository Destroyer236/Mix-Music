const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const vue = require('vue')

function load(filename, dependencies = {}) {
  const file = path.resolve(__dirname, '..', filename)
  const module = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    localStorage: { getItem: () => null, setItem() {} },
  }, { filename: file })
  return module.exports
}

const matching = load('src/common/platformMatching.ts')
const song = (id, overrides = {}) => ({
  id, source: 'wy', name: `歌曲 ${id}`, singer: '歌手', interval: '03:00',
  ...overrides, meta: { albumName: '专辑', ...overrides.meta },
})
function fixture(favorites) {
  const calls = { keys: 0, comparisons: 0 }
  const service = load('src/renderer/ui/services/platformAccounts.ts', {
    vue,
    electron: { ipcRenderer: {} },
    '@common/platformAccounts': { platformNames: {} },
    '@common/platformMatching': {
      recordingKey: track => { calls.keys++; return matching.recordingKey(track) },
      sameRecording: (a, b) => { calls.comparisons++; return matching.sameRecording(a, b) },
    },
    '@renderer/store/list/action': {},
    '@renderer/store/list/state': { loveList: { id: 'love' } },
    './qishuiLogin': {}, './bodianLogin': {}, './nativeQrLogin': {},
  })
  service.favoriteTracks.value = favorites
  return { ...service, calls }
}

test('favorite lookup preserves existing identity and cross-platform recording rules', () => {
  const favorites = [
    song('id-1', { name: 'Ｓｔａｙ！', singer: 'Singer B / Singer A' }),
    song('id-2', { name: '版本', meta: { recordingVersion: 'Live' } }),
    song('id-3', { name: '无时长', interval: '', meta: { albumName: 'Ａｌｂｕｍ！' } }),
    song('id-4', { name: '无资料', interval: '', meta: { albumName: '' } }),
  ]
  const f = fixture(favorites)
  const cases = [
    [song('id-1', { name: '同平台相同 ID，以 ID 为准', interval: '20:00' }), true],
    [song('id-1', { source: 'tx', name: '不同平台相同 ID' }), false],
    [song('other', { source: 'tx', name: 'stay', singer: 'singer a、singer b', interval: '03:03' }), true],
    [song('other', { source: 'tx', name: 'stay', singer: 'singer a、singer b', interval: '03:04' }), false],
    [song('other', { source: 'local', name: 'stay', singer: 'singer a、singer b', meta: { recordingVersion: 'Live' } }), false],
    [song('other', { source: 'tx', name: '版本', meta: { recordingVersion: 'LIVE' } }), true],
    [song('other', { source: 'tx', name: '版本' }), false],
    [song('other', { source: 'tx', name: '无时长', meta: { albumName: 'album' } }), true],
    [song('other', { source: 'tx', name: '无时长', meta: { albumName: '其他专辑' } }), false],
    [song('other', { source: 'tx', name: '无资料', interval: '', meta: { albumName: '' } }), false],
    [null, false],
  ]
  for (const [track, expected] of cases) {
    const previous = Boolean(track && favorites.some(item => matching.sameRecording(track, item)))
    assert.equal(previous, expected, `fixture: ${track?.name}`)
    assert.equal(f.isFavorite(track), previous, `lookup: ${track?.name}`)
  }
})

test('favorite hearts react to replacement, add/remove and in-place metadata edits', () => {
  const f = fixture([song('first', { name: '原曲' })])
  const query = vue.ref(song('remote', { source: 'tx', name: '原曲' }))
  const loved = vue.computed(() => f.isFavorite(query.value))
  assert.equal(loved.value, true)
  f.favoriteTracks.value[0].name = '改名'
  assert.equal(loved.value, false)
  query.value.name = '改名'
  assert.equal(loved.value, true)
  f.favoriteTracks.value[0].meta.recordingVersion = 'Live'
  assert.equal(loved.value, false)
  query.value.meta.recordingVersion = 'live'
  assert.equal(loved.value, true)
  f.favoriteTracks.value[0].interval = '03:04'
  assert.equal(loved.value, false)
  f.favoriteTracks.value[0].interval = ''
  assert.equal(loved.value, true)
  f.favoriteTracks.value[0].meta.albumName = '其他专辑'
  assert.equal(loved.value, false)
  f.favoriteTracks.value.push(song('second', { name: '改名', meta: { recordingVersion: 'live' } }))
  assert.equal(loved.value, true)
  f.favoriteTracks.value.splice(1, 1)
  assert.equal(loved.value, false)
  f.favoriteTracks.value = [song('replacement', { name: '改名', meta: { recordingVersion: 'live' } })]
  assert.equal(loved.value, true)
  f.favoriteTracks.value = []
  assert.equal(loved.value, false)
})

test('identity changes invalidate the favorite lookup without colliding across platforms', () => {
  const f = fixture([song('same')])
  const target = song('same', { name: 'ID 匹配' })
  const loved = vue.computed(() => f.isFavorite(target))
  assert.equal(loved.value, true)
  f.favoriteTracks.value[0].source = 'tx'
  assert.equal(loved.value, false)
  f.favoriteTracks.value[0].source = 'wy'
  assert.equal(loved.value, true)
  f.favoriteTracks.value[0].id = 'changed'
  assert.equal(loved.value, false)
})

test('scrolling through unliked rows never scans unrelated favorites again', () => {
  const favorites = Array.from({ length: 1123 }, (_, index) => song(`favorite-${index}`))
  const f = fixture(favorites)
  // Warm the shared collection once, as at initial song-list render.
  assert.equal(f.isFavorite(song('unliked-initial')), false)
  const keysBefore = f.calls.keys
  const comparisonsBefore = f.calls.comparisons
  for (let frame = 0; frame < 20; frame++) {
    for (let row = 0; row < 24; row++) {
      const track = song(`unliked-${frame * 24 + row}`)
      for (let binding = 0; binding < 4; binding++) assert.equal(f.isFavorite(track), false)
    }
  }
  assert.equal(f.calls.keys - keysBefore, 20 * 24 * 4, 'only the row being drawn needs normalization')
  assert.equal(f.calls.comparisons - comparisonsBefore, 0, 'unrelated favorites are never compared')
  const beforeMatch = f.calls.comparisons
  assert.equal(f.isFavorite(song('cross-platform', { source: 'tx', name: favorites[900].name })), true)
  assert.equal(f.calls.comparisons - beforeMatch, 1, 'only the matching recording is checked')
  assert.equal(f.isFavorite(favorites[1110]), true)
  assert.equal(f.calls.comparisons - beforeMatch, 1, 'same-platform identity requires no recording scan')
})
