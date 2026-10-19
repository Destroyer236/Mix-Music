// Windows regression: fractional-DPI native bounds must never feed back into lyric size.
// Run with: node scripts/test-external-lyric-geometry.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

if (process.platform !== 'win32') {
  console.log('SKIP external lyric native geometry: Windows-only regression')
} else if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename, '--force-device-scale-factor=1.5'], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit', timeout: 60000 })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} else {
  const { app, BrowserWindow, screen } = require('electron')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-lyric-geometry-test-'))
  app.setPath('userData', directory)
  app.setName('LinkLine Lyric Geometry Test')
  app.on('window-all-closed', () => {})
  const pause = () => new Promise(resolve => setTimeout(resolve, 4))
  const checked = []
  const checkSize = (win, expected, label) => {
    const bounds = win.getBounds()
    // Converting physical edges back to DIP can enclose one extra DIP at 150%.
    assert(Math.abs(bounds.width - expected.width) <= 1, `${label}: width drifted to ${bounds.width}, expected ${expected.width}`)
    assert(Math.abs(bounds.height - expected.height) <= 1, `${label}: height drifted to ${bounds.height}, expected ${expected.height}`)
  }

  app.whenReady().then(async () => {
    const filename = path.resolve(__dirname, '../src/main/modules/externalLyric/windowGeometry.ts')
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const exportsObject = {}
    vm.runInNewContext(output, { exports: exportsObject, require }, { filename })
    const { LyricWindowGeometry } = exportsObject
    assert.equal(screen.getPrimaryDisplay().scaleFactor, 1.5, 'native regression must run at 150% display scale')
    for (const mode of ['desktop', 'island']) {
      const expected = { width: mode === 'desktop' ? 800 : 360, height: mode === 'desktop' ? 200 : 40 }
      const win = new BrowserWindow({ x: 120, y: 200, ...expected, frame: false, transparent: true, hasShadow: false, show: false, roundedCorners: false, resizable: mode === 'desktop', minWidth: mode === 'desktop' ? 240 : 0, minHeight: mode === 'desktop' ? 80 : 0 })
      try {
        win.showInactive()
        const geometry = new LyricWindowGeometry(win, expected)
        let nativeWrites = 0
        const originalSetBounds = win.setBounds.bind(win)
        win.setBounds = (...args) => { nativeWrites++; return originalSetBounds(...args) }
        // A stationary pointer can still issue repeated events while held.
        for (let index = 0; index < 120; index++) {
          geometry.setBounds({ x: 120, y: 200, ...geometry.getSize() })
          await pause()
          checkSize(win, expected, `${mode} hold ${index}`)
        }
        const beforeEcho = nativeWrites
        // Save/update-config feeds the same logical geometry back into the window.
        for (let index = 0; index < 50; index++) geometry.setBounds({ ...win.getBounds(), ...geometry.getSize() })
        assert.equal(nativeWrites, beforeEcho, `${mode}: unchanged config echo should not call the native geometry setter`)
        for (let index = 0; index < 180; index++) {
          geometry.setBounds({ x: 120 + index % 80, y: 200 + index % 80, ...geometry.getSize() })
          await pause()
          checkSize(win, expected, `${mode} drag ${index}`)
          const saved = { ...geometry.getSize() }
          geometry.setBounds({ ...win.getBounds(), ...saved })
          checkSize(win, expected, `${mode} persisted drag ${index}`)
        }
        // A one-axis width adjustment must preserve the intended other axis.
        for (let index = 0; index < 80; index++) {
          const width = expected.width + index % 2 * 20
          geometry.setBounds({ ...win.getBounds(), ...geometry.getSize(), width })
          await pause()
          checkSize(win, { ...expected, width }, `${mode} width ${index}`)
        }
        // Content/font height changes must preserve width, including island line changes.
        for (let index = 0; index < 80; index++) {
          const height = expected.height + index % 2 * 12
          geometry.setBounds({ ...win.getBounds(), ...geometry.getSize(), width: expected.width, height })
          await pause()
          checkSize(win, { ...expected, height }, `${mode} height ${index}`)
        }
        // Native user resizing is an explicit size input, unlike a move/config echo.
        geometry.captureResize({ ...win.getBounds(), width: expected.width + 120, height: expected.height + 20 })
        const resized = geometry.getSize()
        assert.equal(resized.width, expected.width + 120)
        assert.equal(resized.height, expected.height + 20)
        for (let index = 0; index < 80; index++) {
          geometry.setBounds({ x: 300 + index % 40, y: 300 + index % 40, ...geometry.getSize() })
          await pause()
          checkSize(win, resized, `${mode} drag after native resize ${index}`)
        }
        checked.push(`${mode}: hold, drag, config echo, width/height changes and manual resize remain stable at 150% DPI`)
      } finally { win.destroy() }
    }
    for (const label of checked) console.log(`PASS ${label}`)
    app.quit()
  }).catch(error => { console.error(error); process.exitCode = 1; app.exit(1) })
}
