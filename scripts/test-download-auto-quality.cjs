/* Auto download quality: per-track quality ladder must follow QUALITYS order
   (highest first), respect the source's advertised list, and yield null when
   nothing matches so the UI can fall back to the "no quality" note. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

function load(relative) {
  const file = path.join(root, relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => {
    if (name.startsWith('@common/')) return load(`src/common/${name.slice(8)}.ts`)
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

// Highest-first ordering over the song's own quality list.
assert.deepEqual(trackQualities(track(['128k', 'flac24bit', '320k']), kw), ['flac24bit', '320k', '128k'])
assert.equal(bestTrackQuality(track(['128k', 'flac24bit', '320k']), kw), 'flac24bit')

// Source list gates the result: a quality the source does not advertise is skipped.
assert.equal(bestTrackQuality(track(['flac24bit']), ['128k', '320k']), null)
assert.deepEqual(trackQualities(track(['flac24bit', '320k']), ['128k', '320k']), ['320k'])

// Unknown source (no advertised list) yields nothing.
assert.deepEqual(trackQualities(track(['320k']), undefined), [])
assert.equal(bestTrackQuality(track(['320k']), undefined), null)

// Songs without any matching quality fall back to null, not 128k.
assert.equal(bestTrackQuality(track([]), kw), null)

console.log('download auto quality service: OK')
