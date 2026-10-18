interface QueueContinuation {
  valid: () => boolean
  notify: () => void
  ensure: (manual: boolean) => Promise<boolean>
  filter: (tracks: Array<LX.Music.MusicInfo | LX.Download.ListItem>) => Array<LX.Music.MusicInfo | LX.Download.ListItem>
  excludes?: (track: LX.Music.MusicInfo | LX.Download.ListItem) => boolean
  dispose: () => void
}

let continuation: QueueContinuation | null = null

export function setQueueContinuation(next: QueueContinuation | null) {
  continuation?.dispose()
  continuation = next
}

function current() {
  if (continuation && !continuation.valid()) setQueueContinuation(null)
  return continuation
}

export function notifyQueueContinuation() { current()?.notify() }

export function hasQueueContinuation() { return current() !== null }
export function isQueueTrackDisliked(track: LX.Music.MusicInfo | LX.Download.ListItem) { return current()?.excludes?.(track) ?? false }

/** Ordinary lists always continue through the player's existing navigation. */
export async function ensureQueueContinuation(manual = false) {
  return await current()?.ensure(manual) ?? true
}

export function filterQueueContinuation(tracks: Array<LX.Music.MusicInfo | LX.Download.ListItem>) {
  return current()?.filter(tracks) ?? tracks
}
