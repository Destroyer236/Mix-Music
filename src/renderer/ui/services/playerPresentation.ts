import { reactive, watch } from 'vue'

export type PlayerCoverLayout = 'square' | 'vinyl' | 'fullscreen'
export type PlayerBackground = 'theme' | 'blur' | 'dynamic'
export interface PlayerPresentation {
  coverLayout: PlayerCoverLayout
  background: PlayerBackground
  immersive: boolean
  spectrum: boolean
  autoCenterCover: boolean
}

const storageKey = 'linkline.full-player-presentation.v1'
const defaults: PlayerPresentation = { coverLayout: 'square', background: 'blur', immersive: true, spectrum: false, autoCenterCover: true }

export function validatePlayerPresentation(value: unknown): PlayerPresentation {
  const input = value && typeof value === 'object' ? value as Partial<PlayerPresentation> : {}
  return {
    coverLayout: input.coverLayout === 'vinyl' || input.coverLayout === 'fullscreen' ? input.coverLayout : defaults.coverLayout,
    background: input.background === 'theme' || input.background === 'dynamic' ? input.background : defaults.background,
    immersive: typeof input.immersive === 'boolean' ? input.immersive : defaults.immersive,
    spectrum: typeof input.spectrum === 'boolean' ? input.spectrum : defaults.spectrum,
    autoCenterCover: typeof input.autoCenterCover === 'boolean' ? input.autoCenterCover : defaults.autoCenterCover,
  }
}

function readPresentation(): PlayerPresentation {
  try { return validatePlayerPresentation(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) } catch { return { ...defaults } }
}

export const playerPresentation = reactive<PlayerPresentation>(readPresentation())

watch(playerPresentation, value => {
  try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* Listening remains available when local storage is full. */ }
}, { deep: true, flush: 'sync' })

export function patchPlayerPresentation(patch: Partial<PlayerPresentation>): void {
  Object.assign(playerPresentation, validatePlayerPresentation({ ...playerPresentation, ...patch }))
}

export function resetPlayerPresentation(): void { Object.assign(playerPresentation, defaults) }
