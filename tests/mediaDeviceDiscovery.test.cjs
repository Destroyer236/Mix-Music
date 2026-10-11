const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/renderer/core/useApp/usePlayer/useMediaDevice.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const output = (deviceId, label = deviceId) => ({ kind: 'audiooutput', deviceId, label })
const settle = async() => { await vue.nextTick(); for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture({ selected = 'default', stopOnRemoval = false, enumerate, setSink } = {}) {
  const appSetting = vue.reactive({ 'player.mediaDeviceId': selected, 'player.isMediaDeviceRemovedStopPlay': stopOnRemoval })
  const calls = { enumerate: 0, saved: [], sinks: [], paused: 0, changed: 0, dialog: 0 }
  const listeners = new Set(), unmount = []
  let devices = [output('default', 'Speaker'), output('headphones', 'Headphones')]
  const window = { app_event: { playerDeviceChanged() { calls.changed++ } }, lx: { isPlayedStop: false }, i18n: { t: text => text } }
  const isPlay = vue.ref(true)
  const scope = vue.effectScope()
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, Promise, console,
    window, navigator: { mediaDevices: {
      async enumerateDevices() { calls.enumerate++; return enumerate ? enumerate() : devices },
      addEventListener(name, listener) { listeners.add(listener) },
      removeEventListener(name, listener) { listeners.delete(listener) },
    } },
    require(name) {
      const imports = {
        '@common/utils/vueTools': { ...vue, onBeforeUnmount: fn => unmount.push(fn) },
        '@renderer/core/player/action': { pause() { calls.paused++ } },
        '@renderer/plugins/Dialog': { dialog() { calls.dialog++; return Promise.resolve() } },
        '@renderer/plugins/player': { async setMediaDeviceId(id) { calls.sinks.push(id); await setSink?.(id) } },
        '@renderer/store/player/state': { isPlay },
        '@renderer/store/setting': { appSetting, saveMediaDeviceId(id) { calls.saved.push(id); appSetting['player.mediaDeviceId'] = id } },
      }
      if (name in imports) return imports[name]
      throw new Error(`Unexpected import ${name}`)
    },
  })
  scope.run(module.exports.default)
  return {
    calls, appSetting, window, isPlay, listeners,
    devices(value) { devices = value }, event() { for (const listener of [...listeners]) listener() },
    dispose() { for (const callback of unmount) callback(); scope.stop() },
  }
}

test('ordinary default output does not enumerate devices or register media discovery listeners', async t => {
  const f = fixture()
  t.after(f.dispose)
  await settle()
  assert.equal(f.calls.enumerate, 0)
  assert.equal(f.listeners.size, 0)
  assert.deepEqual(f.calls.sinks, [])
  f.appSetting['player.isMediaDeviceRemovedStopPlay'] = true
  await settle()
  assert.equal(f.calls.enumerate, 1)
  assert.equal(f.listeners.size, 1)
  assert.equal(f.calls.paused, 0)
  f.appSetting['player.isMediaDeviceRemovedStopPlay'] = false
  await settle()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.calls.enumerate, 1)
  f.event()
  await settle()
  assert.equal(f.calls.enumerate, 1)
})

test('a selected output is applied and missing outputs revert to default without keeping discovery alive', async t => {
  const f = fixture({ selected: 'headphones' })
  t.after(f.dispose)
  await settle()
  assert.deepEqual(f.calls.sinks, ['headphones'])
  assert.equal(f.listeners.size, 1)
  f.devices([output('default', 'Speaker')])
  f.event()
  await settle()
  assert.equal(f.appSetting['player.mediaDeviceId'], 'default')
  assert.equal(f.calls.sinks.at(-1), 'default')
  assert.equal(f.calls.paused, 0)
  assert.equal(f.listeners.size, 0)
  const unknown = fixture({ selected: 'missing' })
  t.after(unknown.dispose)
  await settle()
  assert.equal(unknown.appSetting['player.mediaDeviceId'], 'default')
  assert.equal(unknown.listeners.size, 0)
})

test('removing an output during playback pauses only when requested, including matching device labels', async t => {
  const f = fixture({ selected: 'headphones', stopOnRemoval: true })
  t.after(f.dispose)
  await settle()
  f.devices([output('default', 'Headphones')])
  f.event()
  await settle()
  assert.equal(f.calls.paused, 1)
  assert.equal(f.window.lx.isPlayedStop, true)
  assert.equal(f.appSetting['player.mediaDeviceId'], 'default')
  assert.equal(f.listeners.size, 1)
  f.appSetting['player.isMediaDeviceRemovedStopPlay'] = false
  await settle()
  assert.equal(f.listeners.size, 0)
})

test('an old enumeration cannot overwrite a newer default choice or pause current playback', async t => {
  const first = deferred()
  let count = 0
  const f = fixture({ selected: 'headphones', enumerate: () => ++count === 1 ? first.promise : [output('default', 'Speaker')] })
  t.after(f.dispose)
  f.appSetting['player.mediaDeviceId'] = 'default'
  await settle()
  first.resolve([output('headphones', 'Headphones')])
  await settle()
  assert.equal(f.appSetting['player.mediaDeviceId'], 'default')
  assert.equal(f.listeners.size, 0)
  assert.equal(f.calls.sinks.includes('headphones'), false)
  assert.equal(f.calls.paused, 0)
  assert.deepEqual(f.calls.saved, [])
})

test('native sink operations complete in order and stale completion never persists an older choice', async t => {
  const pending = deferred()
  const f = fixture({ selected: 'headphones', setSink: id => id === 'headphones' ? pending.promise : Promise.resolve() })
  t.after(f.dispose)
  await settle()
  assert.deepEqual(f.calls.sinks, ['headphones'])
  f.appSetting['player.mediaDeviceId'] = 'default'
  await settle()
  assert.deepEqual(f.calls.sinks, ['headphones'])
  pending.resolve()
  await settle()
  assert.deepEqual(f.calls.sinks, ['headphones', 'default'])
  assert.deepEqual(f.calls.saved, [])
  assert.equal(f.appSetting['player.mediaDeviceId'], 'default')
  assert.equal(f.listeners.size, 0)
})

test('returning to a previously applied output still corrects an in-flight change to another sink', async t => {
  const pending = deferred()
  const f = fixture({ selected: 'headphones', setSink: id => id === 'external' ? pending.promise : Promise.resolve() })
  t.after(f.dispose)
  f.devices([output('default', 'Speaker'), output('headphones'), output('external')])
  await settle()
  f.appSetting['player.mediaDeviceId'] = 'external'
  await settle()
  assert.deepEqual(f.calls.sinks, ['headphones', 'external'])
  f.appSetting['player.mediaDeviceId'] = 'headphones'
  await settle()
  pending.resolve()
  await settle()
  assert.deepEqual(f.calls.sinks, ['headphones', 'external', 'headphones'])
  assert.equal(f.appSetting['player.mediaDeviceId'], 'headphones')
  assert.deepEqual(f.calls.saved, [])
})

test('disposal invalidates discovery work and failed output switches fall back to the system sink', async t => {
  const pending = deferred()
  const f = fixture({ selected: 'headphones', enumerate: () => pending.promise })
  f.dispose()
  pending.resolve([output('headphones')])
  await settle()
  assert.equal(f.listeners.size, 0)
  assert.deepEqual(f.calls.sinks, [])
  const failed = fixture({ selected: 'headphones', setSink: id => id === 'headphones' ? Promise.reject(new Error('Unavailable sink')) : Promise.resolve() })
  t.after(failed.dispose)
  await settle()
  assert.equal(failed.appSetting['player.mediaDeviceId'], 'default')
  assert.equal(failed.calls.sinks.at(-1), 'default')
  assert.equal(failed.listeners.size, 0)
})
