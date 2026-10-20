import { userApis as defaultUserApis } from './config'
import { STORE_NAMES } from '@common/constants'
import getStore from '@main/utils/store'
import zlib from 'node:zlib'

let userApis: LX.UserApi.UserApiInfo[] | null
let scripts = new Map<string, string>()
const pendingScripts = new Map<string, Promise<string>>()
const DEFAULT_SOURCES_VERSION = 2

const saveData = () => {
  getStore(STORE_NAMES.USER_API).set('userApis', userApis!.map(api => {
    return {
      ...api,
      script: scripts.get(api.id) ?? '',
    }
  }))
}

export const getUserApis = (): LX.UserApi.UserApiInfo[] => {
  if (userApis) return userApis

  const electronStore_userApi = getStore(STORE_NAMES.USER_API)
  const stored = electronStore_userApi.get<LX.UserApi.UserApiInfoFull[]>('userApis')
  const infoFull = Array.isArray(stored) ? stored.map(api => ({ ...api })) : []
  let requiredUpdate = !Array.isArray(stored)
  if (infoFull.length) {
    for (let i = 0; i < infoFull.length; i++) {
      const api = infoFull[i]
      if (api.version != null) continue
      requiredUpdate ||= true
      try {
        infoFull.splice(i, 1, {
          ...parseScriptInfo(api.script),
          ...api,
        })
      } catch (e) {
        infoFull.splice(i, 1)
        i--
      }
    }
  }
  const previousDefaultsVersion = electronStore_userApi.get<number>('defaultSourcesVersion') ?? 0
  const migrateDefaults = previousDefaultsVersion < DEFAULT_SOURCES_VERSION
  if (migrateDefaults) {
    for (const api of defaultUserApis) {
      // Version 2 adds one source; do not restore version 1 sources that the
      // user intentionally removed.
      if (previousDefaultsVersion >= 1 && api.id !== 'user_api_default_qdy') continue
      if (infoFull.some(existing => existing.id === api.id || existing.scriptUrl === api.scriptUrl)) continue
      infoFull.push({ ...api })
      requiredUpdate = true
    }
  }
  userApis = infoFull.map(api => {
    if (api.allowShowUpdateAlert == null) api.allowShowUpdateAlert = false
    const { script, ...info } = api
    scripts.set(api.id, script ?? '')
    return info
  })
  if (requiredUpdate) saveData()
  // Write the marker only after the list is safely persisted. Removing a
  // default source is then respected on subsequent launches.
  if (migrateDefaults) electronStore_userApi.set('defaultSourcesVersion', DEFAULT_SOURCES_VERSION)
  return userApis
}

const INFO_NAMES = {
  name: 24,
  description: 36,
  author: 56,
  homepage: 1024,
  version: 36,
} as const
type INFO_NAMES_Type = typeof INFO_NAMES
const matchInfo = (scriptInfo: string) => {
  const infoArr = scriptInfo.split(/\r?\n/)
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/
  const infos: Partial<Record<keyof typeof INFO_NAMES, string>> = {}
  for (const info of infoArr) {
    const result = rxp.exec(info)
    if (!result) continue
    const key = result[1] as keyof typeof INFO_NAMES
    if (INFO_NAMES[key] == null) continue
    infos[key] = result[2].trim()
  }

  for (const [key, len] of Object.entries(INFO_NAMES) as Array<{ [K in keyof INFO_NAMES_Type]: [K, INFO_NAMES_Type[K]] }[keyof INFO_NAMES_Type]>) {
    infos[key] ||= ''
    if (infos[key] == null) infos[key] = ''
    else if (infos[key].length > len) infos[key] = infos[key].substring(0, len) + '...'
  }

  return infos as Record<keyof typeof INFO_NAMES, string>
}
const parseScriptInfo = (script: string) => {
  const result = /^\/\*[\S|\s]+?\*\//.exec(script)
  if (!result) throw new Error('无效的自定义源文件')

  let scriptInfo = matchInfo(result[0])

  scriptInfo.name ||= `user_api_${new Date().toLocaleString()}`
  return scriptInfo
}
const deflateScript = async(script: string) => new Promise<string>((resolve, reject) => {
  zlib.deflate(Buffer.from(script, 'utf8'), (err, buf) => {
    if (err) {
      reject(err)
      return
    }
    resolve('gz_' + buf.toString('base64'))
  })
})
const inflateScript = async(script: string) => new Promise<string>((resolve, reject) => {
  if (script.startsWith('gz_')) {
    zlib.inflate(Buffer.from(script.substring(3), 'base64'), (err, buf) => {
      if (err) {
        reject(err)
        return
      }
      resolve(buf.toString('utf8'))
    })
  } else resolve(script)
})
export const importApi = async(scriptRaw: string): Promise<LX.UserApi.UserApiInfo> => {
  const apiList = getUserApis()
  let scriptInfo = parseScriptInfo(scriptRaw)
  const script = await deflateScript(scriptRaw)
  for (const api of apiList) {
    const existingScript = scripts.get(api.id)
    if (existingScript === script) {
      throw new Error(`导入失败，脚本内容与已有的源「${api.name}」相同`)
    }
  }
  const apiInfo = {
    id: `user_api_${Math.random().toString().substring(2, 5)}_${Date.now()}`,
    ...scriptInfo,
    allowShowUpdateAlert: true,
  }
  apiList.push(apiInfo)
  scripts.set(apiInfo.id, script)
  saveData()
  return apiInfo
}

export const removeApi = (ids: string[]) => {
  const apiList = getUserApis()
  for (let index = apiList.length - 1; index > -1; index--) {
    if (ids.includes(apiList[index].id)) {
      scripts.delete(apiList[index].id)
      apiList.splice(index, 1)
    }
  }
  saveData()
}

export const setAllowShowUpdateAlert = (id: string, enable: boolean) => {
  const targetApi = getUserApis().find(api => api.id == id)
  if (!targetApi) return
  targetApi.allowShowUpdateAlert = enable
  saveData()
}

export const getScript = async(id: string) => {
  const api = getUserApis().find(api => api.id === id)
  if (!api) throw new Error('音源已移除，请重新选择音源')
  const cached = scripts.get(id)
  if (cached) return inflateScript(cached)
  if (!api.scriptUrl) throw new Error('音源脚本为空，请重新导入')
  let pending = pendingScripts.get(id)
  if (!pending) {
    const url = api.scriptUrl
    pending = (async() => {
      const { downloadScript } = await import('./remoteScript')
      const script = await downloadScript(url)
      const info = parseScriptInfo(script)
      const compressed = await deflateScript(script)
      // The descriptor may have been removed while downloading. Never let a
      // late response recreate it or overwrite a replacement.
      if (!getUserApis().includes(api)) throw new Error('音源已移除，请重新选择音源')
      Object.assign(api, info)
      scripts.set(id, compressed)
      try {
        saveData()
      } catch (error) {
        scripts.delete(id)
        throw error
      }
      return script
    })()
    pendingScripts.set(id, pending)
  }
  try {
    return await pending
  } finally {
    if (pendingScripts.get(id) === pending) pendingScripts.delete(id)
  }
}
