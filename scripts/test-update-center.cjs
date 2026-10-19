const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const vue = require('vue')
const { renderToString } = require('@vue/server-renderer')

const load = (relative, dependencies = {}) => {
  const file = path.resolve(__dirname, '..', relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
  return instance.exports
}

async function run() {
  const markdown = load('src/renderer/ui/services/releaseNotes.ts')
  const ReleaseNotes = load('src/renderer/ui/components/ReleaseNotes.ts', {
    '@common/utils/electron': { openUrl: () => {} },
    '../services/releaseNotes': markdown,
  }).default
  const render = async text => renderToString(vue.createSSRApp(ReleaseNotes, { text }))
  const html = await render('# 更新\n\n## 改进\n- **粗体** 与 *斜体*\n- `code`\n\n3. 第一步\n4. 第二步\n\n> 提示\n\n---\n\n```js\n<script>code</script>\n```\n\n[文档](https://example.com/docs)')
  for (const fragment of ['<h1>更新</h1>', '<h2>改进</h2>', '<ul>', '<strong>粗体</strong>', '<em>斜体</em>', '<code>code</code>', '<ol start="3">', '<blockquote>', '<hr>', '<pre><code>', 'href="https://example.com/docs"']) assert.ok(html.includes(fragment), fragment)
  const unsafe = await render('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[脚本](javascript:alert) [数据](data:text/html,x) [文件](file:///test) [转义](java&#115;cript:alert)')
  assert.ok(!/<script|<img|href=/i.test(unsafe), unsafe)
  assert.ok(unsafe.includes('&lt;script&gt;'))
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/a', '//example.com', 'https://user:pass@example.com', 'https://example.com\n/x']) assert.equal(markdown.releaseNoteLink(url), undefined, url)
  for (const version of ['1.2.0', '1.1.0']) {
    const notes = fs.readFileSync(path.resolve(__dirname, '../docs/releases/v' + version + '.md'), 'utf8')
    const rendered = await render(notes)
    assert.ok(rendered.includes('<h1>LinkLine ' + version + '</h1>'))
    assert.ok(rendered.includes('<h2>'))
    assert.ok(rendered.includes('<li>'))
    assert.ok(rendered.includes('href="https://github.com/'))
  }
  assert.doesNotThrow(() => markdown.parseReleaseNotes('>'.repeat(1000) + 'text'))

  const common = load('src/common/appUpdate.ts')
  const listeners = new Map()
  const calls = []
  const deferred = []
  const source = vue.ref('mirror')
  let checkedRelease = null
  const service = load('src/renderer/ui/services/appUpdate.ts', {
    '@common/appUpdate': common,
    './updatePreferences': { preferredUpdateSource: source, saveUpdateSource: value => { source.value = value } },
    '@common/rendererIpc': {
      rendererOn: (name, callback) => { listeners.set(name, callback) },
      rendererOff: name => { listeners.delete(name) },
      rendererInvoke: (name, request) => {
        calls.push({ name, request })
        if (name === common.LINKLINE_UPDATE_CHECK) return Promise.resolve({ status: 'latest', latestRelease: checkedRelease, history: [], currentVersion: '1.2.0', requestedSource: source.value })
        if (name === common.LINKLINE_UPDATE_INSTALL) return Promise.resolve()
        return new Promise((resolve, reject) => deferred.push({ resolve, reject }))
      },
    },
  })
  const request = { url: common.LINKLINE_REPOSITORY + '/releases/download/v1.2.1/LinkLine-v1.2.1-x64-Setup.exe', fileName: 'LinkLine-v1.2.1-x64-Setup.exe' }
  const first = service.downloadUpdateInstaller(request, { source: 'mirror', size: 100 })
  const duplicate = service.downloadUpdateInstaller(request)
  assert.equal(calls.length, 1, 'repeated requests must share the in-flight transfer')
  const requestId = calls[0].request.requestId
  const progress = { requestId, transferred: 35, total: 100, percent: 35, bytesPerSecond: 15 }
  listeners.get(common.LINKLINE_UPDATE_DOWNLOAD_PROGRESS)({ params: progress })
  service.resetUpdateDownload()
  assert.equal(service.updateDownloadState.value, 'downloading', 'reset while active must not detach the transfer')
  service.updateCenterOpen.value = false
  service.openUpdateCenter()
  await vue.nextTick()
  assert.equal(service.updateDownloadProgress.value.percent, 35, 'reopening and refreshing preserves progress')
  assert.equal(service.updateDownloadTarget.value.fileName, request.fileName)
  assert.equal(calls.filter(call => call.name === common.LINKLINE_UPDATE_DOWNLOAD).length, 1)
  const result = { fileName: request.fileName, filePath: '/fixture/setup.exe', size: 100, sha256: 'a'.repeat(64) }
  deferred[0].resolve(result)
  await Promise.all([first, duplicate])
  assert.equal(service.updateDownloadState.value, 'downloaded')
  await service.downloadUpdateInstaller(request)
  assert.equal(calls.filter(call => call.name === common.LINKLINE_UPDATE_DOWNLOAD).length, 1, 'completed package is reused')
  await service.installDownloadedUpdate()
  assert.equal(calls.at(-1).name, common.LINKLINE_UPDATE_INSTALL)

  service.resetUpdateDownload()
  const failure = service.downloadUpdateInstaller(request).catch(error => error)
  deferred[1].reject(new Error('网络暂时断开'))
  assert.match((await failure).message, /网络暂时断开/)
  assert.equal(service.updateDownloadState.value, 'error')
  assert.equal(service.updateDownloadError.value, '网络暂时断开')
  service.updateCenterOpen.value = false
  service.openUpdateCenter()
  await vue.nextTick()
  assert.equal(service.updateDownloadError.value, '网络暂时断开', 'failed status survives reopening')
  const retry = service.downloadUpdateInstaller(request)
  assert.equal(service.updateDownloadError.value, '')
  assert.equal(service.updateDownloadState.value, 'downloading')
  listeners.get(common.LINKLINE_UPDATE_DOWNLOAD_PROGRESS)({ params: progress })
  assert.equal(service.updateDownloadProgress.value, null, 'late progress from the old request is ignored')
  deferred[2].resolve(result)
  await retry
  assert.equal(service.updateDownloadState.value, 'downloaded')
  assert.equal(listeners.size, 1, 'panels share one process-lifetime progress listener')
  checkedRelease = { version: '1.2.1', assets: [{ name: request.fileName, url: request.url }] }
  await service.checkAppUpdate(true)
  assert.equal(service.updateDownloadState.value, 'downloaded', 'same package and source keeps completed state')
  checkedRelease = { version: '1.2.2', assets: [{ name: 'LinkLine-v1.2.2-x64-Setup.exe', url: request.url.replaceAll('1.2.1', '1.2.2') }] }
  await service.checkAppUpdate(true)
  assert.equal(service.updateDownloadState.value, 'idle', 'a valid newer installer replaces a completed old target')
  assert.equal(service.updateDownloadTarget.value, null)
  const sourceFailure = service.downloadUpdateInstaller(request).catch(error => error)
  deferred[3].reject(new Error('镜像不可用'))
  await sourceFailure
  checkedRelease = { version: '1.2.1', assets: [{ name: request.fileName, url: request.url }] }
  await service.selectUpdateSource('github')
  assert.equal(service.updateDownloadState.value, 'idle', 'a successfully checked new source releases the failed old target')
  const activeSource = service.downloadUpdateInstaller(request, { source: 'github' })
  await service.selectUpdateSource('mirror')
  assert.equal(service.updateDownloadState.value, 'downloading', 'source changes never cancel an active download')
  assert.equal(service.updateDownloadTarget.value.source, 'github')
  deferred[4].resolve(result)
  await activeSource
  console.log('Update center: Markdown rendering, unsafe content, real release notes, shared download, reopen, duplicate, completed, failure and retry checks passed.')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
