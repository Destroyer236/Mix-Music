import { app, session } from 'electron'
import { env as runtimeEnv } from 'node:process'
import './utils/logInit'
import '@common/error'
import {
  initGlobalData,
  initSingleInstanceHandle,
  applyElectronEnvParams,
  setUserDataPath,
  registerDeeplink,
  listenerAppEvent,
} from './app'
import { isLinux } from '@common/utils'
import { initAppSetting } from '@main/app'
import registerModules from '@main/modules'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { prepareUserDataDirectory } from './utils/userDataDirectory'
import { applyStartupPreferences } from './utils/startupPreferences'
import { clearStartupCaches } from './utils/startupCache'

// 初始化应用
const init = () => {
  console.log('init')
  if (process.env.BUILD_WIN7 == 'true') import('./utils/winLegacy')
  void initAppSetting().then(() => {
    registerModules()
    global.lx.event_app.app_inited()
  })
}

app.setName('LinkLine')
const dataDirectory = prepareUserDataDirectory({
  appDataPath: app.getPath('appData'),
  env: runtimeEnv,
  developmentPath: app.isPackaged ? undefined : path.join(__dirname, '../artifacts/user-test-data'),
  portablePath: process.platform === 'win32' ? path.join(path.dirname(app.getPath('exe')), 'portable') : undefined,
  acquireLegacyLock: legacyPath => {
    app.setPath('userData', legacyPath)
    return app.requestSingleInstanceLock()
  },
  releaseLegacyLock: () => { app.releaseSingleInstanceLock() },
})
if (dataDirectory.appDataPath) app.setPath('appData', dataDirectory.appDataPath)
app.setPath('userData', dataDirectory.userDataPath)
// Keep Chromium, updates and extracted artwork on the same drive as app data.
const tempDirectory = path.join(dataDirectory.userDataPath, 'Temp')
const crashDirectory = path.join(dataDirectory.userDataPath, 'Crashpad')
const logDirectory = path.join(dataDirectory.userDataPath, 'logs')
for (const directory of [dataDirectory.userDataPath, tempDirectory, crashDirectory, logDirectory]) mkdirSync(directory, { recursive: true })
app.setPath('sessionData', dataDirectory.userDataPath)
app.setPath('temp', tempDirectory)
app.setPath('crashDumps', crashDirectory)
app.setAppLogsPath(logDirectory)
runtimeEnv.LINKLINE_TEMP_DIR = tempDirectory
initGlobalData()
initSingleInstanceHandle()
applyElectronEnvParams()
setUserDataPath()
applyStartupPreferences(app, global.lxDataPath)
registerDeeplink(init)
listenerAppEvent(init)


// https://github.com/electron/electron/issues/16809
void app.whenReady().then(async() => {
  await clearStartupCaches({ dataPath: dataDirectory.userDataPath, defaultSession: session.defaultSession, fromPartition: partition => session.fromPartition(partition) }).catch(error => { console.warn('LinkLine startup cache cleanup failed:', error) })
  isLinux ? setTimeout(init, 300) : init()
})
