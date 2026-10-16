<template>
  <button ref="trigger" type="button" class="ui-icon-button" :class="{ 'ui-active': active }" aria-label="外部歌词" title="外部歌词" aria-haspopup="dialog" :aria-expanded="open" @click="open = !open" @keydown.down.prevent="open = true"><UiIcon name="lyric" /></button>
  <PlayerPopover :show="open" title="外部歌词" :show-header="false" :width="200" :trigger="trigger" anchor="trigger" panel-class="ui-external-lyrics-menu" @close="open = false">
    <button v-for="item in modes" :key="item.mode" type="button" class="ui-external-lyrics-row ui-external-lyrics-option" :disabled="item.mode === 'taskbar' && !windows" :title="item.mode === 'taskbar' && !windows ? '仅支持 Windows' : undefined" :aria-pressed="enabled(item.mode)" @click="toggle(item.mode)"><UiIcon :name="item.icon" /><span>{{ item.name }}</span><UiIcon v-if="enabled(item.mode)" class="ui-external-lyrics-check" name="check" /></button>
    <button type="button" class="ui-external-lyrics-row ui-external-lyrics-settings" @click="openSettings"><UiIcon name="gear" /><span>外部歌词设置</span></button>
  </PlayerPopover>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { ipcRenderer } from 'electron'
import { useRouter } from 'vue-router'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import type { ExternalLyricMode } from '@common/externalLyric'
import PlayerPopover from './PlayerPopover.vue'
import UiIcon from './UiIcon.vue'

const router = useRouter()
const trigger = ref<HTMLElement | null>(null)
const open = ref(false)
const windows = navigator.platform.startsWith('Win')
const modes: Array<{ mode: ExternalLyricMode, name: string, icon: string }> = [
  { mode: 'desktop', name: '桌面歌词', icon: 'lyric' },
  { mode: 'island', name: '灵动岛歌词', icon: 'disc' },
  { mode: 'taskbar', name: '任务栏歌词', icon: 'list' },
]
const enabled = (mode: ExternalLyricMode) => appSetting[`externalLyric.${mode}.enabled`]
const active = computed(() => modes.some(item => enabled(item.mode)))
function toggle(mode: ExternalLyricMode) { updateSetting({ [`externalLyric.${mode}.enabled`]: !enabled(mode) }) }
function openSettings() { open.value = false; setShowPlayerDetail(false); void router.push({ path: '/setting', query: { category: 'externalLyric' } }) }
onMounted(() => { ipcRenderer.on('externalLyric:open-settings', openSettings) })
onBeforeUnmount(() => { ipcRenderer.removeListener('externalLyric:open-settings', openSettings) })
</script>
<style lang="less">
.ui-external-lyrics-menu .ui-player-popover-content { padding: 6px; }
.ui-external-lyrics-row {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 10px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--modern-text); text-align: left; font: inherit; font-size: 14px; line-height: 24px; cursor: pointer;
  > svg { width: 18px; height: 18px; flex: none; color: var(--modern-muted); }
  > span { flex: 1; min-width: 0; white-space: nowrap; }
  > .ui-external-lyrics-check { width: 16px; height: 16px; color: var(--modern-accent-ink); }
  &:hover { background: var(--modern-hover); }
  &:disabled { opacity: .4; cursor: default; }
  &[aria-pressed="true"] { color: var(--modern-accent-ink); > svg:first-child { color: inherit; } }
}
</style>

