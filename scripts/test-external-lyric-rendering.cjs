// Exercise the actual Vue components and their CSS in Chromium: paused and
// secondary karaoke text must remain visible, with no idle animation loop.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { parse, compileScript } = require('@vue/compiler-sfc')
const less = require('less')
const root = path.resolve(__dirname, '..')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 60000 })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} else {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-lyric-render-test-')))
  app.on('window-all-closed', () => {})

  async function component(name, dependencies) {
    const filename = path.join(root, `src/renderer-lyric/ui/${name}.vue`)
    const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
    const source = compileScript(descriptor, { id: name, inlineTemplate: true }).content
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    const styles = await less.render(descriptor.styles.map(style => style.content).join('\n'))
    return {
      code: `(function(){const exports={}; const require=name=>{const modules={vue:Vue,${dependencies}}; if (!(name in modules)) throw new Error('Unexpected component dependency: '+name); return modules[name]}; ${code}; return exports.default})()`,
      css: styles.css,
    }
  }

  app.whenReady().then(async() => {
    const line = await component('ExternalLine', "'../core/externalState':state,'../core/externalTiming':timing")
    const cover = await component('ExternalCover', "'../core/externalState':state")
    const taskbar = await component('TaskbarExternal', "'../core/externalState':state,'@common/externalLyric':preferences,'./ExternalLine.vue':ExternalLine,'./ExternalCover.vue':ExternalCover,'@renderer/ui/components/UiIcon.vue':{render:()=>Vue.h('svg')}")
    const timingSource = fs.readFileSync(path.join(root, 'src/renderer-lyric/core/externalTiming.ts'), 'utf8')
    const timing = ts.transpileModule(timingSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const preferenceSource = fs.readFileSync(path.join(root, 'src/common/externalLyric.ts'), 'utf8')
    const preferences = ts.transpileModule(preferenceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const runtime = fs.readFileSync(require.resolve('vue/dist/vue.runtime.global.js'), 'utf8')
    const win = new BrowserWindow({ width: 600, height: 240, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } })
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>body{margin:0;background:#444;color:white}.line-fixture{width:400px;height:40px;--external-played:#fff;--external-unplayed:#888}#taskbar{width:400px;height:48px}${line.css}${cover.css}${taskbar.css}</style><div id="paused" class="line-fixture"></div><div id="secondary" class="line-fixture"></div><div id="taskbar"></div>`))
      await win.webContents.executeJavaScript(`${runtime}
        const timing=(()=>{const exports={};${timing};return exports})()
        const preferences=(()=>{const exports={};${preferences};return exports})()
        const lyric=timing.parseExternalLyric('[00:01.000]<0,1000>Hello <1000,1000>world\\n[00:06.000]Following line');
        const reports=[];
        const state={now:Vue.ref(1500),playing:Vue.ref(false),hovered:Vue.ref(false),lines:Vue.ref(lyric),primaryIndex:Vue.ref(0),track:Vue.reactive({title:'A very long song title that should be truncated instead of scrolling',artist:'Fixture artist',cover:''}),settings:Vue.reactive({...preferences.externalLyricDefaults}),layout:Vue.reactive({anchor:'left',isLight:false,maxWidth:400}),reportSize:(width,height)=>reports.push({width,height}),control:()=>{}};
        state.currentLine=Vue.computed(()=>state.lines.value[state.primaryIndex.value]);
        const ExternalLine=${line.code};
        const ExternalCover=${cover.code};
        const TaskbarExternal=${taskbar.code};
        const pausedProps=Vue.reactive({line:lyric[0],wordByWord:true,active:true});
        Vue.createApp({render:()=>Vue.h(ExternalLine,pausedProps)}).mount('#paused');
        Vue.createApp({render:()=>Vue.h(ExternalLine,{line:lyric[1],wordByWord:true,active:false,secondary:true})}).mount('#secondary');
        Vue.createApp(TaskbarExternal).mount('#taskbar');
        window.lyricFixture={state,reports,pausedProps}; void 0;
      `)
      const settle = () => win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,80))')
      const readWords = selector => win.webContents.executeJavaScript(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}+' .external-word'),word=>({progress:getComputedStyle(word).getPropertyValue('--progress').trim(),background:getComputedStyle(word).backgroundImage}))`)
      await settle()
      const paused = await readWords('#paused')
      assert.equal(paused[0].progress, '50%')
      assert.equal(paused[1].progress, '0%')
      assert(paused.every(word => word.background.startsWith('linear-gradient(')), 'paused karaoke text must have a valid visible gradient')
      const secondary = await readWords('#secondary')
      assert(secondary.length > 0)
      assert(secondary.every(word => word.progress === '0%' && word.background.startsWith('linear-gradient(')), 'the upcoming line must be visibly unplayed')
      await win.webContents.executeJavaScript('window.lyricFixture.state.now.value=2500')
      await settle()
      const sought = await readWords('#paused')
      assert.equal(sought[0].progress, '100%')
      assert.equal(sought[1].progress, '50%', 'seeking while paused must redraw immediately')
      const dimensions = await win.webContents.executeJavaScript('(()=>{const root=document.querySelector(\'#taskbar\');const style=getComputedStyle(root.querySelector(\'.taskbar-wrapper\'));const text=root.querySelector(\'.taskbar-text\');const textStyle=getComputedStyle(text);const cover=root.querySelector(\'.taskbar-cover\');const natural=Math.max(...Array.from(root.querySelectorAll(\'.taskbar-lines .external-line-content\'),node=>node.scrollWidth));return{cover:root.querySelector(\'.external-cover\').getBoundingClientRect().width,container:root.querySelector(\'.taskbar-external\').getBoundingClientRect().height,expected:Math.ceil(Math.min(400,natural+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+cover.offsetWidth+parseFloat(textStyle.marginLeft)+parseFloat(textStyle.marginRight)+8)),reported:window.lyricFixture.reports.at(-1).width}})()')
      assert.equal(dimensions.cover, 32)
      assert.equal(dimensions.container, 40)
      assert.equal(dimensions.reported, dimensions.expected, 'content clipping must include actual padding and the highlight guard')
      // Translation is its own preference: the double-line switch only adds
      // the upcoming lyric (or artist when no lyric is available).
      const translation = '你好，世界'
      const taskbarCases = [
        { name: 'translation enabled with double line disabled', translated: true, showTranslation: true, doubleLine: false, expected: ['Hello world', translation] },
        { name: 'translation enabled with double line enabled', translated: true, showTranslation: true, doubleLine: true, expected: ['Hello world', translation] },
        { name: 'translation disabled with double line enabled', translated: true, showTranslation: false, doubleLine: true, expected: ['Hello world', 'Following line'] },
        { name: 'both preferences disabled', translated: false, showTranslation: false, doubleLine: false, expected: ['Hello world'] },
        { name: 'available translation disabled in single-line mode', translated: true, showTranslation: false, doubleLine: false, expected: ['Hello world'] },
        { name: 'missing translation in single-line mode', translated: false, showTranslation: true, doubleLine: false, expected: ['Hello world'] },
        { name: 'missing translation with double line enabled', translated: false, showTranslation: true, doubleLine: true, expected: ['Hello world', 'Following line'] },
      ]
      for (const scenario of taskbarCases) {
        await win.webContents.executeJavaScript(`(()=>{const state=window.lyricFixture.state;state.lines.value[0].translation=${JSON.stringify(scenario.translated ? translation : '')};state.settings['externalLyric.taskbar.showTranslation']=${scenario.showTranslation};state.settings['externalLyric.taskbar.doubleLine']=${scenario.doubleLine}})()`)
        await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,450))')
        const rendered = await win.webContents.executeJavaScript('Array.from(document.querySelectorAll(\'#taskbar .taskbar-lines .external-line:not(.taskbar-line-leave-active)\'),node=>{const rect=node.getBoundingClientRect();return{text:node.textContent.trim(),secondary:node.classList.contains(\'secondary\'),visible:rect.width>0&&rect.height>0&&parseFloat(getComputedStyle(node).opacity)>0}})')
        assert.deepEqual(rendered.map(row => row.text), scenario.expected, scenario.name)
        assert(rendered.every(row => row.visible), `${scenario.name}: each lyric row must be visible`)
        assert.deepEqual(rendered.map(row => row.secondary), scenario.expected.map((_, index) => index > 0), `${scenario.name}: translation/upcoming row must use secondary styling`)
      }
      for (const doubleLine of [false, true]) {
        await win.webContents.executeJavaScript(`(()=>{const state=window.lyricFixture.state;state.primaryIndex.value=-1;state.settings['externalLyric.taskbar.doubleLine']=${doubleLine}})()`)
        await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,450))')
        const metadata = await win.webContents.executeJavaScript('Array.from(document.querySelectorAll(\'#taskbar .taskbar-lines .external-line:not(.taskbar-line-leave-active)\'),node=>node.textContent.trim())')
        assert.deepEqual(metadata, doubleLine ? ['A very long song title that should be truncated instead of scrolling', 'Fixture artist'] : ['A very long song title that should be truncated instead of scrolling'], `no lyric: double line ${doubleLine} controls the artist row`)
      }
      await win.webContents.executeJavaScript('window.lyricFixture.state.primaryIndex.value=0')
      await win.webContents.executeJavaScript('window.lyricFixture.state.hovered.value=true')
      await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,550))')
      const hover = await win.webContents.executeJavaScript('(()=>{const button=document.querySelector(\'.taskbar-controls button\');const title=document.querySelector(\'.taskbar-title\');return{button:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height,border:getComputedStyle(button).borderColor,ellipsis:getComputedStyle(title).textOverflow,report:window.lyricFixture.reports.at(-1).width}})()')
      assert.equal(hover.button, 32)
      assert.equal(hover.height, 32)
      assert.match(hover.border, /0\.24\)/)
      assert.equal(hover.ellipsis, 'ellipsis')
      assert.equal(hover.report, 400)
      // Once paused measurements settle, neither lyric component should schedule
      // perpetual frames. Count future requests without changing browser timing.
      await win.webContents.executeJavaScript('window.lyricRafCount=0; const originalRaf=window.requestAnimationFrame;window.requestAnimationFrame=callback=>{window.lyricRafCount++;return originalRaf(callback)};void 0')
      await settle()
      assert.equal(await win.webContents.executeJavaScript('window.lyricRafCount'), 0)
      console.log('PASS external lyric rendering: visible paused/upcoming words, paused seek, taskbar translation and double-line preferences, spacing/buttons, clipping guard and idle frames')
    } finally { win.destroy() }
    app.quit()
  }).catch(error => { console.error(error); process.exitCode = 1; app.exit(1) })
}
