/** External lyric preferences shared by the main window and lyric windows. */
export type ExternalLyricMode = 'desktop' | 'island' | 'taskbar'

export interface DesktopLyricConfig {
  enabled: boolean
  fontSize: number
  fontWeight: number
  fontFamily: string
  showTranslation: boolean
  doubleLine: boolean
  align: 'left' | 'center' | 'right' | 'justify'
  wordByWord: boolean
  autoGenerateWordByWord: boolean
  playedColor: string
  unplayedColor: string
  strokeColor: string
  backgroundMask: boolean
  backgroundMaskColor: string
  alwaysShowSongInfo: boolean
  limitBounds: boolean
  animation: boolean
  alwaysOnTop: boolean
  locked: boolean
  useCSSDrag: boolean
  x: number | null
  y: number | null
  width: number
  height: number
}

export interface DynamicIslandConfig {
  enabled: boolean
  scale: number
  fontWeight: number
  fontFamily: string
  wordByWord: boolean
  transition: 'bounce' | 'smooth'
  playedColor: string
  unplayedColor: string
  backgroundColor: string
  cornerRadius: number
  backgroundOpacity: number
  alwaysOnTop: boolean
  snapCentered: boolean
  notchFusion: boolean
  nonOcclusive: boolean
  doubleLine: boolean
  showTranslation: boolean
  useCSSDrag: boolean
  x: number | null
  y: number | null
}

export interface TaskbarLyricConfig {
  enabled: boolean
  position: 'auto' | 'left' | 'right'
  autoMaxWidth: boolean
  autoAdjustOccupiedSpace: boolean
  maxWidth: number
  leftMargin: number
  rightMargin: number
  colorMode: 'taskbar' | 'taskbarInverse' | 'light' | 'dark'
  showBackground: boolean
  doubleLine: boolean
  showTranslation: boolean
  showCover: boolean
  wordByWord: boolean
  fontSize: number
  fontWeight: number
  fontFamily: string
}

export interface ExternalLyricConfigMap {
  desktop: DesktopLyricConfig
  island: DynamicIslandConfig
  taskbar: TaskbarLyricConfig
}

type FlatModeSettings<M extends ExternalLyricMode> = {
  [K in keyof ExternalLyricConfigMap[M] as `externalLyric.${M}.${K & string}`]: ExternalLyricConfigMap[M][K]
}

export type ExternalLyricSettings = FlatModeSettings<'desktop'> & FlatModeSettings<'island'> & FlatModeSettings<'taskbar'>

export const externalLyricDefaults: ExternalLyricSettings = {
  'externalLyric.desktop.enabled': false,
  'externalLyric.desktop.fontSize': 24,
  'externalLyric.desktop.fontWeight': 600,
  'externalLyric.desktop.fontFamily': '',
  'externalLyric.desktop.showTranslation': true,
  'externalLyric.desktop.doubleLine': true,
  'externalLyric.desktop.align': 'center',
  'externalLyric.desktop.wordByWord': true,
  'externalLyric.desktop.autoGenerateWordByWord': true,
  'externalLyric.desktop.playedColor': 'rgb(254, 121, 113)',
  'externalLyric.desktop.unplayedColor': 'rgb(255, 255, 255)',
  'externalLyric.desktop.strokeColor': 'rgba(0, 0, 0, 0.5)',
  'externalLyric.desktop.backgroundMask': false,
  'externalLyric.desktop.backgroundMaskColor': 'rgba(0, 0, 0, 0.3)',
  'externalLyric.desktop.alwaysShowSongInfo': false,
  'externalLyric.desktop.limitBounds': false,
  'externalLyric.desktop.animation': true,
  'externalLyric.desktop.alwaysOnTop': true,
  'externalLyric.desktop.locked': false,
  'externalLyric.desktop.useCSSDrag': false,
  'externalLyric.desktop.x': null,
  'externalLyric.desktop.y': null,
  'externalLyric.desktop.width': 800,
  'externalLyric.desktop.height': 200,
  'externalLyric.island.enabled': false,
  'externalLyric.island.scale': 1,
  'externalLyric.island.fontWeight': 500,
  'externalLyric.island.fontFamily': '',
  'externalLyric.island.wordByWord': true,
  'externalLyric.island.transition': 'bounce',
  'externalLyric.island.playedColor': 'rgba(255, 255, 255, 1)',
  'externalLyric.island.unplayedColor': 'rgba(255, 255, 255, 0.5)',
  'externalLyric.island.backgroundColor': 'rgba(0, 0, 0, 1)',
  'externalLyric.island.cornerRadius': 100,
  'externalLyric.island.backgroundOpacity': 100,
  'externalLyric.island.alwaysOnTop': true,
  'externalLyric.island.snapCentered': true,
  'externalLyric.island.notchFusion': false,
  'externalLyric.island.nonOcclusive': false,
  'externalLyric.island.doubleLine': false,
  'externalLyric.island.showTranslation': false,
  'externalLyric.island.useCSSDrag': false,
  'externalLyric.island.x': null,
  'externalLyric.island.y': null,
  'externalLyric.taskbar.enabled': false,
  'externalLyric.taskbar.position': 'auto',
  'externalLyric.taskbar.autoMaxWidth': true,
  'externalLyric.taskbar.autoAdjustOccupiedSpace': false,
  'externalLyric.taskbar.maxWidth': 400,
  'externalLyric.taskbar.leftMargin': 0,
  'externalLyric.taskbar.rightMargin': 0,
  'externalLyric.taskbar.colorMode': 'taskbar',
  'externalLyric.taskbar.showBackground': false,
  'externalLyric.taskbar.doubleLine': true,
  'externalLyric.taskbar.showTranslation': true,
  'externalLyric.taskbar.showCover': true,
  'externalLyric.taskbar.wordByWord': true,
  'externalLyric.taskbar.fontSize': 14,
  'externalLyric.taskbar.fontWeight': 400,
  'externalLyric.taskbar.fontFamily': '',
}

/** Reconstruct one mode while retaining defaults for newly introduced fields. */
export function getExternalLyricConfig<M extends ExternalLyricMode>(setting: Partial<ExternalLyricSettings>, mode: M): ExternalLyricConfigMap[M] {
  const prefix = `externalLyric.${mode}.`
  return Object.fromEntries((Object.keys(externalLyricDefaults) as Array<keyof ExternalLyricSettings>)
    .filter(key => key.startsWith(prefix))
    .map(key => [key.slice(prefix.length), setting[key] === undefined ? externalLyricDefaults[key] : setting[key]])) as unknown as ExternalLyricConfigMap[M]
}
