// Compile the real production dependency graph before running the isolated
// Electron fixture. This catches defects hidden by transpileModule loaders.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const webpack = require('webpack')

const output = fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-verification-bundle-'))
const development = process.argv.includes('--development')
const base = require(development ? '../build-config/main/webpack.config.dev' : '../build-config/main/webpack.config.prod')
const config = {
  ...base,
  entry: { passport: path.resolve(__dirname, '../src/main/modules/platformAccounts/qishuiPassport.ts') },
  output: { ...base.output, path: output },
  plugins: base.plugins.filter(plugin => plugin.constructor.name !== 'CopyPlugin'),
}

webpack(config, (error, stats) => {
  try {
    if (error) throw error
    if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }))
    console.log(`${development ? 'Development' : 'Production'} configuration: ${stats.toString({ all: false, timings: true, assets: true })}`)
    const result = spawnSync(require('electron'), [path.join(__dirname, 'test-qishui-verification-electron.cjs')], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, LINKLINE_QISHUI_PASSPORT_TEST_BUNDLE: path.join(output, 'passport.js') },
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } catch (failure) {
    console.error(failure)
    process.exitCode = 1
  } finally {
    if (path.dirname(output) !== path.resolve(os.tmpdir()) || !path.basename(output).startsWith('linkline-verification-bundle-')) throw new Error('Unexpected verification test output path')
    fs.rmSync(output, { recursive: true, force: true })
  }
})
