import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import type * as SyncService from '@main/modules/sync'
import { sendEvent } from '../main'

// Cross-device sync is optional. Merely registering its IPC handlers must not
// retain the WebSocket server/client and snapshot management dependency tree.
let syncService: Promise<typeof SyncService> | null = null
const loadSyncService = async() => syncService ??= import('@main/modules/sync')
const disabledServerStatus = (): LX.Sync.ServerStatus => ({ status: false, message: '', address: [], code: '', devices: [] })
const disabledClientStatus = (): LX.Sync.ClientStatus => ({ status: false, message: '', address: [] })

let selectModeListenr: ((mode: LX.Sync.ModeTypes[keyof LX.Sync.ModeTypes] | null) => void) | null = null

export default () => {
  mainHandle<LX.Sync.SyncServiceActions, any>(WIN_MAIN_RENDERER_EVENT_NAME.sync_action, async({ params: data }) => {
    switch (data.action) {
      case 'enable_server':
        if (data.data.enable) await (await loadSyncService()).startServer(parseInt(data.data.port))
        else if (syncService) await (await syncService).stopServer()
        return
      case 'enable_client':
        if (data.data.enable) await (await loadSyncService()).connectServer(data.data.host, data.data.authCode)
        else if (syncService) await (await syncService).disconnectServer()
        return
      case 'get_server_status': return syncService ? (await syncService).getServerStatus() : disabledServerStatus()
      case 'get_client_status': return syncService ? (await syncService).getClientStatus() : disabledClientStatus()
      case 'generate_code': return (await loadSyncService()).generateCode()
      case 'select_mode':
        if (selectModeListenr) {
          selectModeListenr(data.data.mode)
          selectModeListenr = null
        }
        break
      default:
        break
    }
  })
  mainHandle<never, LX.Sync.ServerDevices>(WIN_MAIN_RENDERER_EVENT_NAME.sync_get_server_devices, async() => {
    return (await loadSyncService()).getServerDevices()
  })
  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.sync_remove_server_device, async({ params: clientId }) => {
    await (await loadSyncService()).removeServerDevice(clientId)
  })
}


export const sendSyncAction = (data: LX.Sync.SyncMainWindowActions) => {
  sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.sync_action, data)
}

export const sendClientStatus = (status: LX.Sync.ClientStatus) => {
  sendSyncAction({
    action: 'client_status',
    data: status,
  })
}
export const sendServerStatus = (status: LX.Sync.ServerStatus) => {
  sendSyncAction({
    action: 'server_status',
    data: status,
  })
}
export const sendSelectMode = <T extends keyof LX.Sync.ModeTypes>(deviceName: string, type: T, listener: (mode: LX.Sync.ModeTypes[T] | null) => void) => {
  selectModeListenr = listener as typeof selectModeListenr
  sendSyncAction({ action: 'select_mode', data: { deviceName, type } })
}
export const removeSelectModeListener = () => {
  if (selectModeListenr) selectModeListenr(null)
  selectModeListenr = null
}
export const sendCloseSelectMode = () => {
  sendSyncAction({ action: 'close_select_mode' })
}
