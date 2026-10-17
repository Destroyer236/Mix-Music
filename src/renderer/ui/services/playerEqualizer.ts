import { effectScope, reactive, ref, watch } from 'vue'
import { freqs } from '@renderer/plugins/player'
import { appSetting, mergeSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'

type Frequency = typeof freqs[number]
type BandKey = `player.soundEffect.biquadFilter.hz${Frequency}`
type EqualizerBands = Record<Frequency, number>
interface EqualizerState { bypassed: boolean, bands: EqualizerBands }
type EqualizerPreset = Record<`hz${Frequency}`, number>
const storageKey = 'linkline.player-equalizer.v1'
const bandKey = (frequency: Frequency): BandKey => `player.soundEffect.biquadFilter.hz${frequency}`
const isGain = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= -15 && value <= 15

function actualBands(): EqualizerBands {
  return Object.fromEntries(freqs.map(frequency => [frequency, isGain(appSetting[bandKey(frequency)]) ? appSetting[bandKey(frequency)] : 0])) as EqualizerBands
}

export function validateEqualizerState(value: unknown): EqualizerState | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (typeof input.bypassed !== 'boolean' || !input.bands || typeof input.bands !== 'object' || Array.isArray(input.bands)) return null
  const bands = input.bands as Record<string, unknown>
  if (!freqs.every(frequency => isGain(bands[frequency]))) return null
  return { bypassed: input.bypassed, bands: Object.fromEntries(freqs.map(frequency => [frequency, bands[frequency]])) as EqualizerBands }
}

function readState(): EqualizerState | null {
  try { return validateEqualizerState(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) } catch { return null }
}

const saved = readState()
export const eqBypassed = ref(saved?.bypassed ?? false)
// While bypassed, keep showing the curve that will be restored on enable.
export const equalizerGains = reactive<EqualizerBands>(saved?.bypassed ? saved.bands : actualBands())
let internalWrite = false
let revision = 0

function persist(): void {
  try { localStorage.setItem(storageKey, JSON.stringify({ bypassed: eqBypassed.value, bands: { ...equalizerGains } })) } catch { /* EQ remains usable when local storage is unavailable. */ }
}

function patchFor(bands: EqualizerBands): Partial<LX.AppSetting> {
  const patch: Partial<LX.AppSetting> = {}
  for (const frequency of freqs) patch[bandKey(frequency)] = bands[frequency]
  return patch
}

function applyState(state: EqualizerState): Partial<LX.AppSetting> {
  eqBypassed.value = state.bypassed
  Object.assign(equalizerGains, state.bands)
  const patch = patchFor(state.bypassed ? Object.fromEntries(freqs.map(frequency => [frequency, 0])) as EqualizerBands : state.bands)
  internalWrite = true
  try { mergeSetting(patch) } finally { internalWrite = false }
  persist()
  return patch
}

async function commit(state: EqualizerState): Promise<void> {
  const previous = { bypassed: eqBypassed.value, bands: { ...equalizerGains } }
  const generation = ++revision
  const patch = applyState(state)
  try { await updateSetting(patch) } catch (error) {
    if (generation === revision) applyState(previous)
    throw error
  }
}

// This watcher belongs to the application, so closing player details preserves it.
// Existing preferences remain authoritative; merely importing this service does
// not rewrite gains or create a Web Audio graph.
effectScope(true).run(() => {
  watch(() => freqs.map(frequency => appSetting[bandKey(frequency)]), () => {
    if (internalWrite) return
    const bands = actualBands()
    if (eqBypassed.value && freqs.every(frequency => bands[frequency] === 0)) return
    revision++
    eqBypassed.value = false
    Object.assign(equalizerGains, bands)
    persist()
  }, { immediate: true, flush: 'sync' })
})

export async function setEqualizerEnabled(enabled: boolean): Promise<void> {
  if (enabled === !eqBypassed.value) return
  await commit({ bypassed: !enabled, bands: eqBypassed.value ? { ...equalizerGains } : actualBands() })
}

export function previewEqualizerBand(frequency: Frequency, gain: number): void {
  if (!freqs.includes(frequency) || !isGain(gain)) throw new Error('均衡器增益需在 −15 到 15 dB 之间。')
  revision++
  applyState({ bypassed: false, bands: { ...equalizerGains, [frequency]: gain } })
}

export async function saveEqualizerBand(frequency: Frequency, gain: number): Promise<void> {
  if (!freqs.includes(frequency) || !isGain(gain)) throw new Error('均衡器增益需在 −15 到 15 dB 之间。')
  await commit({ bypassed: false, bands: { ...equalizerGains, [frequency]: gain } })
}

export async function applyEqualizerPreset(preset: EqualizerPreset | null): Promise<void> {
  const bands = Object.fromEntries(freqs.map(frequency => [frequency, preset?.[`hz${frequency}`] ?? 0])) as EqualizerBands
  if (!freqs.every(frequency => isGain(bands[frequency]))) throw new Error('均衡器预设包含无效增益。')
  await commit({ bypassed: false, bands })
}
