<template>
  <div class="external-cover">
    <img v-if="track.cover && !failed" :src="track.cover" alt="" draggable="false" @error="failed = true">
    <svg v-else viewBox="0 0 48 48" aria-hidden="true"><path d="M31 11v23a6 6 0 1 1-4-5.7V15l-13 3v19a6 6 0 1 1-4-5.7V14z" fill="currentColor" /></svg>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { track } from '../core/externalState'
const failed = ref(false)
watch(() => track.cover, () => { failed.value = false })
</script>
<style lang="less">
.external-cover { flex: none; overflow: hidden; display: grid; place-items: center; background: linear-gradient(135deg, #323646, #716b9c); color: #ffffffbd; img { width: 100%; height: 100%; object-fit: cover; } svg { width: 75%; height: 75%; } }
</style>
