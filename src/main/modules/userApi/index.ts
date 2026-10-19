import { closeWindow } from './main'
import { getUserApis, importApi as handleImportApi, removeApi as handleRemoveApi, setAllowShowUpdateAlert as saveAllowShowUpdateAlert } from './utils'
import { loadApi, setAllowShowUpdateAlert as setRendererEventAllowShowUpdateAlert, init } from './rendererEvent/rendererEvent'
import { closeImportedPlayback } from './playback'

let userApiId: string | null
let selectionGeneration = 0

export const getApiList = getUserApis

export const importApi = async(script: string): Promise<LX.UserApi.ImportUserApi> => {
  return {
    apiInfo: await handleImportApi(script),
    apiList: getUserApis(),
  }
}
export const removeApi = async(ids: string[]): Promise<LX.UserApi.UserApiInfo[]> => {
  closeImportedPlayback(ids)
  if (userApiId && ids.includes(userApiId)) {
    userApiId = null
    selectionGeneration++
    await closeWindow()
  }
  handleRemoveApi([...ids])
  closeImportedPlayback(ids)
  return getUserApis()
}

export const setApi = async(id: string) => {
  const generation = ++selectionGeneration
  if (userApiId) {
    userApiId = null
    await closeWindow()
  }
  if (generation !== selectionGeneration) return
  const apiList = getUserApis()
  if (!apiList.some(a => a.id === id)) return
  // The generation check above rejects selections superseded during closeWindow.
  // eslint-disable-next-line require-atomic-updates
  userApiId = id
  try {
    await loadApi(id)
  } catch (error) {
    if (generation === selectionGeneration) {
      // eslint-disable-next-line require-atomic-updates
      userApiId = null
    }
    throw error
  }
}

export const setAllowShowUpdateAlert = (id: string, enable: boolean) => {
  saveAllowShowUpdateAlert(id, enable)
  setRendererEventAllowShowUpdateAlert(id, enable)
}


export * from './rendererEvent/rendererEvent'

export default () => {
  init()

  global.lx.event_app.on('main_window_close', () => {
    closeImportedPlayback()
    void closeWindow()
  })
}
