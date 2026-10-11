import { Worker } from 'node:worker_threads'
import * as Comlink from 'comlink'
import nodeEndpoint from 'comlink/dist/esm/node-adapter'
import { DATABASE_WORKER_LIMITS } from '@main/utils/runtimePerformance'
import { protectWorkerCalls } from './workerLifetime'

export type DBSeriveTypes = Comlink.Remote<LX.WorkerDBSeriveListTypes>

export const createDBServiceWorker = () => {
  const worker: Worker = new Worker(new URL(
    /* webpackChunkName: 'dbService.worker' */
    '../dbService',
    import.meta.url,
  ), { resourceLimits: DATABASE_WORKER_LIMITS })
  return protectWorkerCalls(Comlink.wrap<LX.WorkerDBSeriveListTypes>(nodeEndpoint(worker)), worker)
}

