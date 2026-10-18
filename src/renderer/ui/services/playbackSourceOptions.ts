import { computed } from 'vue'
import { buildPreferredSourceOptions } from '@common/platformSources'
import { userApi } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'

// Both preference surfaces read the imported list reactively. Script runtimes
// are initialized on demand by playback, independently of common.apiSource.
export const preferredSourceOptions = computed(() => buildPreferredSourceOptions(userApi.list, appSetting['player.preferredSource']))
