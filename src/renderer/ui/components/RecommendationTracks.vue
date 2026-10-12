<template>
  <div class="ui-recommend-tracks">
    <article v-for="(track, index) in tracks" :key="`${track.source}:${track.id}`" class="ui-recommend-track">
      <button type="button" class="ui-recommend-track-cover" :aria-label="`播放 ${track.name}`" @click="emit('play', track)"><TrackArtwork :track="track" /><span><UiIcon name="play" filled /></span></button>
      <div class="ui-recommend-track-info"><button type="button" :title="track.name" @click="emit('play', track)">{{ track.name }}</button><span :title="track.singer">{{ track.singer || '未知歌手' }}</span><small v-if="showSource" class="ui-recommend-source">{{ platformLabel(track) }}</small></div>
      <span v-if="ranked" class="ui-recommend-rank">{{ String(Number(index) + 1).padStart(2, '0') }}</span>
      <button type="button" class="ui-icon-button ui-recommend-like" :aria-pressed="isFavorite(track)" :aria-label="`${isFavorite(track) ? '取消喜欢' : '喜欢'} ${track.name}`" :disabled="favoritePending.has(track.id)" :class="{ 'ui-active': isFavorite(track) }" @click="requestFavorite(track, !isFavorite(track))"><UiIcon name="heart" :filled="isFavorite(track)" /></button>
    </article>
  </div>
</template>
<script setup lang="ts">
import UiIcon from './UiIcon.vue'
import { sourceNames } from '@renderer/store'
import TrackArtwork from './TrackArtwork.vue'
import { favoritePending, isFavorite, requestFavorite } from '../services/platformAccounts'
withDefaults(defineProps<{ tracks: LX.Music.MusicInfo[], ranked?: boolean, showSource?: boolean }>(), { ranked: false, showSource: false })
const platformLabel = (track: LX.Music.MusicInfo) => track.source === 'local' ? '本地音乐' : sourceNames.value[track.source] || track.source
const emit = defineEmits<{ play: [track: LX.Music.MusicInfo] }>()
</script>

