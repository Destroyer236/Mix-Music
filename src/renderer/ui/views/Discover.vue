<template>
  <div class="ui-page ui-discover ui-recommend-page ui-qq-recommend">
    <header class="qq-recommend-heading"><h1>Hi，今日为你推荐</h1><router-link to="/list?id=love">我的喜欢 <UiIcon name="chevronRight" /></router-link></header>
    <div v-if="message" class="ui-inline-message" role="status"><span>{{ message }}</span><button type="button" aria-label="关闭提示" @click="message = ''"><UiIcon name="close" /></button></div>
    <section class="qq-recommend-selection" aria-label="今日音乐推荐">
      <div ref="selection" class="qq-recommend-rail">
        <article class="qq-personal-card">
          <div class="qq-personal-art"><div class="qq-personal-copy"><h2>{{ greeting }}</h2><p>{{ selectedArtist ? '熟悉的声音，' : '给此刻一点音乐，' }}<br>{{ selectedArtist ? '也有新的心动。' : '让心情慢慢放松。' }}</p><button type="button" class="qq-green-play" :disabled="!featured" :aria-label="featured ? (featuredPlaying ? '暂停 ' : '播放 ') + featured.name : '推荐歌曲加载中'" @click="toggleFeatured"><UiIcon :name="featuredPlaying ? 'pause' : 'play'" filled /></button></div><div class="qq-personal-record"><span aria-hidden="true" /><TrackArtwork :track="featured" :alt="featured?.name || '推荐歌曲封面'" /></div></div>
          <button type="button" class="qq-card-title" :disabled="!featured" @click="toggleFeatured">{{ featured ? featured.name + ' · ' + featured.singer : '正在寻找好音乐…' }}</button><p class="qq-card-caption">{{ source === 'all' ? '猜你喜欢 · 全平台推荐' : discoveries.length ? '猜你喜欢 · 发现熟悉与新的声音' : '猜你喜欢 · 今日热播' }}</p>
        </article>
        <article v-for="(item, index) in playlists.slice(0, favoriteTracks.length ? 2 : 3)" :key="item.source + ':' + item.id" class="qq-square-card">
          <div class="qq-square-art"><button type="button" class="qq-card-open" :aria-label="'查看歌单 ' + item.name" @click="openPlaylist(item)"><TrackArtwork :src="item.img" :alt="item.name" /><span class="qq-card-ribbon" :class="'tone-' + index">{{ ['Daily picks', 'Discover', 'For you'][index] }}</span></button><button type="button" class="qq-card-play" :aria-label="'播放歌单 ' + item.name" @click="openPlaylist(item, true)"><UiIcon name="play" filled /></button></div>
          <button type="button" class="qq-card-title" :title="item.name" @click="openPlaylist(item)">{{ item.name }}</button><p class="qq-card-caption">{{ index === 0 ? '今日精选' : '发现好歌单' }} · {{ sourceNames[item.source] }}</p>
        </article>
        <template v-if="!playlists.length">
          <article v-for="slot in (favoriteTracks.length ? 2 : 3)" :key="'pending-' + slot" class="qq-square-card qq-pending-card" :aria-busy="playlistLoading" :aria-label="playlistLoading ? '精选歌单加载中' : '精选歌单暂未加载'">
            <template v-if="playlistLoading"><div class="qq-square-art qq-skeleton-block" aria-hidden="true" /><div class="qq-skeleton-line" aria-hidden="true" /><div class="qq-skeleton-line is-short" aria-hidden="true" /><span v-if="slot === 1" class="qq-sr-only" role="status">正在加载精选歌单…</span></template>
            <template v-else><div class="qq-square-art qq-pending-error"><UiIcon name="music" /><span>{{ playlistError ? '歌单暂时无法加载' : '暂无精选歌单' }}</span><button v-if="slot === 1" type="button" @click="loadPlaylists">重新加载</button></div><p class="qq-card-caption">{{ playlistError ? '稍后重试，继续发现好音乐' : '换一个平台试试' }}</p></template>
          </article>
        </template>
        <article v-if="favoriteTracks.length" class="qq-square-card qq-favorites-card"><div class="qq-square-art"><router-link to="/list?id=love" class="qq-card-open" aria-label="查看我的喜欢"><TrackArtwork :track="favoriteTracks[0]" alt="我的喜欢" /><span class="qq-card-ribbon tone-favorite">Favorites</span></router-link><button type="button" class="qq-card-play" aria-label="播放我的喜欢" @click="playOne(favorites[0], favorites)"><UiIcon name="play" filled /></button></div><router-link to="/list?id=love" class="qq-card-title">我喜欢的音乐</router-link><p class="qq-card-caption">{{ favoriteTracks.length }} 首喜欢 · 再听一次心动</p></article>
      </div>
      <button type="button" class="qq-rail-next" aria-label="下一组精选歌单" :disabled="playlistLoading" @click="advanceSelection"><UiIcon name="chevronRight" /></button>
    </section>
    <section class="qq-song-section" aria-label="歌曲推荐">
      <div class="qq-song-heading"><div><h2>{{ source === 'all' ? '全平台，发现你的下一首喜欢' : discoveries.length ? '发现更多值得喜欢的音乐' : '这些好音乐，值得一听' }}</h2><button type="button" class="qq-play-all" aria-label="播放全部推荐" :disabled="!recommended.length" @click="playOne(recommended[0], recommended, true)"><UiIcon name="play" filled /></button></div><div class="qq-song-actions"><button type="button" aria-label="换一批推荐" :disabled="recommendationLoading" @click="retrySongs"><UiIcon name="refresh" />换一批</button><router-link :to="{ path: '/leaderboard', query: { source: source === 'all' ? undefined : source, boardId } }">更多好音乐 <UiIcon name="chevronRight" /></router-link></div></div>
      <div class="qq-recommend-filters"><div class="ui-recommend-sources" role="group" aria-label="推荐平台"><button type="button" :aria-pressed="source === 'all'" @click="selectSource('all')">全部</button><button v-for="item in sources" :key="item" type="button" :aria-pressed="source === item" @click="selectSource(item)">{{ sourceNames[item] }}</button></div></div>
      <RecommendationTracks v-if="recommended.length" :tracks="recommended" show-source @play="playOne($event, recommended, true)" />
      <RecommendationState v-else :loading="recommendationLoading" :error="recommendationError || trendingError || discoveryError" @retry="retrySongs" />
      <p v-if="recommended.length && recommendationError" class="qq-song-note" role="status">{{ recommendationError }}<button type="button" :disabled="recommendationLoading" @click="retrySongs">重新加载</button></p>
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
import { isPlay, playMusicInfo } from '@renderer/store/player/state'
import { togglePlay } from '@renderer/core/player'
import { favoriteTracks } from '../services/platformAccounts'
import UiIcon from '../components/UiIcon.vue'
import TrackArtwork from '../components/TrackArtwork.vue'
import RecommendationState from '../components/RecommendationState.vue'
import RecommendationTracks from '../components/RecommendationTracks.vue'
const router = useRouter()
const { loadSongs, recommendationLoading, recommendationError, sources, source, playlists, discoveries, recommended, boardId, selectedArtist, playlistLoading, playlistError, trendingError, discoveryError, selectSource, nextPlaylists, loadPlaylists } = useRecommendations()
const currentTrack = computed(() => { const track = playMusicInfo.musicInfo; return track && 'metadata' in track ? track.metadata.musicInfo : track })
const featured = computed(() => currentTrack.value ?? recommended.value[0] ?? null)
const featuredPlaying = computed(() => isPlay.value && sameTrack(featured.value, currentTrack.value))
const favorites = computed(() => favoriteTracks.value.slice(0, 9))
const greeting = useTimeGreeting()
const message = ref('')
const selection = ref<HTMLElement | null>(null)
function openPlaylist(item: ListInfoItem, play = false) { void router.push({ path: '/songList/detail', query: { source: item.source, id: item.id, name: item.name, picUrl: item.img, play: play ? 'true' : undefined } }) }
async function playOne(track: LX.Music.MusicInfo | null | undefined, list: LX.Music.MusicInfo[], continuous = false) { if (!track) return; message.value = ''; try { await playTracks(list, list.findIndex(item => sameTrack(item, track)), undefined, continuous ? source.value : undefined) } catch (err) { message.value = err instanceof Error ? err.message : '暂时无法播放，请稍后再试。' } }
function toggleFeatured() { if (currentTrack.value) togglePlay(); else void playOne(featured.value, recommended.value, true) }
function advanceSelection() { const rail = selection.value; if (rail && rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2) rail.scrollBy({ left: rail.clientWidth * 0.75, behavior: 'smooth' }); else { rail?.scrollTo({ left: 0 }); nextPlaylists() } }
function retrySongs() { void loadSongs() }
</script>
