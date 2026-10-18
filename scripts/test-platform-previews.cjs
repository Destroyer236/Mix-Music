/* Official preview contracts; no real account, audio download or collection write. */
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
    return nativeRequire(name)
  }
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file)
  return instance.exports
}
const directory = 'src/main/modules/platformAccounts/providers/'
const qq = load(`${directory}qq.ts`).qqProvider
const netease = load(`${directory}netease.ts`, { 'NeteaseCloudMusicApi/util/crypto': { weapi: value => value } }).neteaseProvider
const track = { id: 'tx_test', source: 'tx', name: 'Test', singer: 'Singer', interval: '03:00', meta: { songId: 'test', strMediaMid: 'media', albumName: '', qualitys: [], _qualitys: {} } }
const context = body => ({ cookies: async() => ({}), session: { fetch: async(url, options) => new Response(JSON.stringify(typeof body === 'function' ? body(url, options) : body), { headers: { 'Content-Type': 'application/json' } }) } })

async function main() {
  const wy = { ...track, id: 'wy_1', source: 'wy', meta: { ...track.meta, songId: 1, isVip: true } }
  const item = { id: 1, url: 'https://audio.example.test/preview.mp3', br: 128000, level: 'standard', expi: 300 }
  const preview = await netease.musicUrl(context({ code: 200, data: [{ ...item, freeTrialInfo: { start: 0, end: 30 } }] }), wy, 'auto')
  assert.equal(preview.isTrial, true)
  assert.equal(preview.type, '128k')
  const entitled = await netease.musicUrl(context({ code: 200, data: [{ ...item, freeTrialInfo: null }] }), wy, 'auto')
  assert.equal(entitled.isTrial, false, 'VIP metadata does not mean an entitled full stream is a preview')
  await assert.rejects(netease.musicUrl(context({ code: 200, data: [{ ...item, url: null, freeTrialInfo: { start: 0, end: 30 } }] }), wy, 'auto'), /没有返回/)

  let requests = 0
  const qqContext = context((_url, options) => {
    const names = JSON.parse(options.body).req.param.filename
    requests++
    return { req: { data: { sip: ['https://stream.example.test/'], midurlinfo: names.map(filename => ({ filename, purl: filename.startsWith('M500') ? 'M500media.mp3' : 'RS02preview.mp3' })) } } }
  })
  const lowerFull = await qq.musicUrl(qqContext, track, 'flac')
  assert.equal(requests, 2)
  assert.equal(lowerFull.isTrial, undefined)
  assert.equal(lowerFull.type, '128k')
  assert.match(lowerFull.url, /M500/)
  const downgraded = await qq.musicUrl(context({ req: { data: { midurlinfo: [{ filename: 'F000media.flac', purl: 'M500media.mp3' }] } } }), track, 'flac')
  assert.equal(downgraded.type, '128k', 'report actual returned encoding rather than requested filename')
  const qqTrial = await qq.musicUrl(context((_url, options) => ({ req: { data: { midurlinfo: JSON.parse(options.body).req.param.filename.map(filename => ({ filename, purl: 'RS02preview.mp3' })) } } })), track, 'flac')
  assert.equal(qqTrial.isTrial, true)
  assert.equal(qqTrial.qualityLabel, '试听音频（平台提供）')
  const retainedTrial = await qq.musicUrl(context((_url, options) => ({ req: { data: { midurlinfo: JSON.parse(options.body).req.param.filename.map(filename => ({ filename, purl: filename.startsWith('F000') ? 'RS02preview.mp3' : '' })) } } })), track, 'flac')
  assert.equal(retainedTrial.isTrial, true, 'retain the official preview when lower tiers are denied')
  await assert.rejects(qq.musicUrl(context({ req: { data: { midurlinfo: [] } } }), track, '128k'), /没有返回/)

  let accepted
  let response = { ...qqTrial, musicInfo: track, platform: 'QQ 音乐' }
  let resolveArgs
  const online = load('src/renderer/core/music/online.ts', {
    '@renderer/store/list/action': {},
    '@renderer/ui/services/platformPlayback': {
      preferredQuality: { value: 'auto' },
      resolvePlatformStream: async(...args) => { resolveArgs = args; return response },
      acceptStream: (_track, stream) => { accepted = stream },
    },
    '@renderer/utils/ipc': {}, './utils': {},
  })
  assert.match(await online.getMusicUrl({ musicInfo: track, isRefresh: false }), /RS02/)
  assert.equal(accepted.isTrial, true, 'renderer preserves the complete resolver result and preview metadata')
  const rejectedUrls = [response.url]
  response = { url: 'https://audio.example.test/imported-full.mp3', type: '128k', platform: 'Imported fixture', musicInfo: track }
  assert.match(await online.getMusicUrl({ musicInfo: track, isRefresh: true, rejectedUrls }), /imported-full/)
  assert.equal(accepted.isTrial, undefined)
  assert.deepEqual(resolveArgs, [track, true, true, 'auto', { rejectedUrls }], 'media failures reach the single main-process source chain')
  const qs = { ...track, source: 'qs' }
  await online.getMusicUrl({ musicInfo: qs, isRefresh: false, allowToggleSource: false })
  assert.deepEqual(resolveArgs, [qs, false, false, 'auto', { rejectedUrls: undefined }])
  console.log('Official preview contracts passed (Netease/QQ rights, quality fallback, full-stream priority, trial state).')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
