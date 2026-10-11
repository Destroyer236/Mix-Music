import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import type * as OpenAPIService from '@main/modules/openApi'
let openAPIService: Promise<typeof OpenAPIService> | null = null
const loadOpenAPIService = async() => openAPIService ??= import('@main/modules/openApi')
const disabledStatus = (): LX.OpenAPI.Status => ({ status: false, message: '', address: '' })

export default () => {
  mainHandle<LX.OpenAPI.Actions, any>(WIN_MAIN_RENDERER_EVENT_NAME.open_api_action, async({ params: data }) => {
    switch (data.action) {
      case 'enable':
        if (data.data.enable) return (await loadOpenAPIService()).startServer(parseInt(data.data.port), data.data.bindLan)
        return openAPIService ? (await openAPIService).stopServer() : disabledStatus()
      case 'status': return openAPIService ? (await openAPIService).getStatus() : disabledStatus()
    }
  })
}
