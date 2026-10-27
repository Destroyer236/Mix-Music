// 只读验证：用真实账号跑修复后的 playlistTracks，确认收藏歌单能读到曲目。
const { app, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')
const Module = require('node:module')

app.setPath('userData', path.join(process.env.APPDATA, 'LinkLine'))
const root = path.join(__dirname, '..')

function load(relative, deps = {}) {
  const file = path.join(root, relative)
  const m = new Module(file, module)
  m.filename = file
  m.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = m.require.bind(m)
  m.require = name => {
    if (Object.hasOwn(deps, name)) return deps[name]
    if (name.startsWith('@common/')) return load(`src/common/${name.slice(8)}.ts`)
    return nativeRequire(name)
  }
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file)
  return m.exports
}

const contextFor = (ses) => ({
  session: ses,
  cookies: async() => Object.fromEntries((await ses.cookies.get({})).map(c => [c.name, c.value])),
})

app.whenReady().then(async() => {
  // 网易云
  try {
    const ses = session.fromPartition('persist:linkline-account-netease')
    const provider = load('src/main/modules/platformAccounts/providers/netease.ts').neteaseProvider
    const profile = await provider.profile(contextFor(ses))
    const lists = await provider.playlists(contextFor(ses), profile)
    const collected = lists.filter(item => item.collected)
    console.log(`[netease] 收藏歌单 ${collected.length} 个`)
    for (const playlist of collected.slice(0, 3)) {
      try {
        const tracks = await provider.playlistTracks(contextFor(ses), profile, playlist)
        console.log(`  ✓ "${playlist.name.slice(0, 16)}" count=${playlist.count} -> ${tracks.length} 首`, tracks[0] ? `| ${tracks[0].name} - ${tracks[0].singer}` : '')
      } catch (error) { console.log(`  ✗ "${playlist.name.slice(0, 16)}" ${error.message}`) }
    }
  } catch (error) { console.log('[netease] 失败:', error.message) }

  // 酷狗概念版
  try {
    const ses = session.fromPartition('persist:linkline-account-kugouconcept')
    const kugouConceptProvider = load('src/main/modules/platformAccounts/providers/kugouConceptProvider.ts', {
      './kugou': load('src/main/modules/platformAccounts/providers/kugou.ts'),
      './kugouConcept': load('src/main/modules/platformAccounts/providers/kugouConcept.ts'),
    }).kugouConceptProvider
    const provider = kugouConceptProvider
    const profile = await provider.profile(contextFor(ses))
    const lists = await provider.playlists(contextFor(ses), profile)
    const collected = lists.filter(item => item.collected)
    const owned = lists.filter(item => !item.collected)
    console.log(`[kugou] 收藏 ${collected.length} 个 / 自建 ${owned.length} 个`)
    for (const playlist of [...collected.slice(0, 3), ...owned.slice(0, 2)]) {
      try {
        const tracks = await provider.playlistTracks(contextFor(ses), profile, playlist)
        console.log(`  ${playlist.collected ? '收藏' : '自建'} ✓ "${playlist.name.slice(0, 16)}" count=${playlist.count} -> ${tracks.length} 首`, tracks[0] ? `| ${tracks[0].name} - ${tracks[0].singer}` : '')
      } catch (error) { console.log(`  ${playlist.collected ? '收藏' : '自建'} ✗ "${playlist.name.slice(0, 16)}" ${error.message}`) }
    }
  } catch (error) { console.log('[kugou] 失败:', error.message) }

  app.quit()
})
