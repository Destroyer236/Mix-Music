<template>
  <div class="ui-player-options">
    <button ref="trigger" type="button" class="ui-icon-button" aria-label="更多功能" title="更多功能" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId" @click="open = !open" @keydown.down.prevent="open = true"><UiIcon name="more" /></button>
    <PlayerPopover :id="panelId" :show="open" title="更多功能" :subtitle="track ? track.name + ' · ' + track.singer : '选择歌曲后可使用更多操作'" :width="272" :trigger="trigger" anchor="trigger" panel-class="ui-player-song-menu" @close="open = false">
      <div class="ui-player-menu-actions"><button type="button" :disabled="!albumName" @click="viewAlbum"><UiIcon name="album" /><span>查看专辑</span><UiIcon name="chevronRight" /></button><button type="button" :disabled="!track || favoritePending" :aria-pressed="collected" @click="emit('collect')"><UiIcon name="heart" :filled="collected" /><span>{{ collected ? '已加入我喜欢' : '我喜欢' }}</span><UiIcon v-if="collected" name="check" /></button><button type="button" :disabled="!track" @click="openAdd"><UiIcon name="plus" /><span>添加到歌单</span><UiIcon name="chevronRight" /></button><button type="button" :disabled="!track" @click="share"><UiIcon name="share" /><span>分享</span></button></div>
      <div class="ui-player-menu-actions ui-player-menu-feedback"><button type="button" :disabled="!track || reducingRecommendations" @click="reduceRecommendations"><UiIcon name="minusCircle" /><span>减少推荐</span></button></div>
      <div class="ui-player-speed"><strong>倍速<span>{{ playbackRate.toFixed(2).replace(/0$/, '') }}×</span></strong><div class="ui-player-speed-slider"><UiRange :model-value="playbackRate" :min="0.5" :max="2" :step="0.05" aria-label="播放倍速" :aria-valuetext="playbackRate.toFixed(2) + ' 倍速'" @input="changeRate" /><span class="ui-player-speed-tick" :class="{ 'is-current': playbackRate === 1 }" aria-hidden="true" /></div><div class="ui-player-speed-marks"><span>0.5×</span><button type="button" aria-label="恢复正常倍速" @click="changeRate(1)">1×</button><span>2×</span></div></div>
      <p v-if="message" class="ui-player-menu-message" role="status">{{ message }}</p>
    </PlayerPopover>
    <TrackActionModal v-if="addOpen && actionTrack" :show="addOpen" :tracks="[actionTrack]" action="add" @close="addOpen = false" @success="message = $event" />
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import musicSdk from '@renderer/utils/musicSdk'
import { toOldMusicInfo } from '@renderer/utils'
import { clipboardWriteText } from '@common/utils/electron'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import { playbackRate } from '@renderer/store/player/playbackRate'
import { getCatalogSources } from '../services/catalogSearch'
import { reduceTrackRecommendations, reducingRecommendations } from '../services/recommendationFeedback'
import { showPlayerNotice } from '../services/playerNotice'
import UiIcon from './UiIcon.vue'
import UiRange from './UiRange.vue'
import PlayerPopover from './PlayerPopover.vue'
import TrackActionModal from './TrackActionModal.vue'
const props = defineProps<{ track: LX.Music.MusicInfo | null, collected: boolean, favoritePending: boolean }>()
const emit = defineEmits<{ collect: [] }>()
const router = useRouter()
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const addOpen = ref(false)
const actionTrack = ref<LX.Music.MusicInfo | null>(null)
const message = ref('')
const panelId = `player-song-menu-${crypto.randomUUID()}`
const albumName = computed(() => String(props.track?.meta?.albumName ?? '').trim())
watch(open, show => { if (show) message.value = '' })
watch(() => props.track?.id, () => { open.value = false })
function viewAlbum() {
  if (!props.track || !albumName.value) return
  const source = getCatalogSources('album').includes(props.track.source as LX.OnlineSource) ? props.track.source : 'all'
  setShowPlayerDetail(false)
  void router.push({ path: '/search', query: { text: albumName.value, type: 'album', source, page: '1' } })
  open.value = false
}
function openAdd() { if (!props.track) return; actionTrack.value = props.track; open.value = false; addOpen.value = true }
async function reduceRecommendations() {
  if (!props.track || reducingRecommendations.value) return
  const track = props.track
  open.value = false
  try { await reduceTrackRecommendations(track) } catch { showPlayerNotice('减少推荐未保存，请重试') }
}
function share() {
  const track = props.track
  if (!track) return
  try {
    const url = track.source === 'local' ? '' : musicSdk[track.source as LX.OnlineSource]?.getMusicDetailPageUrl?.(toOldMusicInfo(track))
    clipboardWriteText([`${track.name} - ${track.singer}`, typeof url === 'string' && /^https?:\/\//.test(url) ? url : ''].filter(Boolean).join('\n'))
    message.value = url ? '歌曲信息和平台链接已复制' : '歌曲信息已复制'
  } catch { message.value = '暂时无法复制歌曲信息，请重试' }
}
function changeRate(rate: number) { window.app_event.setPlaybackRate(rate) }
</script>
