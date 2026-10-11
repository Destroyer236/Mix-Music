const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

const root = path.resolve(__dirname, '..')
const LOCAL_LIBRARY_ID = 'userlist_linkline_local'
const LIST_IDS = { TEMP: 'temp' }
const source = fs.readFileSync(path.join(root, 'src/renderer/ui/views/LocalMusic.vue'), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
const transpile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const deferred = () => { let resolve, reject; const promise = new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject }); return { promise, resolve, reject } }
const settle = async() => { await vue.nextTick(); for (let index = 0; index < 20; index++) await Promise.resolve(); await vue.nextTick() }

const track = (id, singer, album, folder = 'Music') => ({ id, source: 'local', name: id, singer, interval: '03:00', meta: { albumName: album, filePath: `C:/audio/${folder}/${id}.mp3`, songId: id, picUrl: '', ext: 'mp3' } })
const groupsModule = { exports: {} }
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'src/renderer/ui/services/localLibraryGroups.ts'), 'utf8')), { module: groupsModule, exports: groupsModule.exports })

function fixture({ tracks = [], select, scan, temp, lists = [] } = {}) {
  const module = { exports: {} }
  const mounts = []
  const unmounts = []
  const scope = vue.effectScope()
  const calls = { lists: [], temp: [], play: [], select: [], scan: [], saved: [], events: [] }
  let disposed = false
  const currentLists = [...lists]
  const imports = {
    vue: { ...vue, onMounted: fn => mounts.push(fn), onBeforeUnmount: fn => unmounts.push(fn) },
    '@common/constants': { LIST_IDS },
    '@common/localMusic': { LOCAL_AUDIO_EXTENSIONS: ['mp3', 'flac'], LOCAL_LIBRARY_ID },
    '@renderer/store/list/action': {
      getListMusics: async id => { calls.lists.push(id); return currentLists.length ? currentLists.shift() : tracks },
      removeListMusics: async args => { calls.removed = args },
      setTempList: async(...args) => { calls.temp.push(args); return temp ? temp(...args) : undefined },
    },
    '@renderer/core/player': { playList: (...args) => calls.play.push(args) },
    '@renderer/utils/ipc': { showSelectDialog: async options => { calls.select.push(options); return select ? select(options) : { canceled: false, filePaths: ['/fixture/music'] } } },
    '@renderer/utils/data': { saveListPrevSelectId: id => calls.saved.push(id) },
    '../services/localLibrary': {
      ensureLocalLibrary: async() => {},
      importLocalAudio: async(...args) => { calls.scan.push(args); return scan ? scan(...args) : { cancelled: false, imported: 1, skipped: 0, failed: 0, metadataFailed: 0, errors: [] } },
    },
    '../services/localLibraryGroups': groupsModule.exports,
  }
  scope.run(() => vm.runInNewContext(transpile(`${source}\nmodule.exports = { tracks, category, groupId, query, filteredTracks, pageTracks, importing, importCancelled, importProgress, error, actionError, message, playing, playTrack, importAudio, loadTracks, chooseCategory, chooseGroup }`), {
    module,
    exports: module.exports,
    Error,
    Promise,
    console,
    window: { app_event: { on: (...args) => calls.events.push(['on', ...args]), off: (...args) => calls.events.push(['off', ...args]) } },
    require(name) {
      if (name in imports) return imports[name]
      if (name.endsWith('.vue')) return {}
      throw new Error(`Unexpected import ${name}`)
    },
  }))
  return {
    ...module.exports,
    calls,
    async mount() { for (const callback of mounts) await callback(); await settle() },
    dispose() { if (disposed) return; disposed = true; for (const callback of unmounts) callback(); scope.stop() },
  }
}

test('playTrack builds a temporary queue from the active search and category and uses its filtered index', async t => {
  const one = track('one', 'A', 'Alpha')
  const two = track('two', 'B', 'Beta')
  const three = track('three', 'B', 'Beta')
  const f = fixture({ tracks: [one, two, three] })
  t.after(f.dispose)
  await f.mount()
  f.query.value = 'beta'
  await settle()
  await f.playTrack(three)
  assert.equal(f.calls.temp.length, 1)
  assert.deepEqual(Array.from(f.calls.temp[0][1], item => item.id), ['two', 'three'])
  assert.equal(f.calls.play[0][0], LIST_IDS.TEMP)
  assert.equal(f.calls.play[0][1], 1)
  f.chooseCategory('artist')
  f.chooseGroup(groupsModule.exports.buildLocalLibraryIndex([one, two, three]).artist.find(group => group.name === 'B').id)
  f.query.value = ''
  await settle()
  await f.playTrack(one)
  assert.equal(f.calls.play.length, 1, 'a track outside the selected category is ignored')
  await f.playTrack(two)
  assert.equal(f.calls.play.length, 2)
  assert.deepEqual(Array.from(f.calls.temp[1][1], item => item.id), ['two', 'three'])
  assert.equal(f.calls.play[1][1], 0)
  f.query.value = 'three'
  await settle()
  await f.playTrack(three)
  assert.deepEqual(Array.from(f.calls.temp[2][1], item => item.id), ['three'])
  assert.equal(f.calls.play[2][1], 0)
})

test('an unmounted page never starts playback when queue preparation resolves late', async t => {
  const song = track('song', 'A', 'Album')
  const held = deferred()
  const stable = fixture({ tracks: [song], temp: () => held.promise })
  t.after(stable.dispose)
  await stable.mount()
  const playing = stable.playTrack(song)
  await stable.playTrack(song)
  assert.equal(stable.calls.temp.length, 1, 'repeated clicks cannot prepare another queue while the first is pending')
  stable.dispose()
  held.resolve()
  await playing
  assert.equal(stable.calls.play.length, 0)
})

test('cancelled picker, stopped scan, scan failure, and leaving the page preserve import state safely', async t => {
  const cancelled = fixture({ select: async() => ({ canceled: true, filePaths: [] }) })
  t.after(cancelled.dispose)
  await cancelled.importAudio('files')
  assert.equal(cancelled.calls.scan.length, 0)
  assert.equal(cancelled.importing.value, false)

  const stopping = deferred()
  const stopped = fixture({ tracks: [track('already-imported', 'A', 'Album')], scan: () => stopping.promise })
  t.after(stopped.dispose)
  const stoppingImport = stopped.importAudio('folder')
  await settle()
  stopped.importCancelled.value = true
  assert.equal(stopped.calls.scan[0][2](), true)
  stopping.resolve({ cancelled: true, imported: 4, skipped: 2, failed: 0, metadataFailed: 0, errors: [] })
  await stoppingImport
  assert.match(stopped.message.value, /已停止导入，已导入 4 首/)
  assert.deepEqual(Array.from(stopped.tracks.value, item => item.id), ['already-imported'])
  assert.equal(stopped.importing.value, false)

  const failed = fixture({ scan: async() => { throw new Error('broken scan') } })
  t.after(failed.dispose)
  await failed.importAudio('folder')
  assert.match(failed.actionError.value, /broken scan/)
  assert.equal(failed.importing.value, false)

  const pendingPicker = deferred()
  const left = fixture({ select: () => pendingPicker.promise })
  const leaving = left.importAudio('files')
  left.dispose()
  pendingPicker.resolve({ canceled: false, filePaths: ['/fixture/song.mp3'] })
  await leaving
  assert.equal(left.calls.scan.length, 0)
})

test('a late load response cannot replace the newer local library snapshot', async t => {
  const first = deferred()
  const second = deferred()
  const one = track('old', 'A', 'Album')
  const two = track('new', 'B', 'Album')
  const f = fixture({ lists: [first.promise, second.promise] })
  t.after(f.dispose)
  const firstLoad = f.loadTracks()
  const secondLoad = f.loadTracks()
  second.resolve([two])
  await secondLoad
  first.resolve([one])
  await firstLoad
  assert.deepEqual(Array.from(f.tracks.value, item => item.id), ['new'])
  assert.equal(f.error.value, '')
})

test('a stale failed load does not show an error over a newer successful response or change an unmounted page', async t => {
  const stale = deferred()
  const afterUnmount = deferred()
  const song = track('fresh', 'A', 'Album')
  const f = fixture({ lists: [stale.promise, [song], afterUnmount.promise] })
  t.after(f.dispose)
  const oldLoad = f.loadTracks()
  await f.loadTracks()
  stale.reject(new Error('old request failed'))
  await oldLoad
  assert.equal(f.error.value, '')
  const lateLoad = f.loadTracks()
  f.dispose()
  afterUnmount.resolve([track('late', 'B', 'Album')])
  await lateLoad
  assert.deepEqual(Array.from(f.tracks.value, item => item.id), ['fresh'])
})

test('leaving during scanning signals cancellation and ignores late progress and completion without refreshing', async() => {
  const pending = deferred()
  const f = fixture({ scan: () => pending.promise })
  const importing = f.importAudio('folder')
  await settle()
  const [, progress, cancelled] = f.calls.scan[0]
  const firstProgress = { imported: 4, discovered: 5 }
  progress(firstProgress)
  assert.equal(f.importProgress.value, firstProgress)
  f.dispose()
  assert.equal(cancelled(), true)
  progress({ imported: 6, discovered: 7 })
  pending.resolve({ cancelled: true, imported: 6, skipped: 0, failed: 0, metadataFailed: 0, errors: [] })
  await importing
  assert.equal(f.importProgress.value, firstProgress)
  assert.equal(f.calls.lists.length, 0)
  assert.equal(f.message.value, '')
  assert.equal(f.importing.value, false)
})
