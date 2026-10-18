import { request } from '@common/utils/request'

const MAX_SCRIPT_BYTES = 2 * 1024 * 1024
const DOWNLOAD_TIMEOUT = 8000
type ScriptBody = AsyncIterable<Uint8Array> & { destroy: () => void }

export const downloadScript = async(url: string): Promise<string> => {
  if (new URL(url).protocol !== 'https:') throw new Error('音源脚本地址必须使用 HTTPS')
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, DOWNLOAD_TIMEOUT)
  try {
    const response = await request<ScriptBody>(url, {
      needBody: true,
      timeout: DOWNLOAD_TIMEOUT,
      signal: controller.signal,
      maxRedirect: 3,
      retryNum: 0,
    })
    try {
      if (response.statusCode !== 200) throw new Error(`音源脚本下载失败（HTTP ${response.statusCode ?? 0}）`)
      if (Number(response.headers['content-length']) > MAX_SCRIPT_BYTES) throw new Error('音源脚本文件过大')
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.byteLength
        if (size > MAX_SCRIPT_BYTES) throw new Error('音源脚本文件过大')
        chunks.push(Buffer.from(chunk))
      }
      if (!size) throw new Error('下载的音源脚本为空')
      return Buffer.concat(chunks, size).toString('utf8').replace(/^\uFEFF/, '')
    } finally {
      response.body.destroy()
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('音源脚本下载超时，请检查网络后重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
