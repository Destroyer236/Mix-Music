const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const vue = require('vue')

const frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
const storageKey = 'linkline.player-equalizer.v1'
const key = frequency => `player.soundEffect.biquadFilter.hz${frequency}`
const curve = Object.fromEntries(frequencies.map((frequency, index) => [frequency, index - 3]))
const flat = Object.fromEntries(frequencies.map(frequency => [frequency, 0]))

function harness(bands = curve, storage = new Map()) {
  const setting = vue.reactive(Object.fromEntries(frequencies.map(frequency => [key(frequency), bands[frequency]])))
  const state = { setting, storage, writes: [], merges: [], failSave: false }
  global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const file = path.resolve(__dirname, '../src/renderer/ui/services/playerEqualizer.ts')
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  const dependencies = {
    '@renderer/plugins/player': { freqs: frequencies },
    '@renderer/store/setting': { appSetting: setting, mergeSetting: patch => { state.merges.push(patch); Object.assign(setting, patch) } },
    '@renderer/utils/ipc': { updateSetting: async patch => { state.writes.push(patch); if (state.failSave) throw Error('save failed') } },
  }
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  state.componentScope = vue.effectScope()
  state.componentScope.run(() => instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file))
  state.api = instance.exports
  state.actual = () => Object.fromEntries(frequencies.map(frequency => [frequency, setting[key(frequency)]]))
  return state
}

async function main() {
  let state = harness()
  assert.deepEqual(state.actual(), curve)
  assert.equal(state.merges.length, 0, 'importing EQ must not modify the active DSP settings')
  assert.equal(state.writes.length, 0, 'importing EQ must not persist replacement gains')
  await state.api.setEqualizerEnabled(false)
  assert.equal(state.api.eqBypassed.value, true)
  assert.deepEqual(state.actual(), flat)
  assert.deepEqual({ ...state.api.equalizerGains }, curve, 'bypass retains all ten restore values')
  state.componentScope.stop()
  await state.api.setEqualizerEnabled(true)
  assert.deepEqual(state.actual(), curve, 'closing player details cannot erase the restore curve')
  await state.api.setEqualizerEnabled(false)
  const restartStorage = new Map(state.storage)

  state = harness(flat, restartStorage)
  assert.equal(state.api.eqBypassed.value, true, 'a restart restores bypass separately from the zeroed DSP gains')
  assert.deepEqual({ ...state.api.equalizerGains }, curve)
  assert.equal(state.merges.length, 0)
  await state.api.setEqualizerEnabled(true)
  assert.deepEqual(state.actual(), curve, 'enabling after restart restores the exact previous curve')
  await state.api.setEqualizerEnabled(false)
  state.api.previewEqualizerBand(62, 2.5)
  assert.equal(state.api.eqBypassed.value, false)
  assert.deepEqual(state.actual(), { ...curve, 62: 2.5 }, 'dragging a bypassed slider restores the complete curve before editing')
  await state.api.saveEqualizerBand(62, 2.5)
  assert.equal(Object.keys(state.writes.at(-1)).length, 10, 'committing a slider retains all restored bands across restart')

  const preset = Object.fromEntries(frequencies.map((frequency, index) => [`hz${frequency}`, 5 - index]))
  await state.api.setEqualizerEnabled(false)
  await state.api.applyEqualizerPreset(preset)
  assert.equal(state.api.eqBypassed.value, false)
  assert.deepEqual(state.actual(), Object.fromEntries(frequencies.map(frequency => [frequency, preset[`hz${frequency}`]])))
  await state.api.applyEqualizerPreset(null)
  await state.api.setEqualizerEnabled(false)
  await state.api.setEqualizerEnabled(true)
  assert.deepEqual(state.actual(), flat, 'reset also replaces the remembered curve')

  state.componentScope.stop()
  state.setting[key(250)] = 4
  assert.equal(state.api.equalizerGains[250], 4, 'external settings stay synchronized after the details component is destroyed')
  await state.api.setEqualizerEnabled(false)
  state.setting[key(500)] = -2
  assert.equal(state.api.eqBypassed.value, false, 'external nonzero gains represent an active equalizer')
  assert.deepEqual({ ...state.api.equalizerGains }, state.actual())

  const beforeFailedToggle = state.actual()
  state.failSave = true
  await assert.rejects(state.api.setEqualizerEnabled(false), /save failed/)
  assert.equal(state.api.eqBypassed.value, false)
  assert.deepEqual(state.actual(), beforeFailedToggle, 'failed bypass persistence restores the audible state and curve')
  assert.equal(JSON.parse(state.storage.get(storageKey)).bypassed, false)
  assert.throws(() => state.api.previewEqualizerBand(31, NaN), /增益/)
  await assert.rejects(state.api.applyEqualizerPreset({ ...preset, hz31: Infinity }), /无效/)

  for (const corrupted of ['{broken', JSON.stringify({ bypassed: true, bands: { ...curve, 31: 30 } }), JSON.stringify({ bypassed: 'true', bands: curve }), JSON.stringify({ bypassed: true, bands: { 31: 1 } })]) {
    state = harness(curve, new Map([[storageKey, corrupted]]))
    assert.equal(state.api.eqBypassed.value, false, 'invalid cache cannot bypass an existing EQ')
    assert.deepEqual(state.actual(), curve)
    assert.equal(state.merges.length, 0)
  }
  state = harness(curve, new Map([[storageKey, JSON.stringify({ bypassed: true, bands: flat })]]))
  assert.equal(state.api.eqBypassed.value, false, 'nonzero actual preferences take precedence over stale bypass metadata')
  assert.deepEqual({ ...state.api.equalizerGains }, curve)
  console.log('Player EQ state checks passed: import neutrality, bypass restore after details close/restart, sliders, presets, reset, settings synchronization, corrupt storage and save failure.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
