/* Imported playback preferences: schema, persistence, shared menus and removal. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const vue = require('vue')

const load = (relative, dependencies = {}) => {
  const file = path.resolve(__dirname, '..', relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file)
  return instance.exports
}

async function run() {
  const sources = load('src/common/platformSources.ts')
  const id = 'user_api_123_1720000000000'
  const source = sources.createImportedSource(id)
  assert.equal(source, 'imported:' + id)
  assert.equal(sources.getImportedSourceId(source), id)
  assert.equal(sources.isPreferredPlatformSource(source), true)
  for (const value of ['imported:', 'imported:wy', 'imported:user_api_', 'imported:user_api_x/y', 'imported:user_api_a\n', 'constructor', null, {}]) {
    assert.equal(sources.isPreferredPlatformSource(value), false, JSON.stringify(value))
    assert.equal(sources.getImportedSourceId(value), null)
  }
  assert.throws(() => sources.createImportedSource('wy'))
  const apis = vue.reactive({ list: [{ id, name: '测试音源' }, { id: 'user_api_other', name: '另一个音源' }] })
  const setting = vue.reactive({ 'player.preferredSource': source, 'common.apiSource': 'user_api_other' })
  const options = load('src/renderer/ui/services/playbackSourceOptions.ts', {
    '@common/platformSources': sources, '@renderer/store': { userApi: apis }, '@renderer/store/setting': { appSetting: setting },
  }).preferredSourceOptions
  assert.equal(options.value.length, 11)
  assert.deepEqual(options.value[9], { value: source, label: '测试音源 · 导入音源' })
  assert.equal(options.value[10].value, 'imported:user_api_other', 'inactive imported scripts remain selectable')
  apis.list[0].name = '重命名音源'
  assert.equal(options.value[9].label, '重命名音源 · 导入音源')
  apis.list.shift()
  assert.match(options.value.find(item => item.value === source).label, /已移除/)
  setting['player.preferredSource'] = 'auto'
  assert.equal(options.value.length, 10)

  const defaultSetting = load('src/common/defaultSetting.ts', { './externalLyric': load('src/common/externalLyric.ts') }).default
  const schema = load('src/renderer/ui/settings/schema.ts', {
    '@common/defaultSetting': { default: defaultSetting, __esModule: true },
    '@common/config': { windowSizeList: [] }, '@root/lang': { langList: [] },
    '@common/platformSources': sources, '@common/platformPlayback': load('src/common/platformPlayback.ts'),
  })
  const field = schema.settingFields.find(item => item.key === 'player.preferredSource')
  assert.equal(schema.parseSettingValue(field, source), source)
  assert.deepEqual(schema.validateSettingBackup({ 'player.preferredSource': source }), { 'player.preferredSource': source })
  assert.throws(() => schema.parseSettingValue(field, 'imported:wy'), /有效/)
  assert.deepEqual(schema.validateSettingBackup({ 'player.preferredSource': 'imported:wy' }), {})

  global.window = { lxData: {} }
  const renderer = load('src/renderer/store/setting.ts', {
    '@common/utils/vueTools': vue, '@common/defaultSetting': { default: defaultSetting, __esModule: true },
    '@common/platformPlayback': load('src/common/platformPlayback.ts'), '@common/platformSources': sources, '@renderer/utils/ipc': {},
  })
  renderer.mergeSetting({ 'player.preferredSource': source })
  assert.equal(renderer.appSetting['player.preferredSource'], source)
  renderer.mergeSetting({ 'player.preferredSource': 'imported:wy' })
  assert.equal(renderer.appSetting['player.preferredSource'], source, 'renderer ignores invalid persisted keys')

  const sourceConfig = load('src/main/modules/userApi/config/index.ts')
  const savedSettings = []
  const main = load('src/main/utils/index.ts', {
    '@common/utils': { throttle: fn => fn }, '@common/utils/migrateSetting': { default: x => x, __esModule: true },
    '@main/utils/store': { default: () => ({ override: value => savedSettings.push(structuredClone(value)) }), __esModule: true },
    '@common/constants': { STORE_NAMES: { APP_SETTINGS: 'settings' } }, '@common/defaultSetting': { default: defaultSetting, __esModule: true },
    '@common/defaultHotKey': {}, './migrate': {}, electron: {}, '@common/utils/nodejs': {}, '@common/theme/index.json': [],
    '@common/windowClose': { migrateWindowCloseSetting: value => value }, '@common/platformSources': sources,
    '@main/modules/userApi/config': sourceConfig,
  })
  assert.equal(main.mergeSetting(defaultSetting, { 'player.preferredSource': source }).setting['player.preferredSource'], source)
  assert.equal(main.mergeSetting(defaultSetting, { ...defaultSetting, 'player.preferredSource': source }).setting['player.preferredSource'], source, 'full settings restore retains imported preference')
  assert.equal(main.mergeSetting(defaultSetting, { 'player.preferredSource': 'imported:wy' }).setting['player.preferredSource'], 'auto')
  assert.equal(defaultSetting['common.apiSource'], '', 'fresh installs must start without a selected custom source')
  const previousLx = global.lx
  const previousEnv = global.envParams
  global.envParams = { cmdParams: {} }
  try {
    for (const retiredId of sourceConfig.retiredDefaultSourceIds) {
      global.lx = { appSetting: { ...defaultSetting, 'common.apiSource': id, 'player.preferredSource': source } }
      const backup = { 'common.apiSource': retiredId, 'player.preferredSource': `imported:${retiredId}`, 'player.volume': 0.45 }
      const before = structuredClone(backup)
      const restored = main.updateSetting(backup)
      assert.equal(restored.setting['common.apiSource'], '')
      assert.equal(restored.setting['player.preferredSource'], 'auto')
      assert.equal(restored.updatedSetting['common.apiSource'], '', 'renderer update patch must clear a removed source')
      assert.equal(restored.updatedSetting['player.preferredSource'], 'auto', 'renderer update patch must reset a removed preference')
      assert.ok(restored.updatedSettingKeys.includes('common.apiSource'))
      assert.ok(restored.updatedSettingKeys.includes('player.preferredSource'))
      assert.equal(savedSettings.at(-1).setting['common.apiSource'], '')
      assert.equal(savedSettings.at(-1).setting['player.preferredSource'], 'auto')
      assert.equal(savedSettings.at(-1).setting['player.volume'], 0.45)
      assert.deepEqual(backup, before)
      const initialized = main.updateSetting({ ...defaultSetting, ...backup }, true)
      assert.equal(initialized.setting['common.apiSource'], '')
      assert.equal(initialized.setting['player.preferredSource'], 'auto')
      assert.equal(savedSettings.at(-1).setting['common.apiSource'], '')
      assert.equal(savedSettings.at(-1).setting['player.preferredSource'], 'auto')
    }
    const manual = main.updateSetting({ 'common.apiSource': id, 'player.preferredSource': source }, true)
    assert.equal(manual.setting['common.apiSource'], id)
    assert.equal(manual.setting['player.preferredSource'], source)
  } finally {
    global.lx = previousLx
    global.envParams = previousEnv
  }

  let removed
  const preferences = []
  setting['player.preferredSource'] = source
  const useSettings = load('src/renderer/ui/settings/useSettings.ts', {
    vue: { ...vue, onBeforeUnmount: () => {} }, '@renderer/store/setting': { appSetting: setting },
    '@renderer/store/list/state': {}, '@renderer/store/list/action': {}, '@renderer/store': { userApi: apis },
    '@renderer/utils/ipc': { removeUserApi: async ids => { removed = ids; return apis.list } }, '@renderer/core/apiSource': {},
    '@renderer/core/player/utils': {}, '@renderer/plugins/player': {}, '@renderer/utils': {}, '@common/utils/nodejs': {},
    '@common/utils/common': {}, '@common/utils/migrateSetting': {}, '@renderer/composables/useAppearance': {},
    '@renderer/store/dislikeList': { dislikeInfo: {} }, '@renderer/core/dislikeList': {}, './schema': schema,
    '@renderer/ui/services/platformPlayback': { setPreferredSource: async value => { preferences.push(value); setting['player.preferredSource'] = value } },
    '@common/platformSources': sources, '@common/localMusic': {}, '../services/localLibrary': {},
  }).useSettings()
  const removal = useSettings.removeSource({ id, name: '测试音源' })
  useSettings.answerConfirmation(true)
  await removal
  assert.deepEqual(removed, [id])
  assert.deepEqual(preferences, ['auto'])
  assert.equal(setting['player.preferredSource'], 'auto')

  // The real removal helper consumes its ID array. A runtime created while the
  // selected legacy window is closing must still be closed after list removal.
  const removedIds = [id, 'user_api_second']
  const apiList = removedIds.map(id => ({ id, name: id }))
  const liveRuntimes = new Set(removedIds)
  const closeCalls = []
  let finishLegacyClose
  const userApi = load('src/main/modules/userApi/index.ts', {
    './main': { closeWindow: async() => new Promise(resolve => { finishLegacyClose = resolve }) },
    './utils': {
      getUserApis: () => apiList,
      removeApi: ids => {
        while (ids.length) {
          const target = ids.splice(0, 1)[0]
          const index = apiList.findIndex(api => api.id === target)
          if (index >= 0) apiList.splice(index, 1)
        }
      },
    },
    './rendererEvent/rendererEvent': { loadApi: async() => {} },
    './playback': { closeImportedPlayback: ids => { closeCalls.push([...ids]); for (const id of ids) liveRuntimes.delete(id) } },
  })
  await userApi.setApi(id)
  const deleting = userApi.removeApi(removedIds)
  assert.deepEqual(closeCalls, [[id, 'user_api_second']])
  assert.equal(liveRuntimes.size, 0)
  assert.equal(apiList.length, 2, 'list removal waits for the selected legacy window to close')
  liveRuntimes.add(id)
  liveRuntimes.add('user_api_second')
  finishLegacyClose()
  assert.deepEqual(await deleting, [])
  assert.deepEqual(removedIds, [id, 'user_api_second'], 'mutating persistence helper cannot consume caller IDs')
  assert.deepEqual(closeCalls, [[id, 'user_api_second'], [id, 'user_api_second']])
  assert.equal(liveRuntimes.size, 0, 'second close removes runtimes created during the awaited legacy close')
  console.log('Imported-source settings: identifiers, options, reactivity, schema, backup, persistence, retired-source preference migration, deletion reset and main removal race passed.')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
