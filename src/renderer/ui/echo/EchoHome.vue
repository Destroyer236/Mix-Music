<template>
  <div class="echo-home" @keyup.space.stop>
    <header class="echo-home-hero">
      <h1>Hi, {{ echoProfile ? echoProfile.nickname + ' ' : '' }}{{ greeting }}</h1>
      <p>由此开启好心情 ~</p>
    </header>

    <div v-if="message" class="ui-inline-message" role="status"><span>{{ message }}</span><button type="button" aria-label="关闭提示" @click="message = ''"><UiIcon name="close" /></button></div>

    <section class="echo-home-features" aria-label="快捷入口">
      <button type="button" class="echo-feature-card" :aria-label="`播放每日推荐（${recommended.length} 首）`" @click="playDaily()">
        <span class="echo-feature-block" aria-hidden="true"><b>{{ dayNumber }}</b></span>
        <div class="echo-feature-copy"><h2>每日推荐</h2><p>为你量身定制</p></div>
        <span class="echo-feature-action" :class="{ 'is-idle': !recommended.length || recommendationLoading }" aria-hidden="true"><UiIcon name="play" filled /></span>
      </button>
      <router-link class="echo-feature-card" :to="leaderboardLocation" aria-label="查看排行榜">
        <span class="echo-feature-block echo-feature-block--top" aria-hidden="true"><b>TOP</b></span>
        <div class="echo-feature-copy"><h2>排行榜</h2><p>实时热门趋势</p></div>
        <span class="echo-feature-action" aria-hidden="true"><UiIcon name="music" /></span>
      </router-link>
    </section>

    <section class="echo-home-section echo-home-section--style" aria-label="平台推荐">
      <div class="echo-home-panel">
        <header class="echo-home-panel-head">
          <h2 class="echo-home-panel-label">平台推荐</h2>
          <div class="echo-home-panel-tabs" role="group" aria-label="推荐平台">
            <button type="button" :class="{ 'is-active': source === 'all' }" :aria-pressed="source === 'all'" @click="selectSource('all')">全部</button>
            <button v-for="item in sources" :key="item" type="button" :class="{ 'is-active': source === item }" :aria-pressed="source === item" @click="selectSource(item)">{{ sourceNames[item] || item }}</button>
          </div>
          <button type="button" class="echo-home-playall" :disabled="!recommended.length" @click="playDaily()"><UiIcon name="play" filled />播放全部</button>
        </header>
        <div v-if="recommended.length" class="echo-song-grid">
          <article v-for="(track, index) in gridTracks" :key="track.source + ':' + track.id" class="echo-song-card">
            <button type="button" class="echo-song-card-play" :aria-label="`播放 ${track.name || '未命名歌曲'}`" @click="playOne(track)"><UiIcon name="play" filled /></button>
            <TrackArtwork :track="track" :alt="track.name || '推荐歌曲封面'" />
            <div class="echo-song-card-info">
              <button type="button" class="echo-song-card-name" :title="track.name" @click="playOne(track)">{{ track.name || '未命名歌曲' }}</button>
              <span class="echo-song-card-singer" :title="track.singer">{{ track.singer || '未知歌手' }}</span>
            </div>
            <span class="echo-song-card-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
          </article>
        </div>
        <RecommendationState v-else :loading="recommendationLoading" :error="recommendationError || trendingError || discoveryError" @retry="retrySongs" />
        <footer v-if="recommended.length" class="echo-home-panel-foot">
          <button type="button" :disabled="recommendationLoading" @click="retrySongs"><UiIcon name="refresh" />换一批</button>
          <router-link :to="leaderboardLocation">更多好音乐 <UiIcon name="chevronRight" /></router-link>
        </footer>
      </div>
    </section>

    <section class="echo-home-section" aria-label="推荐歌单">
      <header class="echo-home-section-head">
        <h2>推荐歌单</h2>
        <router-link to="/songList/list">更多歌单 <UiIcon name="chevronRight" /></router-link>
      </header>
      <div v-if="playlists.length" class="echo-playlist-grid">
        <article v-for="item in homePlaylists" :key="item.source + ':' + item.id" class="echo-playlist-card">
          <button type="button" class="echo-playlist-cover" :aria-label="`查看歌单 ${item.name}`" @click="openPlaylist(item)">
            <TrackArtwork :src="item.img" :alt="item.name" />
            <span class="echo-playlist-hover" aria-hidden="true"><UiIcon name="play" filled /></span>
          </button>
          <button type="button" class="echo-playlist-name" :title="item.name" @click="openPlaylist(item)">{{ item.name }}</button>
          <span class="echo-playlist-source">{{ sourceNames[item.source] || item.source }}</span>
        </article>
      </div>
      <RecommendationState v-else :loading="playlistLoading" :error="playlistError" @retry="loadPlaylists" />
    </section>

    <section v-if="favoriteTracks.length" class="echo-home-section" aria-label="我的喜欢">
      <header class="echo-home-section-head">
        <h2>我的喜欢</h2>
        <router-link to="/list?id=love">全部喜欢 <UiIcon name="chevronRight" /></router-link>
      </header>
      <div class="echo-song-grid">
        <article v-for="(track, index) in favoriteTracks.slice(0, 6)" :key="'love-' + track.source + ':' + track.id" class="echo-song-card">
          <button type="button" class="echo-song-card-play" :aria-label="`播放 ${track.name || '未命名歌曲'}`" @click="playOne(track, favoriteTracks)"><UiIcon name="play" filled /></button>
          <TrackArtwork :track="track" :alt="track.name || '喜欢歌曲封面'" />
          <div class="echo-song-card-info">
            <button type="button" class="echo-song-card-name" :title="track.name" @click="playOne(track, favoriteTracks)">{{ track.name || '未命名歌曲' }}</button>
            <span class="echo-song-card-singer" :title="track.singer">{{ track.singer || '未知歌手' }}</span>
          </div>
          <span class="echo-song-card-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { sourceNames } from '@renderer/store'
import type { ListInfoItem } from '@renderer/store/songList/state'
import { useRecommendations } from '../useRecommendations'
import { useTimeGreeting } from '../useTimeGreeting'
import { playTracks, sameTrack } from '../services/music'
import { favoriteTracks, platformSnapshot } from '../services/platformAccounts'
import UiIcon from '../components/UiIcon.vue'
import TrackArtwork from '../components/TrackArtwork.vue'
import RecommendationState from '../components/RecommendationState.vue'

const router = useRouter()
const { loadSongs, recommendationLoading, recommendationError, sources, source, playlists, recommended, boardId, playlistLoading, playlistError, trendingError, discoveryError, selectSource, loadPlaylists } = useRecommendations()
const greeting = useTimeGreeting()
const message = ref('')
const echoProfile = computed(() => {
  const account = platformSnapshot.value.accounts.find(item => item.connected && item.profile)
  return account?.profile ?? null
})

const now = new Date()
const dayNumber = now.getDate()
const gridTracks = computed(() => recommended.value.slice(0, 9))
const homePlaylists = computed(() => playlists.value.slice(0, 8))
const leaderboardLocation = computed(() => ({ path: '/leaderboard', query: { source: source.value === 'all' ? undefined : source.value, boardId: boardId.value } }))

async function playOne(track: LX.Music.MusicInfo | null | undefined, list: LX.Music.MusicInfo[] = recommended.value) {
  if (!track) return
  message.value = ''
  try {
    await playTracks(list, list.findIndex(item => sameTrack(item, track)), undefined, source.value)
  } catch (err) {
    message.value = err instanceof Error ? err.message : '暂时无法播放，请稍后再试。'
  }
}
function playDaily() { void playOne(recommended.value[0], recommended.value) }
function openPlaylist(item: ListInfoItem) {
  void router.push({ path: '/songList/detail', query: { source: item.source, id: item.id, name: item.name, picUrl: item.img } })
}
function retrySongs() { void loadSongs() }
</script>

<style lang="less">
// EchoMusic 主页复刻（对照 views/Home.vue 的数值）：
// 头部 22px/mb28；功能卡 72px 高、tone5% 底 + 1px 边框、图标块 44px/6px 渐变、
// 操作钮 30px/6px accent 12%；区块 mt36（平台推荐 mt30）；歌单卡网格 min180/gap20
.echo-home {
  height: 100%;
  overflow-y: auto;
  padding: 16px 40px 40px;
}
.echo-home-hero {
  margin-bottom: 28px;
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -.4px; }
  p { margin-top: 4px; font-size: 12px; color: var(--modern-muted); }
}
.echo-home-features {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}
// 整卡可点（对照 EchoMusic home-feature-card 的 Button）：button/router-link 复用
// 同一组卡片样式，需重置表单默认字体与链接下划线
.echo-feature-card {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 72px;
  padding: 0 18px;
  // EchoMusic 的 --content-panel-border 为 transparent：保留边框占位但不可见
  border: 1px solid transparent;
  border-radius: var(--echo-radius-card);
  background: color-mix(in srgb, var(--echo-content-tone) 5%, transparent);
  font: inherit;
  color: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: transform .12s var(--echo-motion-standard), background .2s;
  &:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--echo-content-tone) 7%, transparent); }
}
.echo-feature-block {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: var(--echo-radius-control);
  background: linear-gradient(135deg, var(--modern-accent), color-mix(in srgb, var(--modern-accent) 70%, transparent));
  color: #fff;
  b { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
  &--top b { letter-spacing: .5px; }
}
.echo-feature-copy {
  flex: 1;
  min-width: 0;
  h2 { font-size: 14px; font-weight: 600; }
  p { margin-top: 2px; font-size: 12px; font-weight: 500; color: var(--modern-muted); }
}
.echo-feature-action {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--echo-radius-control);
  background: color-mix(in srgb, var(--modern-accent) 12%, transparent);
  color: var(--modern-accent-ink);
  cursor: pointer;
  svg { width: 14px; height: 14px; }
  &:hover { background: color-mix(in srgb, var(--modern-accent) 18%, transparent); }
  &.is-idle { opacity: .45; }
}
.echo-home-section { margin-top: 36px; }
.echo-home-section--style { margin-top: 30px; }
.echo-home-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  h2 { font-size: 15px; font-weight: 600; }
  a { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--modern-muted); &:hover { color: var(--modern-text); } svg { width: 12px; height: 12px; } }
}
.echo-home-panel {
  padding: 14px;
  // 对照 EchoMusic .style-recommend-panel：border 结构保留，--content-panel-border 为透明
  border: 1px solid transparent;
  border-radius: var(--echo-radius-card);
  background: color-mix(in srgb, var(--echo-content-tone) 5%, transparent);
}
.echo-home-panel-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.echo-home-panel-label {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--modern-muted);
}
// 对照 EchoMusic .style-tag-row：单行横向滚动 + 隐藏滚动条；
// 上下 padding + 负 margin 留出裁剪余量，保证激活底色永不被裁
.echo-home-panel-tabs {
  display: flex;
  flex: 1;
  // EchoMusic .style-tag-row 是左对齐：宽窗下标签群跟住左侧标题，
  // 播放全部由 panel-head 的最右一列承担，避免中部大片留白
  justify-content: flex-start;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  // 水平余量 12px > 圆角 6px：滚动容器裁剪边永远不会削到激活底色的圆角
  padding: 6px 12px;
  margin: -6px -12px;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
  button {
    flex: none;
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--echo-radius-control);
    background: transparent;
    color: var(--modern-muted);
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
    &:hover { background: color-mix(in srgb, var(--echo-content-tone) 6%, transparent); color: var(--modern-text); }
    // 对照 EchoMusic .style-tag-btn.active：accent 12% 底 + primary-text 字色
    &.is-active { background: color-mix(in srgb, var(--modern-accent) 12%, transparent); color: var(--modern-accent-ink); font-weight: 600; }
  }
}
.echo-home-playall {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--echo-radius-control);
  background: color-mix(in srgb, var(--modern-accent) 12%, transparent);
  color: var(--modern-accent-ink);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  svg { width: 13px; height: 13px; }
  &:hover { background: color-mix(in srgb, var(--modern-accent) 18%, transparent); }
  &:disabled { cursor: default; opacity: .45; }
}
.echo-song-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px 12px;
}
.echo-song-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: var(--echo-row-height);
  padding: 8px 10px;
  border-radius: var(--echo-radius-control);
  background: transparent;
  transition: background .15s var(--echo-motion-enter);
  &:hover { background: color-mix(in srgb, var(--echo-content-tone) 6%, transparent); }
  .ui-track-artwork {
    width: 46px;
    height: 46px;
    flex: none;
    border-radius: var(--echo-radius-control);
    overflow: hidden;
  }
}
.echo-song-card-play {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translate(-4px, -50%) scale(.9);
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 0;
  border-radius: var(--echo-radius-control);
  background: rgba(15, 18, 23, .38);
  color: #fff;
  opacity: 0;
  cursor: pointer;
  transition: opacity .15s, transform .15s var(--echo-motion-enter);
  svg { width: 18px; height: 18px; }
  .echo-song-card:hover & { opacity: 1; transform: translate(0, -50%) scale(1); }
  &:focus-visible { opacity: 1; }
}
.echo-song-card-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
  .echo-song-card-name {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--modern-text);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
    &:hover { color: var(--modern-accent-ink); }
  }
  .echo-song-card-singer { font-size: 11px; color: var(--modern-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
}
.echo-song-card-index {
  flex: none;
  font-size: 11px;
  color: color-mix(in srgb, var(--echo-content-tone) 30%, transparent);
  font-variant-numeric: tabular-nums;
}
.echo-home-panel-foot {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  margin-top: 12px;
  button, a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--modern-muted);
    font-size: 11px;
    cursor: pointer;
    svg { width: 12px; height: 12px; }
    &:hover { color: var(--modern-text); }
  }
}
// 推荐歌单：EchoMusic PlaylistCard（p-10px / rounded-card / 封面 shadow-cover / hover 上浮）
.echo-playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 20px;
}
// 对照 PlaylistCard.vue .card-container：默认 tone5% 底 + 1px 透明描边，
// hover 仅上浮（.card-hover），底色与描边不变——深色下即「浮起的卡片」
.echo-playlist-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: var(--echo-radius-card);
  background: color-mix(in srgb, var(--echo-content-tone) 5%, transparent);
  transition: transform .18s var(--echo-motion-standard);
  &:hover { transform: translateY(-1px); }
}
.echo-playlist-cover {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: var(--echo-radius-control);
  overflow: hidden;
  background: color-mix(in srgb, var(--echo-content-tone) 5%, transparent);
  cursor: pointer;
  box-shadow: var(--echo-shadow-card);
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
}
.echo-playlist-hover {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(15, 18, 23, .32);
  color: #fff;
  opacity: 0;
  transition: opacity .18s var(--echo-motion-enter);
  svg { width: 26px; height: 26px; }
  .echo-playlist-card:hover & { opacity: 1; }
}
.echo-playlist-name {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--modern-text);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
  &:hover { color: var(--modern-accent-ink); }
}
.echo-playlist-source { margin-top: 2px; font-size: 11px; font-weight: 600; color: var(--modern-muted); }
@media (max-width: 900px) {
  .echo-home { padding: 16px 24px 32px; }
  .echo-home-features { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .echo-song-card, .echo-song-card-play, .echo-playlist-hover, .echo-feature-card, .echo-feature-action, .echo-playlist-card, .echo-playlist-cover { transition: none; }
}
</style>
