import fs from 'node:fs/promises'
import path from 'node:path'

type CacheSession = Pick<Electron.Session, 'clearCache' | 'clearCodeCaches'>
interface StartupCacheOptions {
  dataPath: string
  defaultSession: CacheSession
  fromPartition: (partition: string) => CacheSession
  warn?: (message: string, error: unknown) => void
}

// Run once, after acquiring the single-instance lock and before opening windows.
// Session cache APIs retain cookies, local storage, accounts and music databases.
export async function clearStartupCaches(options: StartupCacheOptions): Promise<void> {
  const warn = options.warn ?? console.warn
  const attempt = async(label: string, task: () => Promise<unknown>) => {
    try { await task() } catch (error) { warn(`Mix Music startup cache cleanup skipped ${label}:`, error) }
  }
  await attempt('temporary files', async() => {
    const root = await fs.realpath(options.dataPath)
    const temporary = path.join(root, 'Temp')
    // Never follow a redirected Temp directory outside the application profile.
    const info = await fs.lstat(temporary).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!info?.isDirectory() || info.isSymbolicLink() || await fs.realpath(temporary) !== temporary) return
    const entries = await fs.readdir(temporary)
    for (const entry of entries) {
      const target = path.join(temporary, entry)
      if (path.dirname(target) !== temporary) continue
      await attempt('a temporary item', async() => fs.rm(target, { recursive: true, force: true }))
    }
  })

  const partitions: string[] = []
  await attempt('session discovery', async() => {
    const root = await fs.realpath(options.dataPath)
    const directory = path.join(root, 'Partitions')
    const info = await fs.lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!info?.isDirectory() || info.isSymbolicLink() || await fs.realpath(directory) !== directory) return
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && /^(?:win-main|linkline-account-[a-z]+)$/.test(entry.name)) partitions.push(`persist:${entry.name}`)
    }
  })
  const clear = async(session: CacheSession) => {
    await attempt('web resource cache', async() => session.clearCache())
    await attempt('web code cache', async() => session.clearCodeCaches({}))
  }
  await clear(options.defaultSession)
  // Limit concurrent disk work; do not create sessions for unused platforms.
  for (let index = 0; index < partitions.length; index += 2) {
    await Promise.all(partitions.slice(index, index + 2).map(async partition => {
      await attempt('platform cache', async() => clear(options.fromPartition(partition)))
    }))
  }
}
