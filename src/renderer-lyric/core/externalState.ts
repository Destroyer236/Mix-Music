import { computed, reactive, ref } from 'vue'
import { ipcRenderer } from 'electron'
import { WIN_LYRIC_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { externalLyricDefaults, getExternalLyricConfig, type ExternalLyricMode } from '@common/externalLyric'
import { findExternalLine, parseExternalLyric, type ExternalLine } from './externalTiming'

const queryMode = new URLSearchParams(window.location.search).get('mode')
export const mode: ExternalLyricMode = queryMode === 'island' || queryMode === 'taskbar' ? queryMode : 'desktop'
export const settings = reactive({ ...externalLyricDefaults })
export const config = computed(() => getExternalLyricConfig(settings, mode))
export const track = reactive({ id: null as string | null, title: 'LinkLine', artist: '', cover: '' })
export const playing = ref(false)
export const lines = ref<ExternalLine[]>([])
export const now = ref(0)
// Keep the active line separate from the high-frequency playback clock. This prevents
// every animation frame from invalidating the lyric-content computed chain.
export const primaryIndex = ref(-1)
export const currentLine = computed(() => lines.value[primaryIndex.value] ?? null)
export const hovered = ref(false)
export const layout = reactive({ anchor: 'left' as 'left' | 'right', isLight: false, maxWidth: 400, snapped: true })
let port: MessagePort | null = null
let anchorTime = 0
let anchorClock = performance.now()
let rate = 1
let manualOffset = 0
let lyricOffset = 0
let frame = 0

function time() { return anchorTime + (playing.value ? (performance.now() - anchorClock) * rate : 0) + manualOffset + lyricOffset }
function updateClock(value: number) {
  now.value = value
  const next = findExternalLine(lines.value, value)
  if (next !== primaryIndex.value) primaryIndex.value = next
}
function tick() {
  frame = 0
  updateClock(time())
  if (playing.value) frame = requestAnimationFrame(tick)
}
function synchronize(milliseconds: number, isPlaying: boolean) {
  anchorTime = Number.isFinite(milliseconds) ? milliseconds : 0
  anchorClock = performance.now()
  playing.value = isPlaying
  updateClock(time())
  if (isPlaying && !frame) frame = requestAnimationFrame(tick)
  else if (!isPlaying && frame) { cancelAnimationFrame(frame); frame = 0 }
}
function setLyrics(data: { lrc: string | null, tlrc: string | null, lxlrc: string | null }) {
  const source = data.lxlrc?.length ? data.lxlrc : data.lrc ?? ''
  lyricOffset = Number(/\[offset:([+-]?\d+)\]/i.exec(source)?.[1] ?? 0)
  lines.value = parseExternalLyric(source, data.tlrc ?? '')
  updateClock(time())
}
function receive(event: LX.DesktopLyric.LyricActions) {
  switch (event.action) {
    case 'set_info': {
      const info = event.data as typeof event.data & { pic?: string, playbackRate?: number, offset?: number }
      track.id = info.id
      track.title = info.name || 'LinkLine'
      track.artist = info.singer ?? ''
      track.cover = info.pic ?? ''
      rate = info.playbackRate ?? 1
      manualOffset = info.offset ?? 0
      setLyrics(info)
      synchronize(info.played_time, info.isPlay)
      break
    }
    case 'set_lyric': setLyrics(event.data); port?.postMessage({ action: 'get_status' }); break
    case 'set_cover': track.cover = event.data ?? ''; break
    case 'set_status': synchronize(event.data.played_time, event.data.isPlay); break
    case 'set_play': synchronize(event.data, true); break
    case 'set_pause': synchronize(time() - manualOffset - lyricOffset, false); break
    case 'set_offset': manualOffset = event.data; updateClock(time()); break
    case 'set_playbackRate': {
      const milliseconds = time() - manualOffset - lyricOffset
      rate = event.data
      synchronize(milliseconds, playing.value)
      break
    }
    case 'set_stop':
      synchronize(0, false)
      lines.value = []
      track.id = null
      track.title = 'LinkLine'
      track.artist = ''
      track.cover = ''
      break
  }
}

export async function initializeExternal() {
  ipcRenderer.on('externalLyric:config', (_event, values) => Object.assign(settings, values))
  ipcRenderer.on('externalLyric:hover', (_event, value: boolean) => { hovered.value = value })
  ipcRenderer.on('externalLyric:layout', (_event, value) => Object.assign(layout, value))
  ipcRenderer.on(WIN_LYRIC_RENDERER_EVENT_NAME.provide_main_window_channel, (event) => {
    port?.close()
    port = event.ports[0]
    if (!port) return
    port.onmessage = ({ data }) => { receive(data) }
    port.start()
    port.postMessage({ action: 'get_info' })
  })
  ipcRenderer.on(WIN_LYRIC_RENDERER_EVENT_NAME.main_window_inited, () => { ipcRenderer.send('externalLyric:connect') })
  ipcRenderer.on('externalLyric:reconnect', () => { ipcRenderer.send('externalLyric:connect') })
  Object.assign(settings, await ipcRenderer.invoke('externalLyric:get-config'))
  ipcRenderer.send('externalLyric:connect')
  frame = requestAnimationFrame(tick)
  window.addEventListener('beforeunload', () => { cancelAnimationFrame(frame); port?.close() }, { once: true })
}

export function saveSetting(field: string, value: string | boolean | number) {
  const values = { [`externalLyric.${mode}.${field}`]: value }
  Object.assign(settings, values)
  void ipcRenderer.invoke('externalLyric:set-config', values)
}
export function control(action: 'prev' | 'next' | 'play' | 'pause' | 'focus-main' | 'open-settings') { ipcRenderer.send('externalLyric:control', action) }
export function reportSize(width: number, height: number) { ipcRenderer.send('externalLyric:content-size', { width: Math.ceil(width), height: Math.ceil(height) }) }
export function resize(width?: number, height?: number) { ipcRenderer.send('externalLyric:resize', { width, height }) }

export function startDrag(event: PointerEvent) {
  const value = config.value
  if (mode === 'taskbar' || ('locked' in value && value.locked) || ('useCSSDrag' in value && value.useCSSDrag) || event.button !== 0 || (event.target as Element).closest('button, input, select, a')) return
  event.preventDefault()
  const offsetX = event.clientX
  const offsetY = event.clientY
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  let pending: { x: number, y: number, finished?: boolean } | null = null
  let scheduled = 0
  const flush = () => { scheduled = 0; if (pending) ipcRenderer.send('externalLyric:bounds', pending) }
  const move = (next: PointerEvent) => {
    pending = { x: Math.round(next.screenX - offsetX), y: Math.round(next.screenY - offsetY) }
    if (!scheduled) scheduled = requestAnimationFrame(flush)
  }
  const stop = () => {
    if (scheduled) cancelAnimationFrame(scheduled)
    if (pending) ipcRenderer.send('externalLyric:bounds', { ...pending, finished: true })
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', stop)
    target.removeEventListener('pointercancel', stop)
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', stop)
  target.addEventListener('pointercancel', stop)
}
