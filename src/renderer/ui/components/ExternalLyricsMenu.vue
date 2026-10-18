<template>
  <button ref="trigger" type="button" class="ui-icon-button" :class="{ 'ui-active': active }" aria-label="外部歌词" title="外部歌词" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId" @click="open = !open" @keydown.down.prevent="open = true"><UiIcon name="lyricWheel" /></button>
  <PlayerPopover :id="panelId" :show="open" title="外部歌词" :show-header="false" :width="312" :trigger="trigger" anchor="center" panel-class="ui-external-lyrics-menu" @close="open = false">
    <div class="ui-external-lyrics-wheel">
      <svg viewBox="0 0 300 300" aria-label="外部歌词模式">
        <g v-for="(item, index) in modes" :key="item.mode" class="ui-external-lyrics-option" role="button" :tabindex="unavailable(item.mode) ? -1 : 0" :aria-label="item.name" :aria-disabled="unavailable(item.mode) || undefined" :aria-pressed="enabled(item.mode)" @click="toggle(item.mode)" @keydown.enter.prevent="toggle(item.mode)" @keydown.space.prevent="toggle(item.mode)">
          <title>{{ unavailable(item.mode) ? '任务栏歌词仅支持 Windows' : `${item.name} · 点击${enabled(item.mode) ? '关闭' : '开启'}` }}</title>
          <path class="ui-external-lyrics-wedge" :d="wedge(Number(index))" />
          <UiIcon :name="item.icon" :x="point(Number(index)).x - 12" :y="point(Number(index)).y - 29" width="24" height="24" />
          <text class="ui-external-lyrics-name" :x="point(Number(index)).x" :y="point(Number(index)).y + 14" text-anchor="middle">{{ item.name }}</text>
          <text class="ui-external-lyrics-state" :x="point(Number(index)).x" :y="point(Number(index)).y + 33" text-anchor="middle">{{ unavailable(item.mode) ? '仅 Windows' : enabled(item.mode) ? '已开启' : '未开启' }}</text>
        </g>
      </svg>
      <button type="button" class="ui-external-lyrics-settings" aria-label="外部歌词设置" @click="openSettings"><UiIcon name="gear" /><span>外部歌词</span><small>设置</small></button>
    </div>
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
const panelId = `ui-external-lyrics-${crypto.randomUUID()}`
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
const unavailable = (mode: ExternalLyricMode) => mode === 'taskbar' && !windows
function toggle(mode: ExternalLyricMode) { if (!unavailable(mode)) updateSetting({ [`externalLyric.${mode}.enabled`]: !enabled(mode) }) }
function polar(radius: number, degrees: number) { const angle = degrees * Math.PI / 180; return { x: 150 + radius * Math.cos(angle), y: 150 + radius * Math.sin(angle) } }
function point(index: number) { return polar(108, -90 + index * 120) }
function wedge(index: number) {
  const center = -90 + index * 120
  const a = polar(144, center - 58); const b = polar(144, center + 58)
  const c = polar(73, center + 58); const d = polar(73, center - 58)
  return `M${a.x},${a.y} A144,144 0 0 1 ${b.x},${b.y} L${c.x},${c.y} A73,73 0 0 0 ${d.x},${d.y} Z`
}
function openSettings() { open.value = false; setShowPlayerDetail(false); void router.push({ path: '/setting', query: { category: 'externalLyric' } }) }
onMounted(() => { ipcRenderer.on('externalLyric:open-settings', openSettings) })
onBeforeUnmount(() => { ipcRenderer.removeListener('externalLyric:open-settings', openSettings) })
</script>
<style lang="less">
.ui-player-popover.ui-external-lyrics-menu {
  border-radius: 50%;
  .ui-player-popover-content { padding: 6px; overflow: visible; }
}
.ui-external-lyrics-wheel {
  position: relative; width: 100%; aspect-ratio: 1; user-select: none; animation: ui-external-lyrics-appear .18s ease-out;
  > svg { display: block; width: 100%; height: 100%; overflow: visible; }
}
.ui-external-lyrics-option {
  color: var(--modern-muted); cursor: pointer; outline: none;
  .ui-external-lyrics-wedge { fill: var(--modern-hover); stroke: var(--modern-border); stroke-width: 1; transition: fill .18s, stroke .18s; }
  > .ui-svg-icon, > text { pointer-events: none; }
  > text { fill: currentColor; font-family: inherit; }
  .ui-external-lyrics-name { font-size: 13px; font-weight: 500; }
  .ui-external-lyrics-state { font-size: 10px; }
  &:hover, &:focus-visible { color: var(--modern-text); .ui-external-lyrics-wedge { fill: color-mix(in srgb, var(--modern-accent-soft) 65%, var(--modern-hover)); stroke: var(--modern-accent-ink); } }
  &:focus-visible .ui-external-lyrics-wedge { stroke-width: 2; }
  &[aria-pressed="true"] { color: var(--modern-accent-ink); .ui-external-lyrics-wedge { fill: var(--modern-accent-soft); stroke: var(--modern-accent-ink); } .ui-external-lyrics-state { font-weight: 600; } }
  &[aria-disabled="true"] { opacity: .35; cursor: default; .ui-external-lyrics-wedge { fill: var(--modern-hover); stroke: var(--modern-border); } }
}
.ui-external-lyrics-settings {
  position: absolute; top: 50%; left: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; width: 42%; aspect-ratio: 1; padding: 0; transform: translate(-50%, -50%); border: 1px solid var(--modern-border); border-radius: 50%; background: var(--modern-panel); color: var(--modern-text); box-shadow: 0 0 0 5px var(--modern-hover); font: inherit; cursor: pointer; transition: background .18s, border-color .18s;
  > svg { width: 23px; height: 23px; margin-bottom: 2px; color: var(--modern-accent-ink); }
  > span { font-size: 13px; font-weight: 600; line-height: 1.3; }
  > small { color: var(--modern-muted); font-size: 11px; line-height: 1.3; }
  &:hover { background: var(--modern-accent-soft); border-color: var(--modern-accent-ink); }
  &:focus-visible { outline: 2px solid var(--modern-accent-ink); outline-offset: 3px; }
}
@keyframes ui-external-lyrics-appear { from { opacity: 0; scale: .94; } to { opacity: 1; scale: 1; } }
@media (prefers-reduced-motion: reduce) { .ui-external-lyrics-wheel { animation: none; } .ui-external-lyrics-option .ui-external-lyrics-wedge, .ui-external-lyrics-settings { transition: none; } }
</style>

