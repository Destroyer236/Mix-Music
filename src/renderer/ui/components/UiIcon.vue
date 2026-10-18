<template>
  <svg class="ui-svg-icon" :style="name === 'heart' && filled ? { color: 'var(--ui-favorite, #e54d65)' } : undefined" viewBox="0 0 24 24" width="20" height="20" :fill="filled ? 'currentColor' : 'none'" stroke="currentColor" :stroke-width="filled ? 0 : 1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use v-if="symbols[name]" :href="symbols[name]" /><path v-else :d="paths[name] || paths.music" /></svg>
</template>
<script setup>
import '@renderer/assets/svgs/lucide-folder-open.svg'
import '@renderer/assets/svgs/lucide-image-plus.svg'
import '@renderer/assets/svgs/lucide-check.svg'
import '@renderer/assets/svgs/lucide-search.svg'
import '@renderer/assets/svgs/lucide-chevron-down.svg'
import '@renderer/assets/svgs/lucide-arrow-right.svg'
import '@renderer/assets/svgs/lucide-repeat-2.svg'
import '@renderer/assets/svgs/lucide-repeat-1.svg'
import '@renderer/assets/svgs/lucide-shuffle.svg'
import '@renderer/assets/svgs/lucide-list-music.svg'
import '@renderer/assets/svgs/lucide-list-ordered.svg'
import '@renderer/assets/svgs/lucide-skip-back.svg'
import '@renderer/assets/svgs/lucide-skip-forward.svg'
import '@renderer/assets/svgs/lucide-captions.svg'
import '@renderer/assets/svgs/lucide-audio-lines.svg'
import '@renderer/assets/svgs/lucide-volume-2.svg'
import '@renderer/assets/svgs/lucide-volume-x.svg'
import '@renderer/assets/svgs/lucide-heart.svg'
import '@renderer/assets/svgs/lucide-play.svg'
import '@renderer/assets/svgs/lucide-pause.svg'
import '@renderer/assets/svgs/lucide-settings.svg'
import '@renderer/assets/svgs/lucide-palette.svg'
import '@renderer/assets/svgs/lucide-clock.svg'
import '@renderer/assets/svgs/lucide-message-circle-more.svg'
import '@renderer/assets/svgs/lucide-circle-ellipsis.svg'
import '@renderer/assets/svgs/lucide-languages.svg'
import '@renderer/assets/svgs/lucide-smile.svg'
import '@renderer/assets/svgs/lucide-headphones.svg'
import '@renderer/assets/svgs/lucide-calendar-days.svg'
import '@renderer/assets/svgs/lucide-sparkles.svg'
import '@renderer/assets/svgs/lucide-mic-vocal.svg'
import '@renderer/assets/svgs/lucide-disc-3.svg'
import '@renderer/assets/svgs/lucide-shapes.svg'
// Local Lucide SVG geometry; ISC/MIT notice ships in static/licenses/lucide.txt.
const symbols = { folderOpen: '#icon-lucide-folder-open', imagePlus: '#icon-lucide-image-plus', check: '#icon-lucide-check', search: '#icon-lucide-search', chevronDown: '#icon-lucide-chevron-down', arrowRight: '#icon-lucide-arrow-right', languages: '#icon-lucide-languages', smile: '#icon-lucide-smile', headphones: '#icon-lucide-headphones', calendarDays: '#icon-lucide-calendar-days', sparkles: '#icon-lucide-sparkles', micVocal: '#icon-lucide-mic-vocal', disc: '#icon-lucide-disc-3', shapes: '#icon-lucide-shapes', comment: '#icon-lucide-message-circle-more', moreCircle: '#icon-lucide-circle-ellipsis', repeat: '#icon-lucide-repeat-2', repeatOne: '#icon-lucide-repeat-1', shuffle: '#icon-lucide-shuffle', listPlay: '#icon-lucide-list-ordered', prev: '#icon-lucide-skip-back', next: '#icon-lucide-skip-forward', queue: '#icon-lucide-list-music', lyric: '#icon-lucide-captions', quality: '#icon-lucide-audio-lines', volume: '#icon-lucide-volume-2', mute: '#icon-lucide-volume-x', heart: '#icon-lucide-heart', play: '#icon-lucide-play', pause: '#icon-lucide-pause', gear: '#icon-lucide-settings', palette: '#icon-lucide-palette', clock: '#icon-lucide-clock' }

defineProps({ name: { type: String, default: 'music' }, filled: { type: Boolean, default: false } })
const paths = {
  lyricWheel: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M19.8 7.5l-5.2 3M12 15v6M9.4 10.5l-5.2-3',
  heartPulse: 'M20 13c5-6-2-13-8-7-6-6-13 1-8 7l8 8 5-5M3 12h5l2-4 4 8 2-4h5',
  alertCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v6m0 4h.01',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18',
  album: 'M4 4h16v16H4ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 12h.01',
  share: 'M12 16V3m-4 4 4-4 4 4M6 11H4v10h16V11h-2',
  copy: 'M8 8h12v13H8ZM16 8V3H3v13h5',
  music: 'M9 18V5l11-2v13M9 8l11-2M9 18c0 3-6 3-6 0s6-3 6 0m11-2c0 3-6 3-6 0s6-3 6 0',
  discover: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  list: 'M5 5h14M5 12h14M5 19h9',
  chart: 'M5 20V12m7 8V4m7 16V8',
  library: 'M4 4h5v16H4ZM13 4l5-1 4 16-5 1Z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  cloudDownload: 'M7 16H6a4 4 0 0 1-.5-7.97A6.5 6.5 0 0 1 18 7.5a4.25 4.25 0 0 1 .5 8.47H17M12 11v10m-4-4 4 4 4-4',
  connectionError: 'M12 3 2 21h20ZM12 9v5m0 3h.01',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  back: 'm14 5-7 7 7 7',
  close: 'm6 6 12 12M6 18 18 6',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z',
  next: 'M19 5v14M5 5l11 7L5 19Z',
  plus: 'M12 4v16M4 12h16',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  maximize: 'M4 4h16v16H4Z',
  restore: 'M8 8V4h12v12h-4M4 8h12v12H4Z',
  minimize: 'M5 12h14',
  arrowUp: 'M12 20V4m-6 6 6-6 6 6',
  arrowRight: 'M4 12h16m-6-6 6 6-6 6',
  arrowUpRight: 'M6 18 18 6M6 6h12v12',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  check: 'm5 12 4 4L19 6',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  minusCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 12h8',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5',
  folder: 'M3 7V5h7l2 2h9v13H3Z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 3v5h-5',
  focus: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  enter: 'M19 4v9H5m5-5-5 5 5 5',
  pin: 'M9 3h6l-1 6 4 4v2H6v-2l4-4ZM12 15v7',
  horizontal: 'M3 12h18m-4-4 4 4-4 4M7 8l-4 4 4 4',
  vertical: 'M12 3v18m-4-4 4 4 4-4M8 7l4-4 4 4',
  fontMinus: 'm3 19 5-14 5 14M5 14h6m5-2h6',
  fontPlus: 'm2 19 5-14 5 14M4 14h6m5-2h7m-3.5-3.5v7',
  lock: 'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3',
}
</script>
<style scoped>
.ui-svg-icon { display: block; flex-shrink: 0; }
</style>
