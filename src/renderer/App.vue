<template><div id="container"><Shell /><PlayerDetail /><AppearancePanel /><SystemDialogs /></div></template>
<script setup>
import { onMounted } from 'vue'
import useApp from '@renderer/core/useApp'
import { useAppearance } from '@renderer/composables/useAppearance'
import { useAtmosphere } from './ui/echo/atmosphere'
import { useCoverAccent } from './ui/coverAccent'
import Shell from './ui/Shell.vue'
import PlayerDetail from './ui/PlayerDetail.vue'
import AppearancePanel from './ui/components/AppearancePanel.vue'
import SystemDialogs from './ui/components/SystemDialogs.vue'
useApp()
useAppearance()
useAtmosphere()
useCoverAccent()
onMounted(() => { document.getElementById('root').style.display = 'block' })
</script>
<style lang="less">
@import './assets/styles/index.less';
@import './ui/styles.less';
@import './ui/qq-music.less';
@import './ui/echo-skin.less';
</style>

