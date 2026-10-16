let commitDepth = 0
const listeners = new Set<(listId?: string) => void>()
export const SESSION_PLAYBACK_QUEUE_PREFIX = 'session_playback_'

/** Observe explicit queue selection without coupling the player to UI services. */
export function onPlaybackIntent(listener: (listId?: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyPlaybackIntent(listId?: string) {
  if (commitDepth) return
  for (const listener of listeners) listener(listId)
}

/** A reserved queue suppresses only its own synchronous entry notifications. */
export function commitPlaybackIntent<T>(commit: () => T): T {
  commitDepth++
  try { return commit() } finally { commitDepth-- }
}
