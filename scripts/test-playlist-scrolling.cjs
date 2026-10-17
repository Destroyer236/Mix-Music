/* Run real playlist components in an isolated, offline Electron renderer. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')
const less = require('less')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

const root = path.resolve(__dirname, '..')
const ui = path.join(root, 'src/renderer/ui')
const maxMountedRows = 80

function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_MODULE_PATH,
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try { return require(candidate) } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error('Install playwright, or set PLAYWRIGHT_MODULE_PATH to its package directory.')
}

function commonjs(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

async function compileFixture() {
  const modules = {}
  const styles = []
  for (const filename of ['styles.less', 'qq-music.less']) {
    const fullPath = path.join(ui, filename)
    styles.push((await less.render(fs.readFileSync(fullPath, 'utf8'), { filename: fullPath })).css)
  }
  for (const filename of ['components/PlaylistHeader.vue', 'components/TrackTable.vue', 'components/PlaylistFloatingButtons.vue', 'components/LazyListEnd.vue']) {
    const fullPath = path.join(ui, filename)
    const { descriptor, errors } = parse(fs.readFileSync(fullPath, 'utf8'), { filename: fullPath })
    assert.deepEqual(errors, [], `${filename} parses`)
    const script = compileScript(descriptor, { id: filename })
    const template = compileTemplate({
      source: descriptor.template.content,
      filename: fullPath,
      id: filename,
      compilerOptions: { bindingMetadata: script.bindings, expressionPlugins: ['typescript'] },
    })
    assert.deepEqual(template.errors, [], `${filename} template compiles`)
    modules[filename] = commonjs(script.content) + '\nconst renderModule = { exports: {} };(function(module,exports,require){' +
      commonjs(template.code) + '\n})(renderModule,renderModule.exports,require);module.exports.default.render = renderModule.exports.render;'
    for (const style of descriptor.styles) styles.push((await less.render(style.content, { filename: fullPath })).css)
  }
  for (const filename of ['useVirtualTrackList.ts', 'useProgressiveList.ts', 'useCollapsingPlaylistHeader.ts']) {
    modules[filename] = commonjs(fs.readFileSync(path.join(ui, filename), 'utf8'))
  }
  return { modules, styles }
}

// Only artwork, metadata navigation, and player state are stubbed: no IPC,
// network, account, audio playback, or existing application data are needed.
function bootstrap(modules) {
  const player = Vue.reactive({ musicInfo: null })
  const route = Vue.reactive({ fullPath: '/library/first', path: '/library', query: {} })
  const cache = {}
  const normalize = value => {
    const result = []
    for (const part of value.split('/')) {
      if (part === '..') result.pop()
      else if (part && part !== '.') result.push(part)
    }
    return result.join('/')
  }
  const load = (request, importer = '') => {
    if (request === 'vue') return Vue
    if (request === 'vue-router') return { useRoute: () => route, useRouter: () => ({ push: () => Promise.resolve() }) }
    if (request === '@renderer/store/player/state') return { playMusicInfo: player }
    if (request.endsWith('/catalogSearch')) return { getCatalogSources: () => ['wy'] }
    if (request.endsWith('/TrackArtwork.vue')) return { default: { template: '<span aria-hidden="true">♫</span>' } }
    if (request.endsWith('/TrackTitle.vue')) return { default: { props: ['text'], template: '<span class="ui-track-title">{{ text }}</span>' } }
    if (request.endsWith('/UiEmpty.vue')) return { default: { props: ['title'], template: '<div class="fixture-empty">{{ title }}</div>' } }
    if (request.endsWith('/UiIcon.vue')) return { default: { template: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M12 4v16" /></svg>' } }
    const resolved = request.startsWith('.') ? normalize(importer.split('/').slice(0, -1).join('/') + '/' + request) : request
    const filename = Object.hasOwn(modules, resolved) ? resolved : resolved + '.ts'
    if (!Object.hasOwn(modules, filename)) throw new Error(`Unstubbed fixture dependency: ${request} from ${importer}`)
    if (cache[filename]) return cache[filename].exports
    const instance = { exports: {} }
    cache[filename] = instance
    new Function('module', 'exports', 'require', modules[filename])(instance, instance.exports, request => load(request, filename))
    return instance.exports
  }
  const TrackTable = load('components/TrackTable.vue').default
  const PlaylistHeader = load('components/PlaylistHeader.vue').default
  const PlaylistFloatingButtons = load('components/PlaylistFloatingButtons.vue').default
  const useCollapsingPlaylistHeader = load('useCollapsingPlaylistHeader.ts').useCollapsingPlaylistHeader
  Vue.createApp({
    components: { TrackTable, PlaylistHeader, PlaylistFloatingButtons },
    setup() {
      const original = Array.from({ length: 5000 }, (_, index) => ({
        id: `track-${index}`, source: 'wy', name: `测试歌曲 ${index}`, singer: `歌手 ${index % 9}`,
        interval: '03:45', meta: { albumName: `专辑 ${index % 13}` },
      }))
      const tracks = Vue.ref(original)
      const listId = Vue.ref('first')
      const container = Vue.ref(null)
      const table = Vue.ref(null)
      const offset = Vue.ref(100)
      const selectedIds = Vue.ref(new Set(['track-4500']))
      const events = []
      const compact = useCollapsingPlaylistHeader(container, [listId], '.track-table__rows')
      player.musicInfo = original[4500]
      const record = (type, track, index) => events.push({ type, id: track.id, index })
      window.__playlistQa = { tracks, listId, table, compact, player, route, events, original, offset, selectedIds }
      return { tracks, listId, container, table, compact, offset, selectedIds, record }
    },
    template: `<div class="ui-shell"><section ref="container" class="ui-library">
      <main class="ui-library-main"><PlaylistHeader title="长歌单滚动测试" :compact="compact">
        <template #cover><span>♫</span></template><template #details><p>离线回归测试</p><p>5000 首歌曲</p></template>
        <template #actions><button>播放全部</button></template>
      </PlaylistHeader><div class="ui-library-results"><TrackTable ref="table" :list="tracks" :list-id="listId" :offset="offset" :selected-ids="selectedIds" removable virtualized
        @play="(track, index) => record('play', track, index)" @add="(track, index) => record('add', track, index)"
        @download="(track, index) => record('download', track, index)" @remove="(track, index) => record('remove', track, index)">
        <template #selection="{ track, index }"><button class="fixture-selection" @click="record('selection', track, index)">选</button></template>
        <template #actions="{ track, index }"><button class="fixture-extra-action" @click="record('extra', track, index)">更多</button></template>
      </TrackTable></div></main><PlaylistFloatingButtons :container="container" :tracks="tracks"
        @jump-current="index => table?.scrollToIndex(index)" @scroll-to-top="table?.scrollToTop()" />
    </section></div>`,
  }).mount('#root')
}

const fixtureCss = `
html { --modern-bg:#101116;--modern-panel:#191a22;--modern-text:#efeff5;--modern-muted:#9c9eac;--modern-border:#30323d;--modern-accent:#ada8f5;--modern-accent-contrast:#14121f;--modern-accent-ink:#c0bdfb;--modern-accent-soft:#2b293b;--modern-hover:#292a35;--modern-radius:14px;--modern-radius-small:12px;--modern-row-height:48px;--modern-panel-gap:12px; }
* { box-sizing:border-box } html,body,#root { height:100%;margin:0;overflow:hidden }
.ui-shell { display:block!important;height:100%;padding:20px!important }
.ui-library { position:relative;height:100%;display:flex;min-height:0 }
.ui-library-main { display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;padding:16px!important }
.ui-library-results { flex:1;min-height:0;overflow:hidden }
.ui-library-results .track-table { height:100% }
`

async function frames(page, count = 4) {
  await page.evaluate(async count => {
    for (let index = 0; index < count; index++) await new Promise(resolve => requestAnimationFrame(resolve))
  }, count)
}

async function snapshot(page) {
  return page.evaluate(() => {
    const container = document.querySelector('.track-table__rows')
    return {
      top: container.scrollTop, height: container.clientHeight, scrollHeight: container.scrollHeight,
      compact: window.__playlistQa.compact.value,
      rows: [...container.querySelectorAll('.track-table__row')].map(row => ({
        key: row.dataset.trackKey, index: Number(row.dataset.trackIndex),
        number: row.querySelector('.track-table__index').textContent.trim(),
      })),
    }
  })
}

function assertBounded(state, label) {
  assert(state.rows.length > 0 && state.rows.length <= maxMountedRows, `${label}: mounted ${state.rows.length} rows`)
  assert(state.height > 100, `${label}: song viewport is usable`)
  for (let index = 1; index < state.rows.length; index++) {
    assert.equal(state.rows[index].index, state.rows[index - 1].index + 1, `${label}: indexes are contiguous`)
  }
}

async function assertVisible(page, trackId, label) {
  await page.waitForFunction(id => {
    const row = [...document.querySelectorAll('.track-table__row')].find(row => row.dataset.trackKey === `wy:${id}`)
    if (!row) return false
    const bounds = row.getBoundingClientRect()
    const viewport = row.parentElement.getBoundingClientRect()
    return bounds.top >= viewport.top - 1 && bounds.bottom <= viewport.bottom + 1
  }, trackId, { timeout: 3000 })
  assertBounded(await snapshot(page), label)
}

async function startMonitor(page) {
  await page.evaluate(() => {
    const samples = []
    const longTasks = []
    let running = true
    const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
      ? new PerformanceObserver(entries => longTasks.push(...entries.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))))
      : null
    observer?.observe({ type: 'longtask' })
    const sample = time => {
      const rows = document.querySelector('.track-table__rows')
      samples.push({ time, top: rows?.scrollTop ?? 0, count: rows?.querySelectorAll('.track-table__row').length ?? 0 })
      if (running) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    window.__playlistMonitor = {
      stop() {
        running = false
        longTasks.push(...(observer?.takeRecords() ?? []).map(entry => ({ start: entry.startTime, duration: entry.duration })))
        observer?.disconnect()
        return { samples, longTasks, supported: Boolean(observer) }
      },
    }
  })
}

async function run() {
  const { _electron: electron } = loadPlaywright()
  const { modules, styles } = await compileFixture()
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-playlist-scroll-'))
  const html = path.join(temporary, 'fixture.html')
  const main = path.join(temporary, 'main.cjs')
  const vueUrl = pathToFileURL(path.join(root, 'node_modules/vue/dist/vue.global.prod.js')).href
  const setup = `(${bootstrap.toString()})(${JSON.stringify(modules)});`
  fs.writeFileSync(html, '<!doctype html><html data-modern-theme="dark"><head><meta charset="utf-8"><style>' + styles.join('\n') + fixtureCss +
    '</style></head><body><div id="root"></div><script src="' + vueUrl + '"></script><script>' + setup.replaceAll('</script', '<\\/script') + '</script></body></html>')
  fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temporary, 'profile'))});app.whenReady().then(()=>{const win=new BrowserWindow({width:1280,height:760,show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true}});win.loadFile(${JSON.stringify(html)})});app.on('window-all-closed',()=>app.quit());`)
  const errors = []
  const checks = []
  let app
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [main], timeout: 30000 })
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await page.waitForSelector('.track-table__row')
    await frames(page, 25)
    const initial = await snapshot(page)
    assertBounded(initial, 'initial list')
    assert.equal(initial.rows[0].index, 0)
    assert.equal(initial.rows[0].number, '101', 'number includes the caller offset')
    assert.equal(initial.compact, false)

    await startMonitor(page)
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.locator('[aria-label="跳转到当前播放歌曲"]').click()
      await assertVisible(page, 'track-4500', `deep jump ${cycle}`)
      await frames(page, 25)
      assert.equal((await snapshot(page)).compact, true, 'deep navigation collapses the cover')
      await page.locator('[aria-label="回到歌单顶部"]').click()
      await frames(page, 25)
      const top = await snapshot(page)
      assertBounded(top, `return to top ${cycle}`)
      assert.equal(top.top, 0, 'return to top completes immediately')
      assert.equal(top.rows[0].index, 0, 'top rows are restored without retaining the deep prefix')
      assert.equal(top.compact, true, 'programmatic return to top keeps the compact header')
      const stable = await page.evaluate(async () => {
        const values = []
        for (let index = 0; index < 12; index++) {
          await new Promise(resolve => requestAnimationFrame(resolve))
          values.push(document.querySelector('.track-table__rows').scrollTop)
        }
        return values
      })
      assert(stable.every(top => top === 0), 'return to top has no delayed scroll anchoring or jump loop')
    }
    await frames(page)
    const navigation = await page.evaluate(() => window.__playlistMonitor.stop())
    assert(navigation.samples.every(sample => sample.count <= maxMountedRows), 'DOM stays bounded throughout deep navigation')
    // Keep the strict long-task assertion scoped to warmed-up navigation, so
    // source compilation and initial Vue mount cannot pollute the measurement.
    assert.deepEqual(navigation.longTasks, [], 'jump/current + return/top should introduce no >50 ms renderer tasks')
    checks.push({ check: '5000 tracks, three jump-to-4500 / return-to-top cycles', maxRows: Math.max(...navigation.samples.map(sample => sample.count)), longTasks: navigation.longTasks.length })

    // An upward wheel while still deep in the list must never reveal the cover.
    await page.locator('[aria-label="跳转到当前播放歌曲"]').click()
    await frames(page, 25)
    await page.evaluate(() => {
      const container = document.querySelector('.track-table__rows')
      container.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
      container.scrollTop -= 120
    })
    await frames(page, 25)
    assert.equal((await snapshot(page)).compact, true, 'scrolling upward in the middle keeps the compact header')

    // Reaching zero is separate from a subsequent upward gesture at zero.
    await page.evaluate(() => { document.querySelector('.track-table__rows').scrollTop = 100 })
    await frames(page)
    await page.evaluate(() => {
      const container = document.querySelector('.track-table__rows')
      container.dispatchEvent(new WheelEvent('wheel', { deltaY: -160, bubbles: true }))
      container.scrollTop = 0
    })
    await frames(page, 25)
    assert.equal((await snapshot(page)).compact, true, 'the gesture that first reaches zero does not reveal the cover')
    await page.evaluate(() => document.querySelector('.track-table__play strong').dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true })))
    await frames(page, 25)
    assert.equal((await snapshot(page)).compact, false, 'an additional upward wheel at zero reveals the cover')
    checks.push({ check: 'upward scrolling expands only after reaching the top and scrolling again' })

    await page.locator('[aria-label="跳转到当前播放歌曲"]').click()
    await frames(page, 25)
    const deepRow = page.locator('[data-track-key="wy:track-4500"]')
    assert.equal(await deepRow.locator('.track-table__index').textContent(), '4601', 'deep row retains its global number')
    assert(await deepRow.evaluate(row => row.classList.contains('track-table__row--playing') && row.classList.contains('track-table__row--selected')), 'playing and selected styling follows the track')
    for (const selector of ['.track-table__play', '[aria-label="添加到歌单"]', '[aria-label="下载"]', '[aria-label="从歌单移除"]', '.fixture-extra-action', '.fixture-selection']) {
      await deepRow.locator(selector).evaluate(button => button.click())
    }
    const events = await page.evaluate(() => window.__playlistQa.events)
    assert.deepEqual(events.map(event => event.type), ['play', 'add', 'download', 'remove', 'extra', 'selection'])
    assert(events.every(event => event.id === 'track-4500' && event.index === 4500), 'events and slots preserve the original global index')
    checks.push({ check: 'deep rows preserve numbering, playback, selection, and every row operation index' })

    await page.evaluate(() => { window.__playlistQa.tracks.value = [...window.__playlistQa.tracks.value].reverse() })
    await frames(page, 25)
    const reordered = await snapshot(page)
    assertBounded(reordered, 'reordered list')
    assert.equal(reordered.top, 0, 'new ordering resets the viewport')
    assert.equal(reordered.rows[0].key, 'wy:track-4999', 'reordering refreshes visible records')
    await page.locator('[aria-label="跳转到当前播放歌曲"]').click()
    await assertVisible(page, 'track-4500', 'jump after reorder')
    assert.equal(await page.locator('[data-track-key="wy:track-4500"]').getAttribute('data-track-index'), '499', 'jump resolves the current track in the new order')

    await page.evaluate(() => { window.__playlistQa.listId.value = 'second' })
    await frames(page, 25)
    const changedList = await snapshot(page)
    assert.equal(changedList.top, 0, 'changing playlist resets scroll even when the tracks are shared')
    assert.equal(changedList.compact, false, 'a new playlist starts with its full cover')
    checks.push({ check: 'reordering and playlist identity changes reset the scroll window' })

    for (const [width, height] of [[800, 620], [650, 820], [1280, 760]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height])
      await frames(page, 25)
      await page.locator('[aria-label="跳转到当前播放歌曲"]').click()
      await frames(page, 25)
      await assertVisible(page, 'track-4500', `resize ${width}x${height}`)
    }
    // A theme/density change can alter row height independently of window size.
    await page.evaluate(() => document.documentElement.style.setProperty('--modern-row-height', '64px'))
    await frames(page, 25)
    await page.locator('[aria-label="跳转到当前播放歌曲"]').click()
    await frames(page, 25)
    await assertVisible(page, 'track-4500', 'row density change')
    checks.push({ check: 'deep navigation remains accurate across viewport and row density changes' })

    await page.evaluate(() => { window.__playlistQa.tracks.value = []; window.__playlistQa.listId.value = 'empty' })
    await frames(page)
    assert.equal(await page.locator('.track-table__row').count(), 0)
    assert.equal(await page.locator('.playlist-floating-buttons').count(), 0)
    await page.evaluate(() => { window.__playlistQa.tracks.value = window.__playlistQa.original.slice(0, 1); window.__playlistQa.listId.value = 'single' })
    await frames(page, 25)
    assert.equal((await snapshot(page)).rows.length, 1)
    assert.equal((await snapshot(page)).top, 0)
    assert.deepEqual(errors, [], 'the fixture has no uncaught renderer errors')
    console.log(JSON.stringify({ pass: true, fixture: 'real Vue components, isolated offline Electron window', checks }, null, 2))
  } finally {
    if (app) await app.close()
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()), 'fixture cleanup stays in the system temporary directory')
    assert(path.basename(temporary).startsWith('linkline-playlist-scroll-'), 'only the generated fixture directory is removed')
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
