<template>
  <DesktopExternal v-if="mode === 'desktop'" />
  <IslandExternal v-else-if="mode === 'island'" />
  <TaskbarExternal v-else />
</template>

<script setup lang="ts">
import { mode } from './core/externalState'
import DesktopExternal from './ui/DesktopExternal.vue'
import IslandExternal from './ui/IslandExternal.vue'
import TaskbarExternal from './ui/TaskbarExternal.vue'
</script>

<style lang="less">
@import './assets/styles/reset.less';
html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
body { user-select: none; -webkit-font-smoothing: antialiased; }
button { font: inherit; outline-offset: -2px; }
button:focus-visible { outline: 2px solid #b0afff; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; } }
</style>
