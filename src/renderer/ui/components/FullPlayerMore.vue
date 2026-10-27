<template>
  <div class="ui-full-more">
    <button ref="trigger" type="button" class="ui-icon-button ui-full-more-trigger" aria-label="更多播放器功能" title="更多功能" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId" @click="open = !open" @keydown.down.prevent="open = true"><UiIcon name="settings" /></button>
    <PlayerPopover :id="panelId" :show="open" :title="pageTitle" :subtitle="page === 'home' ? '播放器工具与外观' : ''" :trigger="trigger" :width="360" anchor="trigger" placement="left" panel-class="ui-full-more-popover" @close="close">
      <div class="ui-full-more-content" tabindex="-1" @keydown.esc.stop.prevent="back" @keydown.left="backKey">
        <button v-if="page !== 'home'" type="button" class="ui-full-more-back" @click="back"><UiIcon name="back" /><span>返回更多功能</span></button>
        <Transition name="ui-full-menu-page" mode="out-in" @after-enter="focusPage">
          <div :key="page">
            <div v-if="page === 'home'" class="ui-full-more-items">
              <button v-for="item in menuItems" :key="item.page" type="button" @click="navigate(item.page)" @keydown.right.prevent="navigate(item.page)"><UiIcon :name="item.icon" /><span>{{ item.label }}</span><small v-if="item.value">{{ item.value }}</small><UiIcon name="chevronRight" /></button>
              <div class="ui-full-more-divider" />
              <button type="button" :disabled="!track" @click="addTrack"><UiIcon name="plus" /><span>添加到歌单</span></button>
              <button type="button" :disabled="!onlineTrack" @click="navigate('download')" @keydown.right.prevent="navigate('download')"><UiIcon name="download" /><span>下载歌曲</span><UiIcon name="chevronRight" /></button>
              <button type="button" :disabled="!track" @click="shareTrack"><UiIcon name="share" /><span>分享 · 复制歌曲链接</span></button>
            </div>
            <FullPlayerLyricSettings v-else-if="page === 'lyrics'" />
            <dl v-else-if="page === 'info'" class="ui-full-audio-info">
              <template v-for="item in audioInfo" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></template>
            </dl>
            <div v-else-if="page === 'speed'" class="ui-full-speed">
              <strong>{{ formatRate(playbackRate) }}<small>×</small></strong>
              <UiRange :model-value="playbackRate" :min="0.5" :max="2" :step="0.05" aria-label="播放速度" @input="changeRate" />
              <div class="ui-full-choice-grid"><button v-for="rate in rates" :key="rate" type="button" :class="{ 'is-selected': playbackRate === rate }" :aria-pressed="playbackRate === rate" @click="changeRate(rate)">{{ formatRate(rate) }}×</button></div>
              <label class="ui-full-more-switch"><span>变速时保持原有音调</span><input type="checkbox" :checked="appSetting['player.preservesPitch']" @change="saveBoolean('player.preservesPitch', $event)"></label>
              <div class="ui-full-pitch"><label for="full-player-pitch">独立升降调 <strong>{{ pitchSemitones > 0 ? '+' : '' }}{{ pitchSemitones }} 半音</strong></label><UiRange id="full-player-pitch" :model-value="pitchSemitones" :min="-12" :max="12" :step="1" aria-label="独立升降调" @input="previewPitch" @change="savePitch" /><button type="button" @click="savePitch(0)">恢复原调</button></div>
            </div>
            <div v-else-if="page === 'equalizer'" class="ui-full-equalizer">
              <label class="ui-full-more-switch"><span>启用均衡器</span><input type="checkbox" :checked="!eqBypassed" :disabled="busy" @change="toggleEqualizer"></label>
              <p class="ui-full-more-note">调节各频段增益，实时作用于当前播放音频。</p>
              <div class="ui-full-eq-presets"><button type="button" :disabled="busy" @click="applyPreset(null)">平直</button><button v-for="preset in freqsPreset" :key="preset.name" type="button" :disabled="busy" @click="applyPreset(preset)">{{ presetLabels[preset.name] }}</button></div>
              <div class="ui-full-eq-bands"><label v-for="frequency in freqs" :key="frequency"><output>{{ gainLabel(equalizerGains[frequency]) }}</output><UiRange :model-value="equalizerGains[frequency]" :disabled="busy" :min="-15" :max="15" :step="0.5" vertical :aria-label="frequency + ' Hz 增益'" :aria-valuetext="gainLabel(equalizerGains[frequency]) + ' dB'" @input="previewBand(frequency, $event)" @change="saveBand(frequency, $event)" /><span>{{ frequency >= 1000 ? frequency / 1000 + 'k' : frequency }}</span></label></div>
              <p class="ui-full-more-note">均衡器使用系统默认输出设备。</p>
              <button type="button" class="ui-full-more-secondary" :disabled="busy" @click="applyPreset(null)">重置均衡器</button>
            </div>
            <div v-else-if="page === 'ab'" class="ui-full-ab">
              <p class="ui-full-more-note">在当前歌曲中截取片段循环播放，切歌后自动清除。</p>
              <div class="ui-full-ab-points"><button type="button" :disabled="!track" @click="markPoint('a')"><small>A 起点</small><strong>{{ formatTime(playerSessionTools.abStart) }}</strong><span>设为当前进度</span></button><button type="button" :disabled="!track" @click="markPoint('b')"><small>B 终点</small><strong>{{ formatTime(playerSessionTools.abEnd) }}</strong><span>设为当前进度</span></button></div>
              <div v-for="point in (['a', 'b'] as const)" :key="point" class="ui-full-ab-adjust"><span>{{ point.toUpperCase() }}</span><button type="button" :disabled="abValue(point) === null" :aria-label="`${point.toUpperCase()} 点提前 0.1 秒`" @click="adjustPoint(point, -0.1)">−0.1s</button><button type="button" :disabled="abValue(point) === null" :aria-label="`${point.toUpperCase()} 点延后 0.1 秒`" @click="adjustPoint(point, 0.1)">+0.1s</button><button type="button" :disabled="abValue(point) === null" :aria-label="`清除 ${point.toUpperCase()} 点`" @click="clearPoint(point)">清除</button></div>
              <button type="button" class="ui-full-more-primary" :disabled="playerSessionTools.abStart === null || playerSessionTools.abEnd === null" :aria-pressed="playerSessionTools.abEnabled" @click="toggleAB">{{ playerSessionTools.abEnabled ? '暂停片段循环' : '开始片段循环' }}</button>
              <button type="button" class="ui-full-more-secondary" @click="resetABLoop">清除 A / B 点</button>
            </div>
            <div v-else-if="page === 'sleep'" class="ui-full-sleep">
              <p class="ui-full-more-note">到时暂停音乐，关闭播放器页面后仍会继续计时。</p>
              <p v-if="playerSessionTools.sleepDeadline !== null" class="ui-full-sleep-countdown" role="status">将在 {{ formatTime(playerSessionTools.sleepRemaining) }} 后暂停</p>
              <div class="ui-full-choice-grid"><button v-for="minutes in [10, 20, 30, 45, 60, 90, 120]" :key="minutes" type="button" @click="startTimer(minutes)">{{ minutes }} 分钟</button></div>
              <form class="ui-full-sleep-custom" @submit.prevent="startTimer(customMinutes)"><input :value="customMinutes" type="number" min="1" max="180" required aria-label="自定义暂停分钟数" @input="editCustomMinutes"><span>分钟</span><button type="submit">{{ playerSessionTools.sleepDeadline === null ? '开始' : '更新' }}</button></form>
              <label class="ui-full-more-switch"><span>等待当前歌曲播放完毕再暂停</span><input type="checkbox" :checked="appSetting['player.waitPlayEndStop']" @change="saveBoolean('player.waitPlayEndStop', $event)"></label>
              <button v-if="playerSessionTools.sleepDeadline !== null" type="button" class="ui-full-more-secondary" @click="cancelTimer">取消定时暂停</button>
            </div>
            <div v-else-if="page === 'appearance'" class="ui-full-appearance">
              <h3>封面布局</h3><div class="ui-full-choice-grid"><button v-for="option in coverLayouts" :key="option.value" type="button" :class="{ 'is-selected': playerPresentation.coverLayout === option.value }" :aria-pressed="playerPresentation.coverLayout === option.value" @click="patchPlayerPresentation({ coverLayout: option.value })">{{ option.label }}</button></div>
              <h3>播放器背景</h3><div class="ui-full-choice-grid"><button v-for="option in backgrounds" :key="option.value" type="button" :class="{ 'is-selected': playerPresentation.background === option.value }" :aria-pressed="playerPresentation.background === option.value" @click="patchPlayerPresentation({ background: option.value })">{{ option.label }}</button></div>
              <label v-for="option in presentationSwitches" :key="option.key" class="ui-full-more-switch"><span>{{ option.label }}</span><input :checked="playerPresentation[option.key]" type="checkbox" @change="changePresentation(option.key, $event)"></label>
            </div>
            <div v-else-if="page === 'source'" class="ui-full-more-items">
              <p class="ui-full-more-note">优先使用所选平台或导入音源，不可用时自动换源，切换时保留播放进度。</p>
              <button v-for="option in preferredSourceOptions" :key="option.value" type="button" :disabled="busy" :aria-pressed="preferredSource === option.value" @click="chooseSource(option.value)"><span>{{ option.label }}</span><UiIcon v-if="preferredSource === option.value" name="check" /></button>
            </div>
            <div v-else-if="page === 'device'" class="ui-full-more-items">
              <button type="button" :disabled="busy" :aria-pressed="appSetting['player.mediaDeviceId'] === 'default'" @click="chooseDevice('default')"><UiIcon name="headphones" /><span>系统默认设备</span><UiIcon v-if="appSetting['player.mediaDeviceId'] === 'default'" name="check" /></button>
              <button v-for="(device, index) in devices" :key="device.deviceId" type="button" :disabled="busy" :aria-pressed="appSetting['player.mediaDeviceId'] === device.deviceId" @click="chooseDevice(device.deviceId)"><span>{{ device.label || '音频输出设备 ' + (index + 1) }}</span><UiIcon v-if="appSetting['player.mediaDeviceId'] === device.deviceId" name="check" /></button>
              <p v-if="deviceError" class="ui-full-more-note" role="status">{{ deviceError }}</p>
              <button type="button" :disabled="loadingDevices" @click="refreshDevices"><UiIcon name="refresh" /><span>{{ loadingDevices ? '正在读取设备…' : '刷新输出设备' }}</span></button>
            </div>
            <div v-else-if="page === 'download'" class="ui-full-more-items">
              <p v-if="!downloadQualities.length && !autoQuality" class="ui-full-more-note">当前歌曲没有可用的下载音质。请先在设置中导入支持该歌曲的音乐源。</p>
              <button v-if="autoQuality" type="button" class="ui-full-more-auto" :disabled="busy" @click="downloadTrackAuto()"><UiIcon name="download" /><span>自动选择音质与音源<small>逐首跨音源取最高，预期 {{ downloadLabels[autoQuality] }}</small></span></button>
              <button v-for="quality in downloadQualities" :key="quality" type="button" :disabled="busy" @click="downloadTrack(quality)"><UiIcon name="download" /><span>{{ downloadLabels[quality] }}</span></button>
              <p class="ui-full-more-note ui-full-download-location">保存位置：{{ appSetting['download.savePath'] || '未设置' }}</p>
            </div>
          </div>
        </Transition>
      </div>
    </PlayerPopover>
    <TrackActionModal v-if="addOpen && actionTrack" :show="addOpen" :tracks="[actionTrack]" action="add" @close="addOpen = false" @success="emit('notice', $event)" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { clipboardWriteText } from '@common/utils/electron'
import { platformSourceLabels, type PreferredPlatformSource } from '@common/platformSources'
import { qualityLabels } from '@common/platformPlayback'
import { bestTrackQuality, trackQualities } from '../services/downloadQuality'
import { qualityList } from '@renderer/store'
import { appSetting, mergeSetting } from '@renderer/store/setting'
import { playbackRate } from '@renderer/store/player/playbackRate'
import { playMusicInfo } from '@renderer/store/player/state'
import { createDownloadTasks, getDownloadList } from '@renderer/store/download/action'
import { freqs, freqsPreset, hasInitedAdvancedAudioFeatures, setMediaDeviceId } from '@renderer/plugins/player'
import { updateSetting } from '@renderer/utils/ipc'
import { toOldMusicInfo } from '@renderer/utils'
import musicSdk from '@renderer/utils/musicSdk'
import { activePlaybackResource, activeStream, preferredSource, setPreferredSource } from '../services/platformPlayback'
import { preferredSourceOptions } from '../services/playbackSourceOptions'
import { patchPlayerPresentation, playerPresentation, type PlayerBackground, type PlayerCoverLayout } from '../services/playerPresentation'
import { cancelSleepTimer, playerSessionTools, resetABLoop, setABEnabled, setABPoint, startSleepTimer } from '../services/playerSessionTools'
import { applyEqualizerPreset, eqBypassed, equalizerGains, previewEqualizerBand, saveEqualizerBand, setEqualizerEnabled } from '../services/playerEqualizer'
import PlayerPopover from './PlayerPopover.vue'
import FullPlayerLyricSettings from './FullPlayerLyricSettings.vue'
import TrackActionModal from './TrackActionModal.vue'
import UiIcon from './UiIcon.vue'
import UiRange from './UiRange.vue'

type MenuPage = 'home' | 'lyrics' | 'info' | 'equalizer' | 'speed' | 'ab' | 'sleep' | 'appearance' | 'source' | 'device' | 'download'
interface FullPlayerMoreProps { track: LX.Music.MusicInfo | null }
const props: FullPlayerMoreProps = defineProps<FullPlayerMoreProps>()
const emit = defineEmits<{ notice: [message: string] }>()
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const page = ref<MenuPage>('home')
const busy = ref(false)
const addOpen = ref(false)
const actionTrack = ref<LX.Music.MusicInfo | null>(null)
const customMinutes = ref(30)
const devices = ref<MediaDeviceInfo[]>([])
const loadingDevices = ref(false)
const deviceError = ref('')
const panelId = `full-player-more-${crypto.randomUUID()}`
const rates = [0.5, 0.75, 1, 1.25, 1.5, 2]
const pitchSemitones = computed(() => Math.round(Math.log2(appSetting['player.soundEffect.pitchShifter.playbackRate']) * 12))
const pageLabels: Record<MenuPage, string> = { home: '更多功能', lyrics: '歌词设置', info: '音频信息', equalizer: '均衡器', speed: '播放速度', ab: 'AB 片段循环', sleep: '定时暂停', appearance: '播放器外观', source: '首选音源', device: '输出设备', download: '下载歌曲' }
const pageTitle = computed(() => pageLabels[page.value])
const menuItems = computed<Array<{ page: MenuPage, label: string, icon: string, value?: string }>>(() => [
  { page: 'lyrics', label: pageLabels.lyrics, icon: 'lyric' },
  { page: 'info', label: pageLabels.info, icon: 'quality' },
  { page: 'equalizer', label: pageLabels.equalizer, icon: 'settings' },
  { page: 'speed', label: pageLabels.speed, icon: 'clock', value: formatRate(playbackRate.value) + '×' },
  { page: 'ab', label: pageLabels.ab, icon: 'repeat', value: playerSessionTools.abEnabled ? '循环中' : '' },
  { page: 'sleep', label: pageLabels.sleep, icon: 'moon', value: playerSessionTools.sleepDeadline !== null ? formatTime(playerSessionTools.sleepRemaining) : '' },
  { page: 'appearance', label: pageLabels.appearance, icon: 'palette' },
  { page: 'device', label: pageLabels.device, icon: 'headphones' },
  { page: 'source', label: pageLabels.source, icon: 'globe' },
])
const coverLayouts: Array<{ value: PlayerCoverLayout, label: string }> = [{ value: 'square', label: '方形封面' }, { value: 'vinyl', label: '黑胶唱片' }, { value: 'fullscreen', label: '全屏封面' }]
const backgrounds: Array<{ value: PlayerBackground, label: string }> = [{ value: 'theme', label: '软件主题' }, { value: 'blur', label: '封面模糊' }, { value: 'dynamic', label: '流动光影' }]
const presentationSwitches: Array<{ key: 'immersive' | 'spectrum' | 'autoCenterCover', label: string }> = [{ key: 'immersive', label: '沉浸模式 · 闲置时淡出操作栏' }, { key: 'spectrum', label: '音频频谱' }, { key: 'autoCenterCover', label: '无歌词时封面自动居中' }]
const presetLabels: Record<typeof freqsPreset[number]['name'], string> = { pop: '流行', dance: '舞曲', rock: '摇滚', classical: '古典', vocal: '人声', slow: '慢歌', electronic: '电子', subwoofer: '重低音', soft: '柔和' }
const downloadLabels: Record<LX.Quality, string> = { flac24bit: 'Hi-Res 高解析', flac: 'SQ', ape: 'APE 无损', wav: 'WAV 无损', '320k': 'HQ', '192k': '清晰 192 kbps', '128k': 'SD' }
const onlineTrack = computed<LX.Music.MusicInfoOnline | null>(() => props.track && props.track.source !== 'local' ? props.track : null)
const downloadQualities = computed(() => {
  const track = onlineTrack.value
  return track ? trackQualities(track, qualityList.value[track.source]) : []
})
// 自动挡：跨音源择优，不依赖「当前音源」是否提供该平台；未声明音质时按 128k 兜底，
// 保证自动挡在任何音源配置下都可用。
const autoQuality = computed<LX.Quality | null>(() => {
  if (!appSetting['download.isAutoQuality']) return null
  const track = onlineTrack.value
  return track ? bestTrackQuality(track, qualityList.value[track.source]) ?? '128k' : null
})
const audioInfo = computed(() => {
  const file = activePlaybackResource.value && activePlaybackResource.value.trackId === playMusicInfo.musicInfo?.id ? activePlaybackResource.value.local : Boolean(playMusicInfo.musicInfo && 'metadata' in playMusicInfo.musicInfo) || props.track?.source === 'local'
  const stream = !file && activeStream.value?.trackId === playMusicInfo.musicInfo?.id ? activeStream.value : null
  const source = stream?.musicInfo.source ?? props.track?.source
  const names: Record<string, string> = { netease: '网易云音乐', qq: 'QQ 音乐', kugou: '酷狗音乐', kuwo: '酷我音乐', migu: '咪咕音乐', bilibili: '哔哩哔哩', qishui: '汽水音乐', bodian: '波点音乐' }
  return [
    { label: '歌曲', value: props.track?.name ?? '尚未播放' },
    { label: '歌手', value: props.track?.singer ?? '未知歌手' },
    { label: '音源平台', value: file ? '本地文件' : stream ? names[stream.platform] ?? stream.platform : source && source !== 'local' ? platformSourceLabels[source] : '—' },
    { label: '音频品质', value: stream ? stream.qualityLabel ?? qualityLabels[stream.quality ?? stream.type] : '音源未提供' },
    { label: '比特率', value: stream?.bitrate ? `${Math.round(stream.bitrate > 1000 ? stream.bitrate / 1000 : stream.bitrate)} kbps` : '音源未提供' },
    { label: '采样率', value: stream?.sampleRate ? `${Number((stream.sampleRate / 1000).toFixed(1))} kHz` : '音源未提供' },
    { label: '位深', value: stream?.bitDepth ? `${stream.bitDepth} bit` : '音源未提供' },
    { label: '资源类型', value: file ? '本地文件' : stream?.isTrial ? '平台试听' : stream ? '完整歌曲' : '—' },
  ]
})

function formatRate(rate: number): string { return Number(rate.toFixed(2)).toString() }
function formatTime(seconds: number | null): string {
  if (seconds === null) return '--:--'
  const time = Math.max(0, Math.floor(seconds))
  return `${Math.floor(time / 60).toString().padStart(2, '0')}:${(time % 60).toString().padStart(2, '0')}`
}
function gainLabel(gain: number): string { return gain > 0 ? `+${gain}` : String(gain) }
function close(): void { open.value = false }
function back(): void { if (page.value === 'home') close(); else void navigate('home') }
function backKey(event: KeyboardEvent): void { if (event.target instanceof HTMLInputElement) return; event.preventDefault(); back() }
async function navigate(next: MenuPage): Promise<void> {
  page.value = next
  if (next === 'device') void refreshDevices()
  await nextTick()
  if (open.value) document.getElementById(panelId)?.querySelector<HTMLElement>('.ui-full-more-content')?.focus()
}
function focusPage(): void {
  if (open.value) document.getElementById(panelId)?.querySelector<HTMLButtonElement>('.ui-full-more-content button:not(:disabled)')?.focus()
}
async function run(action: () => Promise<void>, success?: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  try { await action(); if (success) emit('notice', success) } catch (error) { emit('notice', error instanceof Error ? error.message : '操作失败，请稍后重试。') } finally { busy.value = false }
}
function changeRate(rate: number): void { window.app_event.setPlaybackRate(rate) }
async function savePatch(patch: Partial<LX.AppSetting>): Promise<void> { await updateSetting(patch); mergeSetting(patch) }
function saveBoolean(key: 'player.preservesPitch' | 'player.waitPlayEndStop', event: Event): void { void run(async() => { await savePatch({ [key]: (event.target as HTMLInputElement).checked }) }) }
async function ensureDefaultDevice(): Promise<void> {
  if (appSetting['player.mediaDeviceId'] === 'default') return
  await setMediaDeviceId('default')
  await savePatch({ 'player.mediaDeviceId': 'default' })
}
function previewBand(frequency: typeof freqs[number], gain: number): void {
  if (appSetting['player.mediaDeviceId'] !== 'default') return
  previewEqualizerBand(frequency, gain)
}
function saveBand(frequency: typeof freqs[number], gain: number): void {
  void run(async() => { await ensureDefaultDevice(); await saveEqualizerBand(frequency, gain) })
}
function previewPitch(semitones: number): void {
  if (appSetting['player.mediaDeviceId'] === 'default') mergeSetting({ 'player.soundEffect.pitchShifter.playbackRate': 2 ** (semitones / 12) })
}
function savePitch(semitones: number): void { void run(async() => { await ensureDefaultDevice(); await savePatch({ 'player.soundEffect.pitchShifter.playbackRate': 2 ** (semitones / 12) }) }) }
function applyPreset(preset: typeof freqsPreset[number] | null): void {
  void run(async() => {
    await ensureDefaultDevice()
    await applyEqualizerPreset(preset)
  })
}
function toggleEqualizer(event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked
  void run(async() => {
    if (enabled) await ensureDefaultDevice()
    await setEqualizerEnabled(enabled)
  })
}
function changePresentation(key: 'immersive' | 'spectrum' | 'autoCenterCover', event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked
  void run(async() => { if (key === 'spectrum' && enabled) await ensureDefaultDevice(); patchPlayerPresentation({ [key]: enabled }) })
}
function abValue(point: 'a' | 'b'): number | null { return point === 'a' ? playerSessionTools.abStart : playerSessionTools.abEnd }
function clearPoint(point: 'a' | 'b'): void { playerSessionTools.abEnabled = false; if (point === 'a') playerSessionTools.abStart = null; else playerSessionTools.abEnd = null }
function adjustPoint(point: 'a' | 'b', delta: number): void { const value = abValue(point); if (value === null) return; try { setABPoint(point, Math.max(0, value + delta)) } catch (error) { emit('notice', error instanceof Error ? error.message : '无法调整循环点。') } }
function markPoint(point: 'a' | 'b'): void {
  try { setABPoint(point) } catch (error) { emit('notice', error instanceof Error ? error.message : '无法设置循环点。') }
}
function toggleAB(): void { try { setABEnabled(!playerSessionTools.abEnabled) } catch (error) { emit('notice', error instanceof Error ? error.message : '无法开始片段循环。') } }
function startTimer(minutes: number): void {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) { emit('notice', '请输入 1 到 180 分钟'); return }
  try { startSleepTimer(minutes); emit('notice', `将在 ${minutes} 分钟后暂停音乐`) } catch (error) { emit('notice', error instanceof Error ? error.message : '无法启动定时暂停。') }
}
function editCustomMinutes(event: Event): void { customMinutes.value = Number((event.target as HTMLInputElement).value) }
function cancelTimer(): void { cancelSleepTimer(); emit('notice', '已取消定时暂停') }
function chooseSource(source: PreferredPlatformSource): void { void run(async() => { await setPreferredSource(source) }, `首选音源：${preferredSourceOptions.value.find(option => option.value === source)?.label ?? source}`) }
let deviceGeneration = 0
async function refreshDevices(): Promise<void> {
  const generation = ++deviceGeneration
  loadingDevices.value = true
  deviceError.value = ''
  try {
    const result = await navigator.mediaDevices?.enumerateDevices()
    if (generation !== deviceGeneration) return
    devices.value = (result ?? []).filter(device => device.kind === 'audiooutput' && device.deviceId !== 'default')
    if (!devices.value.length) deviceError.value = '未发现其他输出设备，可使用系统默认设备。'
  } catch { if (generation === deviceGeneration) deviceError.value = '暂时无法读取输出设备，请重试。' } finally { if (generation === deviceGeneration) loadingDevices.value = false }
}
function deviceChanged(): void { if (open.value && page.value === 'device') void refreshDevices() }
function chooseDevice(deviceId: string): void {
  void run(async() => {
    if (deviceId !== 'default' && hasInitedAdvancedAudioFeatures()) throw new Error('均衡器或音频频谱已启用，当前使用系统默认输出。重新启动应用后可切换输出设备。')
    await setMediaDeviceId(deviceId)
    await savePatch({ 'player.mediaDeviceId': deviceId })
  }, '输出设备已切换')
}
function addTrack(): void { if (!props.track) return; actionTrack.value = props.track; close(); addOpen.value = true }
function shareTrack(): void {
  const track = props.track
  if (!track) return
  try {
    const url = track.source === 'local' ? '' : musicSdk[track.source]?.getMusicDetailPageUrl?.(toOldMusicInfo(track))
    const validUrl = typeof url === 'string' && /^https?:\/\//.test(url) ? url : ''
    clipboardWriteText([`${track.name} - ${track.singer}`, validUrl].filter(Boolean).join('\n'))
    emit('notice', validUrl ? '歌曲信息和平台链接已复制' : '歌曲信息已复制')
    close()
  } catch { emit('notice', '暂时无法复制歌曲信息，请重试。') }
}
function downloadTrack(quality: LX.Quality, autoQuality = false): void {
  const track = onlineTrack.value
  if (!track) return
  void run(async() => {
    await getDownloadList()
    if (!appSetting['download.enable']) await savePatch({ 'download.enable': true })
    await createDownloadTasks([track], quality, undefined, autoQuality)
    close()
  }, '已加入下载队列')
}
function downloadTrackAuto(): void {
  const quality = autoQuality.value
  if (!quality) return
  downloadTrack(quality, true)
}
watch(open, show => {
  if (show) page.value = 'home'
  else { deviceGeneration++; loadingDevices.value = false }
})
watch(() => props.track?.id, close)
watch([open, page], ([show, next]) => {
  navigator.mediaDevices?.removeEventListener('devicechange', deviceChanged)
  if (show && next === 'device') navigator.mediaDevices?.addEventListener('devicechange', deviceChanged)
})
onBeforeUnmount(() => { deviceGeneration++; navigator.mediaDevices?.removeEventListener('devicechange', deviceChanged) })
</script>

<style lang="less">
.ui-full-more { display: flex; align-items: center; }
.ui-full-more-popover { z-index: 2100 !important; .ui-player-popover-content { padding: 8px; } }
.ui-full-more-content { color: var(--modern-text); overflow: hidden; outline: none; }
.ui-full-more-items { display: flex; flex-direction: column; gap: 2px; > button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; border: 0; border-radius: 9px; background: transparent; color: var(--modern-text); cursor: pointer; text-align: left; font: inherit; font-size: 13px; transition: background .15s; &:hover, &:focus-visible { background: var(--modern-hover); } &:disabled { opacity: .4; cursor: default; } > span { flex: 1; } > small { color: var(--modern-muted); font-size: 11px; } > .ui-svg-icon:last-child:not(:first-child) { width: 16px; height: 16px; color: var(--modern-muted); } &[aria-pressed="true"] { color: var(--modern-accent-ink); } } }
.ui-full-more-back { display: flex; align-items: center; gap: 6px; margin: 0 0 12px; padding: 5px 7px; border: 0; border-radius: 7px; background: transparent; color: var(--modern-muted); cursor: pointer; font: inherit; font-size: 12px; &:hover { color: var(--modern-text); background: var(--modern-hover); } .ui-svg-icon { width: 15px; height: 15px; } }
.ui-full-more-divider { height: 1px; margin: 6px 8px; background: var(--modern-border); }
.ui-full-more-note { margin: 4px 8px 12px; color: var(--modern-muted); font-size: 12px; line-height: 1.7; }
.ui-full-choice-grid { display: flex; flex-wrap: wrap; gap: 7px; button { flex: 1; min-width: 68px; padding: 9px 8px; border: 1px solid var(--modern-border); border-radius: 8px; background: var(--modern-panel); color: var(--modern-text); font: inherit; font-size: 12px; cursor: pointer; &:hover { background: var(--modern-hover); } &.is-selected { border-color: var(--modern-accent-ink); background: var(--modern-accent-soft); color: var(--modern-accent-ink); } } }
.ui-full-more-switch { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 2px; color: var(--modern-text); font-size: 12px; input { accent-color: var(--modern-accent-ink); cursor: pointer; width: 16px; height: 16px; flex: none; } }
.ui-full-audio-info { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px 18px; padding: 4px 8px 12px; font-size: 12px; dt { color: var(--modern-muted); } dd { margin: 0; overflow-wrap: anywhere; text-align: right; line-height: 1.6; } }
.ui-full-speed { padding: 0 8px; > strong { display: block; margin: 6px 0 22px; text-align: center; font-size: 38px; font-weight: 500; font-variant-numeric: tabular-nums; small { margin-left: 5px; font-size: 20px; color: var(--modern-muted); } } > .ui-range { width: 100%; margin-bottom: 18px; } }
.ui-full-pitch { padding: 12px 0 6px; border-top: 1px solid var(--modern-border); label { display: flex; justify-content: space-between; margin-bottom: 14px; font-size: 12px; strong { font-weight: 400; color: var(--modern-muted); } } > .ui-range { width: 100%; } button { display: block; margin: 10px auto 0; padding: 5px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--modern-muted); font: inherit; font-size: 11px; cursor: pointer; &:hover { background: var(--modern-hover); } } }
.ui-full-appearance { padding: 0 8px; h3 { margin: 18px 0 10px; font-size: 12px; font-weight: 500; color: var(--modern-muted); } }
.ui-full-eq-presets { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 8px; button { border: 0; border-radius: 6px; padding: 6px 10px; background: var(--modern-hover); color: var(--modern-text); font: inherit; font-size: 11px; cursor: pointer; &:hover { background: var(--modern-accent-soft); color: var(--modern-accent-ink); } } }
.ui-full-eq-bands { display: flex; justify-content: space-around; padding: 22px 0 18px; gap: 2px; overflow-x: auto; > label { display: flex; flex-direction: column; align-items: center; gap: 10px; min-width: 26px; font-size: 10px; color: var(--modern-muted); output { color: var(--modern-text); font-variant-numeric: tabular-nums; } } input.ui-range.ui-range-vertical { height: 132px; } }
.ui-full-ab, .ui-full-sleep { padding: 0 8px 8px; }
.ui-full-ab-adjust { display: flex; align-items: center; gap: 8px; margin: 10px 0; font-size: 12px; > span { color: var(--modern-muted); width: 20px; } button { flex: 1; border: 1px solid var(--modern-border); border-radius: 6px; padding: 6px; background: var(--modern-panel); color: var(--modern-text); cursor: pointer; &:disabled { opacity: .4; } } }
.ui-full-ab-points { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; button { display: flex; flex-direction: column; gap: 8px; padding: 14px 8px; border: 1px solid var(--modern-border); border-radius: 10px; background: var(--modern-panel); color: var(--modern-text); cursor: pointer; font: inherit; &:hover { background: var(--modern-hover); } &:disabled { opacity: .4; cursor: default; } small, span { font-size: 11px; color: var(--modern-muted); } strong { font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; } } }
.ui-full-more-primary, .ui-full-more-secondary { display: block; width: 100%; border: 0; border-radius: 8px; padding: 10px; font: inherit; font-size: 12px; cursor: pointer; &:disabled { opacity: .4; cursor: default; } }
.ui-full-more-primary { background: var(--modern-accent-soft); color: var(--modern-accent-ink); }
.ui-full-more-secondary { margin-top: 8px; background: transparent; color: var(--modern-muted); &:hover { background: var(--modern-hover); } }
.ui-full-sleep-countdown { margin: 10px 0 18px; text-align: center; font-size: 17px; color: var(--modern-accent-ink); font-variant-numeric: tabular-nums; }
.ui-full-sleep-custom { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 12px; input { width: 0; min-width: 0; flex: 1; border: 1px solid var(--modern-border); border-radius: 8px; padding: 8px 10px; background: var(--modern-panel); color: var(--modern-text); font: inherit; } button { padding: 8px 12px; border: 0; border-radius: 8px; background: var(--modern-accent-soft); color: var(--modern-accent-ink); font: inherit; cursor: pointer; } }
.ui-full-download-location { margin-top: 14px; overflow-wrap: anywhere; }
.ui-full-more-items button.ui-full-more-auto { border: 1px solid color-mix(in srgb, var(--modern-accent) 45%, var(--modern-border)); color: var(--modern-accent-ink); > span small { display: block; margin-top: 2px; color: var(--modern-muted); font-size: 11px; } }
.ui-full-menu-page-enter-active, .ui-full-menu-page-leave-active { transition: opacity .12s ease, transform .12s ease; }
.ui-full-menu-page-enter-from { opacity: 0; transform: translateX(9px); }
.ui-full-menu-page-leave-to { opacity: 0; transform: translateX(-9px); }
@media (prefers-reduced-motion: reduce) { .ui-full-menu-page-enter-active, .ui-full-menu-page-leave-active { transition: none; } }
</style>
