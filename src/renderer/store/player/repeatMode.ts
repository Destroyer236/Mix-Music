import { ref, watch } from 'vue'
import { appSetting, mergeSetting, setTogglePlayMode } from '@renderer/store/setting'

export type RepeatMode = 'listLoop' | 'singleLoop' | 'list'
const isRepeatMode = (mode: string): mode is RepeatMode => mode === 'listLoop' || mode === 'singleLoop' || mode === 'list'

// Shuffle chooses the order; repeat controls what happens at the end of a song/cycle.
export const repeatMode = ref<RepeatMode>(isRepeatMode(appSetting['player.togglePlayMethod']) ? appSetting['player.togglePlayMethod'] as RepeatMode : 'listLoop')

watch(() => appSetting['player.togglePlayMethod'], mode => {
  if (isRepeatMode(mode)) repeatMode.value = mode
}, { flush: 'sync' })

export function setRepeatMode(mode: RepeatMode): void {
  repeatMode.value = mode
  if (appSetting['player.togglePlayMethod'] === 'random') return
  mergeSetting({ 'player.togglePlayMethod': mode })
  setTogglePlayMode(mode)
}
