import fs from 'node:fs'
import path from 'node:path'
import { STORE_NAMES } from '@common/constants'

// Electron requires this preference before app.ready. Read the same atomic
// settings file used by updateSetting, without creating a second source of truth.
export function readStartupPreferences(dataPath: string) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(dataPath, `${STORE_NAMES.APP_SETTINGS}.json`), 'utf8'))
    return { disableHardwareAcceleration: config?.setting?.['common.disableHardwareAcceleration'] === true }
  } catch {
    // New installs and unreadable settings keep Electron's accelerated default.
    // The regular settings loader handles recovery after app.ready.
    return { disableHardwareAcceleration: false }
  }
}

export function applyStartupPreferences(app: Pick<Electron.App, 'disableHardwareAcceleration'>, dataPath: string) {
  const preferences = readStartupPreferences(dataPath)
  if (preferences.disableHardwareAcceleration) app.disableHardwareAcceleration()
  return preferences
}
