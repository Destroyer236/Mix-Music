import { createMainWorker, createDownloadWorker } from './utils'

/**
 * The list/music worker contains the local audio metadata parser and several
 * sorting/search helpers. Starting it while the application is still loading
 * the first view costs a separate Chromium worker context even when the user
 * only listens to online music. Keep the Comlink API stable, but defer the
 * worker context until one of its methods is actually requested (for example
 * importing local music or filtering a playlist for playback).
 */
const createLazyWorker = <T extends object>(create: () => T) => {
  let worker: T | null = null
  const getWorker = () => worker ??= create()

  return new Proxy({}, {
    get(_target, property: string | symbol) {
      // Promise resolution checks for a `then` property. Returning undefined
      // keeps the proxy a plain worker API object instead of making it thenable.
      if (property === 'then') return undefined
      return (...args: unknown[]) => {
        const method = Reflect.get(getWorker(), property) as (...params: unknown[]) => unknown
        return method(...args)
      }
    },
  }) as T
}

/**
 * Downloads are an optional feature. Creating the worker eagerly starts a
 * second Chromium worker context for every session, even when the user never
 * downloads a song. Keep the same remote API while deferring that cost until
 * the first download operation is invoked.
 */
const createLazyDownloadWorker = () => createLazyWorker(createDownloadWorker)

export default () => {
  return {
    main: createLazyWorker(createMainWorker),
    download: createLazyDownloadWorker(),
  }
}

