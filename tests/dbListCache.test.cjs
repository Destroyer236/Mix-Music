const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const dir = 'src/main/worker/dbService/modules/list/'
function load(file, imports = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, dir, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: name => {
      assert(name in imports, `Unexpected dependency ${name}`)
      return imports[name]
    },
  })
  return module.exports
}
const cacheModule = load('musicListCache.ts')
const track = (id, extra = '') => ({ id: String(id), name: `歌曲 ${id}`, singer: '歌手', source: 'wy', interval: '03:00', meta: { songId: String(id), albumName: '专辑', extra } })
const ids = list => Array.from(list, item => item.id)
const plain = value => JSON.parse(JSON.stringify(value))

test('DB playlist cache evicts by combined song count and recency without modifying returned arrays', () => {
  const cache = new cacheModule.MusicListCache(3, 1_000_000, 4)
  const first = [track(1)]
  const second = [track(2), track(3)]
  cache.set('first', first)
  cache.set('second', second)
  assert.equal(cache.get('first'), first)
  cache.set('third', [track(4)])
  assert.equal(cache.get('second'), undefined)
  assert.equal(cache.get('first'), first)
  assert.deepEqual(ids(second), ['2', '3'], 'eviction must only release the cache reference')
  cache.set('oversized', Array.from({ length: 4 }, (_, id) => track(id)))
  assert.equal(cache.get('oversized'), undefined)
  assert.equal(cache.get('first'), first)
})

test('DB playlist byte/list budgets are enforced and mutated entries are accounted again', () => {
  const cache = new cacheModule.MusicListCache(100, 5000, 2)
  const original = [track(1)]
  cache.set('first', original)
  cache.set('second', [])
  cache.set('third', [])
  assert.equal(cache.get('first'), undefined)
  cache.set('first', original)
  original[0].meta.extra = 'x'.repeat(2000)
  cache.set('first', original)
  assert.equal(cache.get('first'), undefined, 'an enlarged metadata entry must leave cache')
  cache.set('first', [track(2)])
  cache.delete('first')
  assert.equal(cache.get('first'), undefined)
  cache.clear()
  assert.equal(cache.get('third'), undefined)
})

function listFixture() {
  const lists = new Map()
  const reads = new Map()
  const stored = id => lists.get(id) ?? []
  const readRows = function * (id) {
    reads.set(id, (reads.get(id) ?? 0) + 1)
    for (const row of stored(id).toSorted((a, b) => a.order - b.order)) yield structuredClone(row)
  }
  const insert = rows => {
    for (const row of rows) { const list = stored(row.listId); list.push(plain(row)); lists.set(row.listId, list) }
  }
  const remove = (id, ids) => { const set = new Set(ids); lists.set(id, stored(id).filter(row => !set.has(row.id))) }
  const order = (id, rows) => { for (const row of rows) { const storedRow = stored(id).find(info => info.id === (row.musicInfoId ?? row.id)); storedRow.order = row.order } }
  const helper = {
    queryMusicInfoByListId: readRows,
    queryAllUserList: () => [],
    deleteUserLists: ids => { for (const id of ids) lists.delete(id) },
    overwriteMusicInfo: (id, rows) => { lists.set(id, []); insert(rows) },
    insertMusicInfoList: insert,
    insertMusicInfoListAndRefreshOrder: (rows, id, old) => { insert(rows); order(id, old) },
    getMusicInfoOrder: (id, song) => stored(id).find(row => row.id === song),
    removeMusicInfos: remove,
    removeMusicInfoByListId: ids => { for (const id of ids) lists.set(id, []) },
    moveMusicInfo: (from, ids, rows) => { remove(from, ids); insert(rows) },
    moveMusicInfoAndRefreshOrder: (from, ids, to, rows, old) => { remove(from, ids); insert(rows); order(to, old) },
    updateMusicInfoOrder: order,
    updateMusicInfos: rows => { for (const row of rows) Object.assign(stored(row.listId).find(info => info.id === row.id), row) },
    overwriteListData: (_lists, rows) => { lists.clear(); insert(rows) },
  }
  const actions = load('index.ts', {
    './dbHelper': helper,
    './musicListCache': cacheModule,
    '@common/constants': { LIST_IDS: { DEFAULT: 'default', LOVE: 'love', TEMP: 'temp' } },
    '@common/utils/common': {
      arrPush: (target, incoming) => { for (const item of incoming) target.push(item) },
      arrUnshift: (target, incoming) => target.splice(0, 0, ...incoming),
      arrPushByPosition: (target, incoming, position) => target.splice(position, 0, ...incoming),
    },
  })
  return { actions, reads, lists }
}

test('all playlist writes remain correct after cache hits, eviction, and large lists', () => {
  const { actions: a } = listFixture()
  a.musicOverwrite('first', [track(1), track(2)])
  const original = a.getListMusics('first')
  a.musicsAdd('first', [track(2), track(3)], 'top')
  assert.equal(a.getListMusics('first'), original)
  assert.deepEqual(ids(original), ['3', '1', '2'])
  a.musicsAdd('first', [track(4)], 'bottom')
  a.musicsPositionUpdate('first', 0, ['4'])
  assert.deepEqual(ids(a.getListMusics('first')), ['4', '3', '1', '2'])
  a.musicsUpdate([{ id: 'first', musicInfo: { ...track(3), name: '更新歌曲' } }])
  assert.equal(a.getListMusics('first')[1].name, '更新歌曲')
  a.musicOverwrite('second', [track(2), track(5)])
  a.musicsMove('first', 'second', [track(2), track(3)], 'top')
  assert.deepEqual(ids(a.getListMusics('first')), ['4', '1'])
  assert.deepEqual(ids(a.getListMusics('second')), ['3', '2', '5'])
  a.musicsRemove('second', ['2'])
  assert.deepEqual(ids(a.getListMusics('second')), ['3', '5'])
  a.musicsClear(['second'])
  assert.deepEqual(ids(a.getListMusics('second')), [])
  a.musicOverwrite('first', [track(7)])
  assert.deepEqual(ids(a.getListMusics('first')), ['7'])
  a.removeUserLists(['first'])
  assert.deepEqual(ids(a.getListMusics('first')), [], 'deleted user playlists must leave the cache')
})

test('a 50,000-song playlist is returned whole, remains writable, and is never retained in the DB cache', () => {
  const { actions: a, reads } = listFixture()
  const songs = Array.from({ length: 50_000 }, (_, id) => track(id))
  a.musicOverwrite('large', songs)
  assert.equal(a.getListMusics('large').length, 50_000)
  assert.equal(a.getListMusics('large').length, 50_000)
  assert.equal(reads.get('large'), 2)
  a.musicsAdd('large', [track(50_000)], 'bottom')
  assert.equal(a.getListMusics('large').at(-1).id, '50000')
  a.musicsRemove('large', ['0', '1'])
  assert.equal(a.getListMusics('large').length, 49_999)
  a.musicsUpdate([{ id: 'large', musicInfo: { ...track(2), name: '已更新' } }])
  assert.equal(a.getListMusics('large')[0].name, '已更新')
})

test('full backup restore streams DB JSON rows and respects the cache budget without limiting restored music', () => {
  const { actions: a, reads } = listFixture()
  const restored = Array.from({ length: 12_000 }, (_, id) => track(id))
  a.listDataOverwrite({ defaultList: [track('default')], loveList: [], tempList: [], userList: [{ id: 'restored', name: '导入歌单', list: restored }] })
  assert.deepEqual(ids(a.getListMusics('default')), ['default'])
  assert.equal(a.getListMusics('restored').length, 12_000)
  assert.equal(a.getListMusics('restored').length, 12_000)
  assert.equal(reads.get('restored'), 2)
})

test('database playlist query uses the row iterator and never allocates a raw .all() array', () => {
  let iterated = false
  const helper = load('dbHelper.ts', {
    '../../db': {},
    './statements': { createMusicInfoQueryStatement: () => ({ all() { throw new Error('Raw full-array query must not be used') }, iterate({ listId }) { iterated = true; return [{ id: listId, meta: '{}' }].values() } }) },
  })
  assert.deepEqual(plain([...helper.queryMusicInfoByListId('fixture')]), [{ id: 'fixture', meta: '{}' }])
  assert(iterated)
})
