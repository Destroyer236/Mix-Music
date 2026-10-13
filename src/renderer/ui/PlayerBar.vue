<template>
  <section class="ui-player" :class="`ui-progress-${appSetting['common.playBarProgressStyle']}`" aria-label="音乐播放器">
    <div class="ui-player-track">
      <button type="button" class="ui-player-cover" aria-label="打开播放详情" @click="setShowPlayerDetail(true)"><TrackArtwork :track="currentTrack" :src="musicInfo.pic" :alt="musicInfo.name" /></button>
      <div class="ui-player-info"><div class="ui-player-title-line"><button type="button" :title="musicInfo.name" @click="setShowPlayerDetail(true)">{{ musicInfo.name || '选择一首歌，开始聆听' }}</button><span class="ui-player-artists" :title="musicInfo.singer"><template v-if="artistNames.length"><template v-for="(artist, index) in artistNames" :key="artist"><span v-if="index" aria-hidden="true"> / </span><router-link :to="artistLocation(artist)" :aria-label="`查看歌手 ${artist}`" @click="openArtist">{{ artist }}</router-link></template></template><template v-else>{{ musicInfo.name ? '未知歌手' : '每一种心情，都有自己的旋律' }}</template></span></div>
        <div class="ui-player-song-actions"><button type="button" class="ui-icon-button ui-collect-button" :aria-pressed="collected" :aria-label="collected ? '取消收藏当前歌曲' : '收藏当前歌曲'" :class="{ 'ui-active': collected }" :disabled="!currentTrack" @click="toggleCollect"><UiIcon name="heart" :filled="collected" /></button><button type="button" class="ui-icon-button" aria-label="查看歌曲评论" :disabled="!currentTrack" @click="openComments"><UiIcon name="comment" /></button><PlayerOptions :track="currentTrack" :collected="collected" :favorite-pending="currentTrack ? favoritePending.has(currentTrack.id) : false" @collect="toggleCollect" /></div>
      </div>
    </div>
    <div class="ui-player-center"><div class="ui-player-control-row"><button type="button" class="ui-icon-button ui-play-mode-button" :aria-label="modeLabel" :title="modeLabel" @click="cyclePlayMode"><UiIcon :name="currentMode.icon" /></button><div class="ui-transport"><button type="button" class="ui-icon-button" aria-label="上一首" @click="playPrev()"><UiIcon name="prev" filled /></button><button type="button" class="ui-play-button" :aria-label="isPlay ? '暂停' : '播放'" @click="togglePlay"><UiIcon :name="isPlay ? 'pause' : 'play'" filled /></button><button type="button" class="ui-icon-button" aria-label="下一首" @click="playNext()"><UiIcon name="next" filled /></button></div><VolumeControl /></div><div class="ui-seek"><span>{{ playProgress.nowPlayTimeStr }}</span><UiRange :model-value="seeking ?? playProgress.nowPlayTime" :max="playProgress.maxPlayTime || 1" :step="0.1" aria-label="播放进度" :disabled="!playProgress.maxPlayTime" @input="seeking = $event" @change="seek" /><span>{{ playProgress.maxPlayTimeStr }}</span></div></div>
    <div class="ui-player-right-tools"><QualityControl :track="currentTrack" defer-load /><button type="button" class="ui-icon-button" :class="{ 'ui-active': appSetting['desktopLyric.enable'] }" :aria-pressed="appSetting['desktopLyric.enable']" aria-label="切换桌面歌词" title="桌面歌词" @click="toggleDesktopLyric"><UiIcon name="lyric" /></button><button ref="queueTrigger" type="button" class="ui-icon-button ui-player-queue" aria-label="播放列表" aria-haspopup="dialog" :aria-expanded="queueOpen" @click="queueOpen = !queueOpen"><UiIcon name="queue" /></button></div>
    <PlayerPopover :show="queueOpen" title="播放列表" :subtitle="`${queue.length} 首歌曲`" :width="380" :trigger="queueTrigger" panel-class="ui-player-queue-panel" @close="queueOpen = false"><div v-if="!queue.length" class="ui-empty">选择歌曲后，播放队列会出现在这里。</div><button v-for="(item, index) in queue" :key="item.id" type="button" class="ui-queue-track" :class="{ 'ui-active': item.id === musicInfo.id }" @click="playList(playMusicInfo.listId, index)"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ item.name }}</strong><small>{{ item.singer }}</small></button><template v-if="tempPlayList.length"><h3 class="ui-queue-heading">稍后播放</h3><div v-for="item in tempPlayList" :key="item.musicInfo.id" class="ui-queue-track">{{ item.musicInfo.name }} · {{ item.musicInfo.singer }}</div></template></PlayerPopover>
  </section>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { musicInfo, isPlay, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import { playProgress } from '@renderer/store/player/playProgress'
import { appSetting, setTogglePlayMode } from '@renderer/store/setting'
import { togglePlay, playNext, playPrev, playList } from '@renderer/core/player'
import { getListMusics } from '@renderer/store/list/action'
import { favoritePending, isFavorite, requestFavorite } from './services/platformAccounts'
import { getDownloadList } from '@renderer/store/download/action'
import useToggleDesktopLyric from '@renderer/utils/compositions/useToggleDesktopLyric'
import UiIcon from './components/UiIcon.vue'
import PlayerPopover from './components/PlayerPopover.vue'
import QualityControl from './components/QualityControl.vue'
import UiRange from './components/UiRange.vue'
import VolumeControl from './components/VolumeControl.vue'
import PlayerOptions from './components/PlayerOptions.vue'
import TrackArtwork from './components/TrackArtwork.vue'
import { getCatalogSources } from './services/catalogSearch'
const playModes = [{ value: 'listLoop', label: '列表循环', icon: 'repeat' }, { value: 'random', label: '随机播放', icon: 'shuffle' }, { value: 'singleLoop', label: '单曲循环', icon: 'repeatOne' }, { value: 'list', label: '顺序播放', icon: 'listPlay' }]
const normalizePlayMode = mode => { if (mode === 'none') setTogglePlayMode('listLoop') }
watch(() => appSetting['player.togglePlayMethod'], normalizePlayMode, { immediate: true })
const modeIndex = computed(() => Math.max(0, playModes.findIndex(mode => mode.value === appSetting['player.togglePlayMethod'])))
const currentMode = computed(() => playModes[modeIndex.value])
const modeLabel = computed(() => `播放模式：${currentMode.value.label}，点击切换为${playModes[(modeIndex.value + 1) % playModes.length].label}`)
const cyclePlayMode = () => { setTogglePlayMode(playModes[(modeIndex.value + 1) % playModes.length].value) }
const { toggleDesktopLyric } = useToggleDesktopLyric()
const currentTrack = computed(() => { const item = playMusicInfo.musicInfo; return item && 'metadata' in item ? item.metadata.musicInfo : item })
const artistNames = computed(() => [...new Set(String(musicInfo.singer || '').split(/\s*、\s*|\s+\/\s+/).map(name => name.trim()).filter(Boolean))])
const artistLocation = text => ({ path: '/search', query: { text, type: 'artist', source: getCatalogSources('artist').includes(currentTrack.value?.source) ? currentTrack.value.source : 'all', page: '1' } })
const openArtist = () => { queueOpen.value = false; setShowPlayerDetail(false) }
const collected = computed(() => isFavorite(currentTrack.value))
const toggleCollect = () => { if (currentTrack.value && !favoritePending.value.has(currentTrack.value.id)) requestFavorite(currentTrack.value, !collected.value) }
const router = useRouter()
const openComments = () => {
  if (!currentTrack.value) return
  queueOpen.value = false
  setShowPlayerDetail(false)
  void router.push({ path: '/comment', query: { id: playMusicInfo.musicInfo.id, listId: playMusicInfo.listId ?? undefined } })
}
const seeking = ref(null)
const queueTrigger = ref(null)
const queueOpen = ref(false)
const queue = ref([])
const seek = () => { window.app_event.setProgress(seeking.value ?? 0); seeking.value = null }
watch(queueOpen, async show => { if (show) queue.value = playMusicInfo.listId === 'download' ? (await getDownloadList()).map(task => task.metadata.musicInfo) : playMusicInfo.listId ? await getListMusics(playMusicInfo.listId) : [] })
</script>
