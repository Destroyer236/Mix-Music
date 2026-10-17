<template>
  <div v-if="hasTracks" class="playlist-floating-buttons" aria-label="歌单导航">
    <button v-if="canJumpCurrent" type="button" class="playlist-floating-buttons__button" aria-label="跳转到当前播放歌曲" title="当前播放歌曲" @click="jumpCurrent">
      <UiIcon name="focus" />
    </button>
    <button type="button" class="playlist-floating-buttons__button" aria-label="回到歌单顶部" title="回到顶部" @click="$emit('scrollToTop')">
      <UiIcon name="arrowUp" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { playMusicInfo } from '@renderer/store/player/state'
import UiIcon from './UiIcon.vue'

const props = defineProps<{
  tracks: LX.Music.MusicInfo[]
}>()
const emit = defineEmits<{
  jumpCurrent: [index: number]
  scrollToTop: []
}>()

const currentTrack = computed(() => {
  const track = playMusicInfo.musicInfo
  return track && 'metadata' in track ? track.metadata.musicInfo : track
})
const currentIndex = computed(() => {
  const current = currentTrack.value
  if (!current) return -1
  return props.tracks.findIndex((track: LX.Music.MusicInfo) => track.id === current.id && track.source === current.source)
})
const hasTracks = computed(() => props.tracks.length > 0)
const canJumpCurrent = computed(() => currentIndex.value >= 0)

function jumpCurrent() {
  const index = currentIndex.value
  if (index >= 0) emit('jumpCurrent', index)
}
</script>

<style lang="less">
.playlist-floating-buttons {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--modern-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--modern-panel) 94%, transparent);
  box-shadow: 0 5px 18px rgba(0, 0, 0, .12);
  backdrop-filter: blur(8px);
}
.playlist-floating-buttons__button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--modern-border);
  color: var(--modern-muted);
  background: transparent;
  cursor: pointer;
  transition: color .15s, background .15s;
  &:last-child { border-bottom: 0; }
  &:hover, &:focus-visible { color: var(--modern-text); background: var(--modern-hover); }
  &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: -3px; }
  svg { width: 18px; height: 18px; }
}
@media (max-width: 760px) {
  .playlist-floating-buttons { right: 12px; bottom: 16px; }
  .playlist-floating-buttons__button { width: 36px; height: 36px; }
}
</style>
