/* Exercise player tools with the real Vue watcher lifecycle and a shared timer. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const vue = require('vue')

function load(relative, dependencies) {
  const file = path.resolve(__dirname, '..', relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file)
  return instance.exports
}

const progress = vue.reactive({ nowPlayTime: 0, maxPlayTime: 180 })
const playing = vue.ref(true)
const current = vue.reactive({ musicInfo: { source: 'wy', id: 'one' } })
const seeks = []
const starts = []
const timerTime = vue.ref(-1)
let cancellations = 0
global.window = { app_event: { setProgress: seconds => seeks.push(seconds) } }
const tools = load('src/renderer/ui/services/playerSessionTools.ts', {
  '@renderer/store/player/state': { playMusicInfo: current, isPlay: playing },
  '@renderer/store/player/playProgress': { playProgress: progress },
  '@renderer/core/player/timeoutStop': {
    useTimeout: () => ({ time: timerTime }),
    startTimeoutStop: seconds => { starts.push(seconds); timerTime.value = seconds },
    stopTimeoutStop: () => { cancellations++; timerTime.value = -1 },
  },
})

const dispose = tools.initializePlayerSessionTools()
tools.initializePlayerSessionTools()
assert.throws(() => tools.setABPoint('b', 10), /A 起点/)
tools.setABPoint('a', 4)
assert.throws(() => tools.setABPoint('b', 4.1), /0.25/)
tools.setABPoint('b', 12)
assert.equal(tools.playerSessionTools.abEnabled, true)
progress.nowPlayTime = 12.1
assert.deepEqual(seeks, [4], 'one watcher should seek once even after repeated initialization')
progress.nowPlayTime = 12.2
assert.equal(seeks.length, 1, 'suppress duplicate seeks while the media element applies the loop')
playing.value = false
tools.setABEnabled(true)
progress.nowPlayTime = 13
assert.equal(seeks.length, 1, 'paused audio must not resume or jump')
playing.value = true
tools.setABPoint('a', 15)
assert.equal(tools.playerSessionTools.abEnd, null)
assert.equal(tools.playerSessionTools.abEnabled, false)
tools.setABPoint('b', 20)
current.musicInfo = { source: 'tx', id: 'two' }
assert.equal(tools.playerSessionTools.abStart, null, 'changing tracks clears both loop points')
assert.equal(tools.playerSessionTools.abEnd, null)

assert.throws(() => tools.startSleepTimer(NaN), /1 到 1440/)
assert.throws(() => tools.startSleepTimer(0), /1 到 1440/)
tools.startSleepTimer(15)
assert.deepEqual(starts, [900])
assert.equal(tools.playerSessionTools.sleepRemaining, 900)
timerTime.value = 899
assert.equal(tools.playerSessionTools.sleepRemaining, 899)
tools.startSleepTimer(30)
assert.equal(cancellations, 1, 'replacing the timer cancels the shared timer rather than stacking a second one')
assert.deepEqual(starts, [900, 1800])
timerTime.value = -1
assert.equal(tools.playerSessionTools.sleepDeadline, null, 'timer expiry clears the presentation state')
timerTime.value = 120
assert.equal(tools.playerSessionTools.sleepRemaining, 120, 'timers started from settings appear in the same player menu')
tools.cancelSleepTimer()
assert.equal(timerTime.value, -1)
dispose()
tools.setABPoint('a', 3)
tools.setABPoint('b', 10)
progress.nowPlayTime = 11
assert.deepEqual(seeks, [4, 3], 'tools can restart cleanly after application lifecycle cleanup')
tools.disposePlayerSessionTools()
progress.nowPlayTime = 12
assert.equal(seeks.length, 2, 'cleanup removes the detached playback watcher')

const storage = new Map([['linkline.full-player-presentation.v1', '{broken']])
global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
const presentation = load('src/renderer/ui/services/playerPresentation.ts', {})
assert.deepEqual({ ...presentation.playerPresentation }, { coverLayout: 'square', background: 'blur', immersive: true, spectrum: false, autoCenterCover: true })
presentation.patchPlayerPresentation({ coverLayout: 'vinyl', background: 'dynamic', immersive: false })
assert.equal(JSON.parse(storage.get('linkline.full-player-presentation.v1')).coverLayout, 'vinyl')
assert.deepEqual(presentation.validatePlayerPresentation({ coverLayout: 'invalid', spectrum: 'false', background: 'theme' }), { coverLayout: 'square', background: 'theme', immersive: true, spectrum: false, autoCenterCover: true })
presentation.resetPlayerPresentation()
assert.equal(presentation.playerPresentation.coverLayout, 'square')
console.log('Full player tools: AB playback, cleanup, shared sleep timer, and persisted appearance passed.')
