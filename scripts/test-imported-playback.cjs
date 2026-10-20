/* Real Electron/preload contract; generated loopback audio, no accounts or remote music. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { createImportedScript, createTone } = require('./fixtures/imported-source.cjs')
const root = path.resolve(__dirname, '..')

function load(relative, dependencies = {}) {
  const ts = require('typescript')
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

const track = (source, id = 'song', extra = {}) => ({
  id: `${source}_${id}`, source, name: 'Fixture Song', singer: 'Fixture Singer', interval: '03:00',
  meta: { songId: id, albumName: 'Fixture Album', qualitys: [], _qualitys: {} }, ...extra,
})

async function runElectron() {
  process.env.NODE_ENV = 'production'
  const { app, BrowserWindow, ipcMain } = require('electron')
  const userData = process.argv[process.argv.indexOf('--electron-fixture') + 1]
  app.setPath('userData', userData)
  app.commandLine.appendSwitch('disable-gpu')
  app.on('window-all-closed', () => {})
  await app.whenReady()
  const http = require('node:http')
  const requests = []
  const tone = createTone()
  const fullTone = createTone(30)
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    response.setHeader('Access-Control-Allow-Origin', '*')
    if (url.pathname === '/called') {
      requests.push(Object.fromEntries(url.searchParams))
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{}')
    } else if (url.pathname === '/full.wav') {
      response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': fullTone.length })
      response.end(fullTone)
    } else if (url.pathname === '/tone.wav') {
      response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': tone.length, 'Accept-Ranges': 'none' })
      response.end(tone)
    } else { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const checked = []
  const runtimes = new Set()
  const store = {}
  const selected = 'user_api_selected_untouched'
  global.lx = { event_app: new EventEmitter(), appSetting: { 'common.apiSource': selected } }
  const utils = load('src/main/modules/userApi/utils.ts', {
    './config': load('src/main/modules/userApi/config/index.ts'), '@common/constants': { STORE_NAMES: { USER_API: 'test' } },
    '@main/utils/store': { __esModule: true, default: () => ({ get: key => store[key], set: (key, value) => { store[key] = value } }) },
  })
  const nativeRuntime = load('src/main/modules/userApi/playbackRuntime.ts', { './main': { getProxy: () => ({ host: '', port: '' }) } })
  const runtimeModule = { ...nativeRuntime, createImportedScriptRuntime: async(api, script, options = {}) => {
    const runtime = await nativeRuntime.createImportedScriptRuntime(api, script, {
      preloadPath: path.join(root, 'dist/user-api-preload.js'),
      htmlPath: path.join(root, 'src/main/modules/userApi/renderer/user-api.html'),
      initTimeout: 2000, requestTimeout: 500, ...options,
    })
    runtimes.add(runtime)
    return runtime
  } }
  const imported = load('src/main/modules/userApi/playback.ts', { './utils': utils, './playbackRuntime': runtimeModule })
  const { createPlaybackResolver } = load('src/main/modules/platformAccounts/playback.ts')
  let officialCalls = []
  const full = { url: `${base}/tone.wav?official=full`, type: '320k', isTrial: false }
  const preview = { url: `${base}/tone.wav?official=preview`, type: '128k', isTrial: true }
  function state(source, response, candidates = [track(source)]) {
    return {
      provider: { id: source, source, name: `${source} official`,
        search: async() => candidates,
        musicUrl: async() => { officialCalls.push(source); if (response instanceof Error) throw response; return response },
      }, context: {}, account: { connected: false }, tracks: candidates, generation: 0,
    }
  }
  async function clearApis() {
    imported.closeImportedPlayback()
    utils.removeApi(utils.getUserApis().map(api => api.id))
    officialCalls = []
    requests.length = 0
  }
  const add = (options = {}) => utils.importApi(createImportedScript(base, options))
  const resolver = (states, preference = 'auto') => createPlaybackResolver(() => states, () => preference, imported.getImportedPlaybackSources)
  async function check(name, test) { await clearApis(); await test(); assert.equal(global.lx.appSetting['common.apiSource'], selected); checked.push(name) }
  try {
    await check('unactivated import executes real LX script after official failure', async() => {
      const api = await add()
      assert.equal(store.userApis[0].id, api.id)
      assert.match(store.userApis[0].script, /^gz_/)
      const stream = await resolver([state('kw', new Error('official unavailable'))]).resolve(track('kw'))
      assert.equal(stream.platform, api.name)
      assert.equal(stream.type, '320k')
      assert.equal(new URL(stream.url).origin, base)
      assert.deepEqual(requests.map(item => [item.source, item.action, item.type, item.song]), [['kw', 'musicUrl', '320k', 'song']])
    })
    await check('preferred imported script outranks full official stream', async() => {
      const api = await add()
      const stream = await resolver([state('kw', full)], `imported:${api.id}`).resolve(track('kw'))
      assert.equal(stream.platform, api.name)
      assert.deepEqual(officialCalls, [])
    })
    await check('automatic source compares imported quality and retains equal official stream', async() => {
      await add()
      const stream = await resolver([state('kw', full)]).resolve(track('kw'))
      assert.equal(stream.url, full.url)
      assert.equal(requests.length, 1)
    })
    await check('official preview yields to imported full stream', async() => {
      const api = await add()
      const stream = await resolver([state('kw', preview)]).resolve(track('kw'), '128k')
      assert.equal(stream.platform, api.name)
      assert.notEqual(stream.isTrial, true)
      assert.equal(stream.type, '128k')
    })
    await check('rejected imported URL selects the next declared quality and bypasses cache', async() => {
      const api = await add()
      const player = resolver([state('kw', new Error('official unavailable'))], `imported:${api.id}`)
      const first = await player.resolve(track('kw'))
      const cached = await player.resolve(track('kw'))
      assert.equal(cached.url, first.url)
      assert.equal(requests.length, 1)
      const next = await player.resolve(track('kw'), 'auto', false, true, { rejectedUrls: [first.url] })
      assert.equal(first.type, '320k')
      assert.equal(next.type, '128k')
      assert.notEqual(next.url, first.url)
      assert.deepEqual(requests.map(item => item.type), ['320k', '128k'], 'rejected tier must not be requested again with a new signature')
    })
    await check('rejected imported URLs select a matching recording on the next platform', async() => {
      const api = await add({ sources: { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['320k'] }, wy: { type: 'music', actions: ['musicUrl'], qualitys: ['320k'] } } })
      const states = [state('kw', new Error('official unavailable')), state('wy', new Error('official unavailable'))]
      const player = resolver(states, `imported:${api.id}`)
      const first = await player.resolve(track('kw'))
      const next = await player.resolve(track('kw'), 'auto', false, true, { rejectedUrls: [first.url] })
      assert.equal(next.musicInfo.source, 'wy')
      assert.equal(next.type, '320k')
    })
    await check('rejected preferred import falls through to another inactive imported source', async() => {
      const sources = { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['320k'] } }
      const preferred = await add({ name: 'Preferred fixture', sources })
      const fallback = await add({ name: 'Fallback fixture', sources })
      const player = resolver([state('kw', new Error('official unavailable'))], `imported:${preferred.id}`)
      const first = await player.resolve(track('kw'))
      const next = await player.resolve(track('kw'), 'auto', true, true, { rejectedUrls: [first.url] })
      assert.equal(first.platform, preferred.name)
      assert.equal(next.platform, fallback.name)
    })
    await check('rejected full official stream falls through to a real imported stream', async() => {
      const api = await add()
      const player = resolver([state('kw', full)])
      assert.equal((await player.resolve(track('kw'))).url, full.url)
      const next = await player.resolve(track('kw'), 'auto', false, true, { rejectedUrls: [full.url] })
      assert.equal(next.platform, api.name)
    })
    await check('strict cross-platform matching preserves recording and candidate ID', async() => {
      const api = await add()
      const candidate = track('kw', 'same-recording')
      const stream = await resolver([state('tx', preview), state('kw', new Error('no entitlement'), [candidate])]).resolve(track('tx'))
      assert.equal(stream.platform, api.name)
      assert.equal(stream.musicInfo.id, candidate.id)
      assert.equal(requests[0].song, 'same-recording')
    })
    for (const [label, candidates] of [
      ['live title', [track('kw', 'live', { name: 'Fixture Song (Live)' })]],
      ['different singer', [track('kw', 'other', { singer: 'Different Singer' })]],
      ['recording version', [track('kw', 'version', { meta: { ...track('kw').meta, recordingVersion: 'Live' } })]],
      ['duration difference', [track('kw', 'duration', { interval: '03:20' })]],
      ['ambiguous candidates', [track('kw', 'one'), track('kw', 'two')]],
    ]) {
      await check(`rejects cross-platform ${label} and retains official preview`, async() => {
        await add()
        const stream = await resolver([state('tx', preview), state('kw', new Error('no entitlement'), candidates)]).resolve(track('tx'))
        assert.equal(stream.url, preview.url)
        assert.equal(stream.isTrial, true)
        assert.equal(requests.length, 0)
      })
    }
    await check('source-only requests cannot use a cross-platform imported candidate', async() => {
      const api = await add()
      const stream = await resolver([state('tx', preview), state('kw', full)], `imported:${api.id}`).resolve(track('tx'), 'auto', false, false)
      assert.equal(stream.url, preview.url)
      assert.deepEqual(officialCalls, ['tx'])
      assert.equal(requests.length, 0)
    })
    for (const [mode, sources] of [
      ['failure', undefined], ['invalid-url', undefined], ['pending', undefined],
      ['success', { wy: { type: 'music', actions: ['musicUrl'], qualitys: ['320k'] } }],
    ]) {
      await check(`${mode}/${sources ? 'unsupported' : 'supported'} import retains official preview`, async() => {
        await add({ mode, ...(sources ? { sources } : {}) })
        const stream = await resolver([state('kw', preview)]).resolve(track('kw'))
        assert.equal(stream.url, preview.url)
        assert.equal(stream.isTrial, true)
      })
    }
    await check('real preload filters unsupported platform, action and quality declarations', async() => {
      const script = createImportedScript(base, { sources: {
        kw: { type: 'music', actions: ['musicUrl', 'unknown'], qualitys: ['320k', 'fake'] },
        bi: { type: 'music', actions: ['musicUrl'], qualitys: ['320k'] },
      } })
      const api = await utils.importApi(script)
      const runtime = await runtimeModule.createImportedScriptRuntime(api, script)
      assert.deepEqual(runtime.sources, { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['320k'] } })
      await assert.rejects(runtime.request(track('wy'), '320k'), /不支持/)
      await assert.rejects(runtime.request(track('kw'), 'flac'), /不支持/)
      runtime.close()
    })
    await check('simultaneous identical imported requests share one script request', async() => {
      await add()
      const source = imported.getImportedPlaybackSources()[0]
      const streams = await Promise.all([source.resolve(track('kw'), 'auto', [], false, true), source.resolve(track('kw'), 'auto', [], false, true)])
      assert.equal(streams[0].url, streams[1].url)
      assert.equal(requests.length, 1)
    })
    await check('request timeout closes runtime and cleans IPC', async() => {
      const baseline = ['userApi_init', 'userApi_response', 'userApi_getProxy'].map(name => ipcMain.listenerCount(name))
      const script = createImportedScript(base, { mode: 'pending' })
      const api = await utils.importApi(script)
      const runtime = await runtimeModule.createImportedScriptRuntime(api, script, { requestTimeout: 100 })
      await assert.rejects(runtime.request(track('kw'), '320k'), /请求超时/)
      await assert.rejects(runtime.request(track('kw'), '320k'), /关闭/)
      assert.deepEqual(['userApi_init', 'userApi_response', 'userApi_getProxy'].map(name => ipcMain.listenerCount(name)), baseline)
    })
    await check('default runtime accepts a public source response beyond ten seconds', async() => {
      const script = createImportedScript(base, { requestDelay: 10500 })
      const api = await utils.importApi(script)
      const runtime = await runtimeModule.createImportedScriptRuntime(api, script, { requestTimeout: undefined })
      const response = await runtime.request(track('kw'), '320k')
      assert.equal(new URL(response.url).origin, base)
      runtime.close()
    })
    await check('explicit close rejects outstanding work and cleans IPC', async() => {
      const baseline = ['userApi_init', 'userApi_response', 'userApi_getProxy'].map(name => ipcMain.listenerCount(name))
      const script = createImportedScript(base, { mode: 'pending' })
      const api = await utils.importApi(script)
      const runtime = await runtimeModule.createImportedScriptRuntime(api, script)
      const pending = assert.rejects(runtime.request(track('kw'), '320k'), /关闭/)
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 1000
        const poll = () => { if (requests.length) resolve(); else if (Date.now() >= deadline) reject(Error('fixture request did not arrive')); else setTimeout(poll, 10) }
        poll()
      })
      runtime.close()
      await pending
      assert.deepEqual(['userApi_init', 'userApi_response', 'userApi_getProxy'].map(name => ipcMain.listenerCount(name)), baseline)
    })
    await check('timed-out script uses cooldown until an explicit refresh', async() => {
      await add({ mode: 'pending' })
      const source = imported.getImportedPlaybackSources()[0]
      await assert.rejects(source.resolve(track('kw'), 'auto', [], false, true), /请求超时/)
      assert.equal(requests.length, 1)
      const before = runtimes.size
      await assert.rejects(source.resolve(track('kw'), 'auto', [], false, true), /请求超时/)
      assert.equal(requests.length, 1)
      assert.equal(runtimes.size, before)
      await assert.rejects(source.resolve(track('kw'), 'auto', [], true, true), /请求超时/)
      assert.equal(requests.length, 2)
      assert.equal(runtimes.size, before + 1)
    })
    await check('missing initialization times out without changing selected API', async() => {
      const script = createImportedScript(base, { mode: 'init-pending' })
      const api = await utils.importApi(script)
      await assert.rejects(runtimeModule.createImportedScriptRuntime(api, script, { initTimeout: 1000 }), /初始化超时/)
    })
    await check('removal invalidates cached imported stream', async() => {
      const api = await add()
      const source = imported.getImportedPlaybackSources()[0]
      await source.resolve(track('kw'), 'auto', [], false, true)
      imported.closeImportedPlayback([api.id])
      utils.removeApi([api.id])
      await assert.rejects(source.resolve(track('kw'), 'auto', [], false, true), /移除|初始化/)
    })
    await check('removal during initialization rejects and closes the hidden runtime', async() => {
      const before = BrowserWindow.getAllWindows().length
      const api = await add({ initDelay: 250 })
      const source = imported.getImportedPlaybackSources()[0]
      const pending = assert.rejects(source.resolve(track('kw'), 'auto', [], false, true), /移除|关闭/)
      await new Promise(resolve => setTimeout(resolve, 50))
      imported.closeImportedPlayback([api.id])
      utils.removeApi([api.id])
      await pending
      await new Promise(resolve => setTimeout(resolve, 30))
      assert.equal(BrowserWindow.getAllWindows().length, before)
      assert.equal(requests.length, 0)
    })
    await check('crashed imported runtime is reconstructed for a later request', async() => {
      const api = await add()
      const source = imported.getImportedPlaybackSources()[0]
      await source.resolve(track('kw'), 'auto', [], false, true)
      const window = BrowserWindow.getAllWindows()[0]
      const crashed = new Promise(resolve => window.webContents.once('render-process-gone', resolve))
      window.webContents.forcefullyCrashRenderer()
      await crashed
      const stream = await source.resolve(track('kw'), 'auto', [], true, true)
      assert.equal(stream.platform, api.name)
      assert.equal(requests.length, 2)
    })
    await check('resolved imported WAV decodes and plays in real Electron media element', async() => {
      const api = await add()
      const stream = await resolver([state('kw', new Error('official unavailable'))], `imported:${api.id}`).resolve(track('kw'))
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } })
      try {
        window.webContents.setAudioMuted(true)
        await window.loadURL('data:text/html;charset=utf-8,<html><body></body></html>')
        const media = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
          const audio=document.createElement('audio');audio.muted=true;audio.src=${JSON.stringify(stream.url)};document.body.append(audio);
          const timer=setTimeout(()=>reject(new Error('generated WAV playback timeout')),5000);
          audio.onerror=()=>{clearTimeout(timer);reject(new Error('media error '+audio.error?.code))};
          audio.onended=()=>{clearTimeout(timer);resolve({duration:audio.duration,currentTime:audio.currentTime,ended:audio.ended})};
          audio.play().catch(reject);
        })`)
        assert.equal(media.ended, true)
        assert.equal(media.duration, 0.5)
        assert.ok(media.currentTime >= 0.49)
      } finally { window.destroy() }
    })
    await check('real media validation distinguishes a short preview from the full recording', async() => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      try {
        await window.loadURL('about:blank')
        const ts = require('typescript')
        const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/renderer/ui/services/streamValidation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
        const result = await window.webContents.executeJavaScript(`(async()=>{const exports={};${code};const short=await exports.readStreamDuration(${JSON.stringify(base + '/tone.wav')});const full=await exports.readStreamDuration(${JSON.stringify(base + '/full.wav')});return {short,full,truncated:exports.isTruncatedStream('00:30',short),complete:!exports.isTruncatedStream('00:30',full)};})()`)
        assert.deepEqual(result, { short: 0.5, full: 30, truncated: true, complete: true })
        const onlineCode = ts.transpileModule(fs.readFileSync(path.join(root, 'src/renderer/core/music/online.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
        const recovery = await window.webContents.executeJavaScript(`(async()=>{
          const compile=(code,deps={})=>{const exports={};new Function('require','exports',code)(name=>deps[name]||{},exports);return exports;};
          const validation=compile(${JSON.stringify(code)});
          const song={id:'kw_song',source:'kw',name:'Fixture Song',singer:'Fixture Singer',interval:'00:30',meta:{songId:'song'}};
          const candidates=[${JSON.stringify(base + '/tone.wav')},${JSON.stringify(base + '/full.wav')}];
          const accepted=[];const rejected=[];
          const online=compile(${JSON.stringify(onlineCode)},{'@renderer/ui/services/streamValidation':validation,'@renderer/ui/services/platformPlayback':{
            preferredQuality:{value:'auto'},acceptStream:(_track,stream)=>accepted.push(stream),
            resolvePlatformStream:async(_track,_refresh,_toggle,_quality,options)=>{rejected.push(options.rejectedUrls);return {url:candidates.find(url=>!options.rejectedUrls.includes(url)),type:'320k',platform:'fixture',musicInfo:song};}
          }});
          const url=await online.getMusicUrl({musicInfo:song,isRefresh:false});return {url,accepted:accepted.length,rejected};
        })()`)
        assert.deepEqual(recovery, { url: base + '/full.wav', accepted: 1, rejected: [[], [base + '/tone.wav']] })
      } finally { window.destroy() }
    })
    const report = { passed: checked.length, checks: checked, network: '127.0.0.1 loopback only', runtime: 'real Electron BrowserWindow + bundled LX preload', selectedApiUnchanged: true }
    console.log('IMPORTED_PLAYBACK_REPORT=' + JSON.stringify(report))
  } finally {
    imported.closeImportedPlayback()
    for (const runtime of runtimes) runtime.close()
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    await new Promise(resolve => server.close(resolve))
  }
  app.exit(0)
}

async function runNode() {
  const { spawn } = require('node:child_process')
  assert.ok(fs.existsSync(path.join(root, 'dist/user-api-preload.js')), 'Build the Electron preload first with npm run build:main')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-imported-playback-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const child = spawn(require('electron'), [__filename, '--electron-fixture', tempRoot], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => { child.kill() }, 90000)
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(timer))
    assert.equal(code, 0, stdout + '\n' + stderr)
    const report = stdout.match(/^IMPORTED_PLAYBACK_REPORT=(.+)$/m)
    assert.ok(report, stdout + '\n' + stderr)
    const result = JSON.parse(report[1])
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true })
    fs.writeFileSync(path.join(root, 'artifacts/imported-playback-regression.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(`${result.passed} imported playback checks passed using real Electron/preload and generated loopback audio`)
  } finally {
    assert.equal(path.dirname(tempRoot), os.tmpdir())
    assert.ok(path.basename(tempRoot).startsWith('linkline-imported-playback-'))
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
  }
}

if (process.versions.electron) runElectron().catch(error => { console.error(error); require('electron').app.exit(1) })
else runNode().catch(error => { console.error(error); process.exitCode = 1 })
