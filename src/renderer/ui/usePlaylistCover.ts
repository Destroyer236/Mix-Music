import { onBeforeUnmount, onMounted, reactive } from 'vue'
import { rendererOff, rendererOn } from '@common/rendererIpc'
import { PLAYER_EVENT_NAME } from '@common/ipcNames'
import { appSetting } from '@renderer/store/setting'

const STORAGE_KEY = 'linkline.playlist-covers.v1'
const coverIds = reactive(new Map<string, string>())
try {
  const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  if (Array.isArray(saved)) {
    for (const entry of saved.slice(-2000)) {
      if (Array.isArray(entry) && entry.length === 2 && entry.every(value => typeof value === 'string')) coverIds.set(entry[0], entry[1])
    }
  }
} catch {}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(coverIds).slice(-2000))) } catch {}
}
function record(id: string, tracks: LX.Music.MusicInfo[]) {
  const latest = tracks.at(-1)
  if (!latest) return
  coverIds.set(id, latest.id)
  save()
}
export function playlistCoverTrack(id: string, tracks: LX.Music.MusicInfo[]) {
  const saved = coverIds.get(id)
  return tracks.find(track => track.id === saved) ?? (appSetting['list.addMusicLocationType'] === 'top' ? tracks[0] : tracks.at(-1)) ?? null
}
export function rememberPlaylistCover(id: string, tracks: LX.Music.MusicInfo[]) {
  const track = playlistCoverTrack(id, tracks)
  if (track && coverIds.get(id) !== track.id) record(id, [track])
}
export function usePlaylistCoverTracking() {
  const added = ({ params }: LX.IpcRendererEventParams<LX.List.ListActionMusicAdd>) => { record(params.id, params.musicInfos) }
  const moved = ({ params }: LX.IpcRendererEventParams<LX.List.ListActionMusicMove>) => { record(params.toId, params.musicInfos) }
  const removed = ({ params }: LX.IpcRendererEventParams<LX.List.ListActionRemove>) => { params.forEach(id => coverIds.delete(id)); save() }
  onMounted(() => {
    rendererOn(PLAYER_EVENT_NAME.list_music_add, added)
    rendererOn(PLAYER_EVENT_NAME.list_music_move, moved)
    rendererOn(PLAYER_EVENT_NAME.list_remove, removed)
  })
  onBeforeUnmount(() => {
    rendererOff(PLAYER_EVENT_NAME.list_music_add, added)
    rendererOff(PLAYER_EVENT_NAME.list_music_move, moved)
    rendererOff(PLAYER_EVENT_NAME.list_remove, removed)
  })
}
