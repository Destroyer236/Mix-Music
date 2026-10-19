<template>
  <div class="fpls-settings">
    <button type="button" class="fpls-row" :aria-pressed="appSetting['player.isShowLyricTranslation']" @click="toggleSetting('player.isShowLyricTranslation')"><span>显示翻译</span><span class="fpls-toggle" :class="{ on: appSetting['player.isShowLyricTranslation'] }" /></button>
    <button type="button" class="fpls-row" :aria-pressed="appSetting['player.isShowLyricRoma']" @click="toggleSetting('player.isShowLyricRoma')"><span>显示罗马音</span><span class="fpls-toggle" :class="{ on: appSetting['player.isShowLyricRoma'] }" /></button>
    <button type="button" class="fpls-row" :aria-pressed="appSetting['player.isPlayLxlrc']" @click="toggleSetting('player.isPlayLxlrc')"><span>逐字高亮</span><span class="fpls-toggle" :class="{ on: appSetting['player.isPlayLxlrc'] }" /></button>
    <div class="fpls-divider" />
    <label class="fpls-range"><span>字体大小</span><span>{{ preferences.fontSize }}</span><input :value="preferences.fontSize" type="range" min="24" max="58" step="2" aria-label="歌词字体大小" @input="editFontSize"></label>
    <label class="fpls-range"><span>上下间距</span><span>{{ preferences.lineSpacing }} px</span><input :value="preferences.lineSpacing" type="range" min="8" max="40" step="2" aria-label="歌词上下间距" @input="editLineSpacing"></label>
    <div class="fpls-align" role="group" aria-label="歌词对齐"><button v-for="alignment in alignments" :key="alignment.value" type="button" :aria-pressed="preferences.align === alignment.value" @click="preferences.align = alignment.value">{{ alignment.label }}</button></div>
    <button type="button" class="fpls-row" :aria-pressed="preferences.blur" @click="preferences.blur = !preferences.blur"><span>非当前歌词模糊</span><span class="fpls-toggle" :class="{ on: preferences.blur }" /></button>
    <button type="button" class="fpls-row" :aria-pressed="preferences.animation" @click="preferences.animation = !preferences.animation"><span>歌词滚动与缩放动画</span><span class="fpls-toggle" :class="{ on: preferences.animation }" /></button>
  </div>
</template>

<script setup lang="ts">
import { appSetting, mergeSetting, updateSetting } from '@renderer/store/setting'
import { fullPlayerLyricPreferences as preferences, type LyricAlignment } from '../services/fullPlayerLyricPreferences'

const alignments: Array<{ value: LyricAlignment, label: string }> = [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]

function editFontSize(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) preferences.fontSize = Math.max(24, Math.min(58, value))
}
function editLineSpacing(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) preferences.lineSpacing = Math.max(8, Math.min(40, value))
}
function toggleSetting(key: 'player.isShowLyricTranslation' | 'player.isShowLyricRoma' | 'player.isPlayLxlrc'): void {
  const setting = { [key]: !appSetting[key] }
  mergeSetting(setting)
  updateSetting(setting)
}
</script>

<style>
.fpls-settings { font-size: 13px; }
.fpls-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 40px; padding: 8px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.fpls-row:hover { background: var(--modern-hover); }
.fpls-divider { height: 1px; margin: 8px 0; background: var(--modern-border); }
.fpls-toggle { position: relative; flex: none; width: 28px; height: 16px; border-radius: 12px; background: var(--modern-border); transition: background .2s; }
.fpls-toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 10px; height: 10px; border-radius: 50%; background: var(--modern-muted); transition: transform .2s, background .2s; }
.fpls-toggle.on { background: var(--modern-accent); }
.fpls-toggle.on::after { transform: translateX(12px); background: var(--modern-accent-contrast, #fff); }
.fpls-range { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; padding: 10px 8px; }
.fpls-range > span:last-of-type { color: var(--modern-muted); font-variant-numeric: tabular-nums; }
.fpls-range input { width: 100%; margin: 0; accent-color: var(--modern-accent); }
.fpls-align { display: flex; gap: 3px; margin: 7px 8px; padding: 3px; border-radius: 8px; background: var(--modern-hover); }
.fpls-align button { flex: 1; padding: 7px 0; border: 0; border-radius: 5px; background: transparent; color: var(--modern-muted); font: inherit; font-size: 11px; cursor: pointer; }
.fpls-align button[aria-pressed='true'] { background: var(--modern-panel); color: var(--modern-text); box-shadow: 0 1px 5px #0001; }
.fpls-settings button:focus-visible, .fpls-range input:focus-visible { outline: 2px solid var(--modern-accent-ink); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .fpls-toggle, .fpls-toggle::after { transition: none; } }
</style>
