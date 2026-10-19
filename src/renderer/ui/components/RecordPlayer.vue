<template>
  <div class="ui-record-player" :class="{ 'is-playing': playing }">
    <div class="ui-record-platter">
      <div class="ui-record-disc">
        <div class="ui-record-label"><TrackArtwork :track="track" :src="src" :alt="alt" @loaded="imageLoaded" /></div>
        <span class="ui-record-spindle" aria-hidden="true" />
      </div>
    </div>
    <svg class="ui-record-arm" viewBox="0 0 100 360" fill="none" aria-hidden="true">
      <defs><linearGradient id="linkline-tonearm-metal" x1="39" y1="0" x2="61" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#454849" /><stop offset=".42" stop-color="#d4d5d3" /><stop offset=".65" stop-color="#818685" /><stop offset="1" stop-color="#343737" /></linearGradient></defs>
      <path d="M54 44V230c0 30-6 47-21 66l-13 16" stroke="#000" stroke-opacity=".45" stroke-width="13" transform="translate(4 3)" />
      <path d="M54 44V230c0 30-6 47-21 66l-13 16" stroke="url(#linkline-tonearm-metal)" stroke-width="8" />
      <path d="M52 45V229c0 28-6 47-21 65" stroke="#d9d9d5" stroke-opacity=".48" stroke-width="1.4" />
      <rect x="41" y="3" width="26" height="28" rx="3" fill="url(#linkline-tonearm-metal)" />
      <rect x="50" width="8" height="8" rx="1" fill="#8c908f" />
      <circle cx="54" cy="58" r="27" fill="#090b0b" stroke="#2e3130" stroke-width="2" />
      <circle cx="54" cy="58" r="17" fill="#252827" stroke="#373b39" />
      <circle cx="54" cy="58" r="8" fill="#141716" />
      <rect x="2" y="300" width="21" height="42" rx="7" fill="#262a28" stroke="#454943" transform="rotate(36 13 321)" />
      <path d="m9 339-4 6" stroke="#aaa" stroke-width="2" />
      <circle cx="13" cy="317" r="3" fill="#101311" />
    </svg>
    <span class="ui-record-indicator" aria-hidden="true"><i /></span>
  </div>
</template>
<script setup>
import TrackArtwork from './TrackArtwork.vue'
defineProps({ track: { type: Object, default: null }, src: { type: String, default: null }, alt: { type: String, required: true }, playing: { type: Boolean, required: true } })
const emit = defineEmits(['loaded'])
function imageLoaded(image) { emit('loaded', image) }
</script>
<style lang="less" scoped>
.ui-record-player { position: relative; width: 100%; aspect-ratio: 1.06; border-radius: 10%; background: linear-gradient(145deg, var(--record-base, #1c1f1d), var(--record-base-shade, #0e100f) 75%); box-shadow: 0 22px 38px #0003, inset 0 1px 2px #ffffff18, inset 0 -2px 2px #0006; }
.ui-record-platter { position: absolute; left: 4.5%; top: 5%; width: 84%; aspect-ratio: 1; border-radius: 50%; background: linear-gradient(145deg, #292c28, #080a08); box-shadow: inset 0 1px 3px #ffffff0c, 0 1px 2px #000a; }
.ui-record-disc { position: absolute; inset: 5%; border-radius: 50%; background: repeating-radial-gradient(circle, transparent 0 1px, #ffffff10 1px 2px, #00000012 2px 3px), conic-gradient(from 25deg, var(--record-shade), var(--record-tint) 15%, var(--record-highlight) 23%, var(--record-tint) 32%, var(--record-shade) 49%, var(--record-tint) 64%, var(--record-highlight) 74%, var(--record-tint) 81%, var(--record-shade)); box-shadow: inset 0 0 0 2px #ffffff14, inset 0 0 0 7px #00000012, 0 4px 9px #0009; animation: linkline-record-spin 28s linear infinite; animation-play-state: paused; }
.ui-record-label { position: absolute; inset: 23%; border: 8px solid #141812; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 1px #ffffff14; }
.ui-record-spindle { position: absolute; left: 50%; top: 50%; width: 2%; aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%; background: #c5c8bf; box-shadow: 0 0 0 2px #0006; }
.ui-record-arm { position: absolute; right: 4%; top: -7%; width: 24%; height: 100%; overflow: visible; transform-origin: 54% 16%; transform: rotate(-5deg); transition: transform .7s ease; filter: drop-shadow(2px 4px 3px #0007); }
.ui-record-indicator { position: absolute; right: 5%; bottom: 5%; display: grid; place-items: center; width: 7%; aspect-ratio: 1; border-radius: 50%; background: #090d09; box-shadow: inset 0 1px 2px #ffffff08; i { width: 35%; aspect-ratio: 1; border-radius: 50%; background: var(--modern-accent); box-shadow: 0 0 7px color-mix(in srgb, var(--modern-accent) 45%, transparent); opacity: .35; transition: opacity .3s ease; } }
.is-playing { .ui-record-disc { animation-play-state: running; } .ui-record-arm { transform: rotate(5deg); } .ui-record-indicator i { opacity: 1; } }
@keyframes linkline-record-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ui-record-disc { animation: none; } .ui-record-arm, .ui-record-indicator i { transition: none; } }
</style>
