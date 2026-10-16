<template>
  <span v-if="sourceLabel || isVip || trial" class="ui-track-badges" aria-label="歌曲标识">
    <small v-if="sourceLabel" class="ui-track-badge ui-track-badge--source" :title="sourceLabel">{{ sourceLabel }}</small>
    <small v-if="isVip" class="ui-track-badge ui-track-badge--vip" title="VIP 歌曲" aria-label="VIP 歌曲">VIP</small>
    <small v-if="trial" class="ui-track-badge ui-track-badge--trial" title="当前播放的是试听片段" aria-label="当前播放的是试听片段">试听</small>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { sourceNames } from '@renderer/store'

const props = defineProps({
  track: { type: Object, default: null },
  showSource: { type: Boolean, default: true },
  trial: { type: Boolean, default: false },
})
const sourceLabel = computed(() => props.showSource && props.track && props.track.source !== 'local' ? sourceNames.value[props.track.source] || props.track.source : '')
const isVip = computed(() => props.track?.source !== 'local' && props.track?.meta?.isVip === true)
</script>

<style scoped lang="less">
.ui-track-badges.ui-track-badges { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: flex-start; gap: 4px; width: auto; max-width: 100%; min-width: 0; margin: 0; overflow: visible; white-space: nowrap; vertical-align: middle; line-height: 1; }
.ui-track-badges > .ui-track-badge { display: inline-flex; flex: none; align-items: center; justify-content: center; box-sizing: border-box; width: auto; min-height: 16px; margin: 0; padding: 2px 4px; border: 0; border-radius: 3px; font-size: 9px; font-weight: 550; line-height: 12px; letter-spacing: .15px; white-space: nowrap; }
.ui-track-badge--source { color: var(--modern-accent-ink); background: var(--modern-accent-soft); }
.ui-track-badge--vip { color: color-mix(in srgb, #c78c28 70%, var(--modern-text)); background: color-mix(in srgb, #c78c28 14%, transparent); }
.ui-track-badge--trial { color: var(--modern-text); background: color-mix(in srgb, var(--modern-text) 9%, transparent); }
</style>
