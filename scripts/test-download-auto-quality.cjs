/* Auto download quality: per-track quality ladder must follow QUALITYS order
   (highest first), respect the source's advertised list, and yield null when
   nothing matches so the UI can fall back to the "no quality" note. */
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
    if (name.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), name)
      for (const extension of ['.ts', '.js']) {
        if (fs.existsSync(resolved + extension)) return load(path.relative(root, resolved + extension))
      }
    }
    return nativeRequire(name)
  }
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file)
  return instance.exports
}

const track = (qualitys, source = 'kw') => ({ source, meta: { qualitys: qualitys.map(type => ({ type })) } })

const { trackQualities, bestTrackQuality } = load('src/renderer/ui/services/downloadQuality.ts')
const kw = ['128k', '320k', 'flac', 'flac24bit']
const withMeta = (qualitys, declared = qualitys, source = 'kw') => ({
  source,
  meta: { qualitys: qualitys.map(type => ({ type })), _qualitys: Object.fromEntries(declared.map(type => [type, { size: null }])) },
})

// Highest-first ordering over the song's own quality list.
assert.deepEqual(trackQualities(track(['128k', 'flac24bit', '320k']), kw), ['flac24bit', '320k', '128k'])
assert.equal(bestTrackQuality(track(['128k', 'flac24bit', '320k']), kw), 'flac24bit')

// Source list gates the result: a quality the source does not advertise is skipped.
assert.equal(bestTrackQuality(track(['flac24bit']), ['128k', '320k']), null)
assert.deepEqual(trackQualities(track(['flac24bit', '320k']), ['128k', '320k']), ['320k'])

// 「当前音源」未选择：平台歌曲仍按自身声明的音质可下载，不能判成没有音质。
assert.deepEqual(trackQualities(withMeta(['128k', '320k', 'flac']), undefined), ['flac', '320k', '128k'])
assert.equal(bestTrackQuality(withMeta(['128k', '320k', 'flac']), undefined), 'flac')
// 歌曲声明与 _qualitys 不一致时，以 _qualitys（真正可取流的档位）为准。
assert.deepEqual(trackQualities(withMeta(['128k', 'flac'], ['128k']), undefined), ['128k'])
// 两者都没有时才是空。
assert.deepEqual(trackQualities({ source: 'kw', meta: { qualitys: [], _qualitys: {} } }, undefined), [])

// Songs without any matching quality fall back to null, not 128k.
assert.equal(bestTrackQuality(track([]), kw), null)

console.log('download auto quality service: OK')

// Worker 端音质判定：未选择音源（qualityList 无该平台）时按歌曲自身声明取档，
// 而不是一律退回 128k —— 否则自动挡在「未选择音源」下拿不到高音质。
const { getMusicType } = load('src/renderer/worker/download/utils.ts')
const workerTrack = (declared) => ({ source: 'kw', meta: { qualitys: declared.map(type => ({ type })), _qualitys: Object.fromEntries(declared.map(type => [type, { size: null }])) } })
assert.equal(getMusicType(workerTrack(['128k', '320k', 'flac']), 'flac', {}), 'flac', 'unselected source keeps the declared high tier')
assert.equal(getMusicType(workerTrack(['128k', '320k']), 'flac', {}), '320k', 'requested tier above the ladder clamps to the best declared')
assert.equal(getMusicType(workerTrack(['128k', '320k', 'flac']), '320k', {}), '320k', 'an available requested tier is kept')
assert.equal(getMusicType(workerTrack([]), '320k', {}), '128k', 'undocumented songs still default to 128k')

console.log('download worker quality mapping: OK')
