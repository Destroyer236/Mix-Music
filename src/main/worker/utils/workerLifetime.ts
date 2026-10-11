import type { Worker } from 'node:worker_threads'

// A Worker failure must reject pending database calls rather than terminate the
// main process through an unhandled `error` event or leave Comlink awaiting forever.
export function protectWorkerCalls<T extends object>(remote: T, worker: Pick<Worker, 'once'>): T {
  let failure: Error | null = null
  const pending = new Set<(error: Error) => void>()
  const fail = (error: Error) => {
    failure ??= error
    for (const reject of pending) reject(failure)
    pending.clear()
  }
  worker.once('error', (error: Error) => { fail(new Error(`音乐库服务不可用，请重启 LinkLine 后重试。${error.message}`)) })
  worker.once('exit', (code: number) => { fail(new Error(`音乐库服务已停止（${code}），请重启 LinkLine 后重试。`)) })
  return new Proxy(remote, {
    get(target, property: string | symbol) {
      if (property === 'then') return undefined
      const method = Reflect.get(target, property)
      if (typeof property === 'symbol' || typeof method !== 'function') return method
      return async(...args: unknown[]) => {
        if (failure) throw failure
        return new Promise((resolve, reject) => {
          pending.add(reject)
          // Remove the per-call failure handler when the operation settles. A
          // shared never-settling Promise.race would retain every completed call.
          void Promise.resolve().then(() => Reflect.apply(method, target, args)).then(resolve, reject).finally(() => { pending.delete(reject) })
        })
      }
    },
  })
}
