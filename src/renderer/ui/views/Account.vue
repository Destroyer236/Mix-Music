<template>
  <div class="ui-page echo-account-page">
    <header class="echo-account-hero">
      <span class="echo-profile-avatar"><img v-if="heroAvatar" :src="heroAvatar" alt="" referrerpolicy="no-referrer"><UiIcon v-else name="music" /></span>
      <span class="echo-profile-copy">
        <span class="echo-profile-name">{{ heroName }}</span>
        <span class="echo-profile-meta">
          <template v-if="hero"><span v-if="hero.vip" class="echo-profile-badge">{{ hero.vip.label }}</span><span v-else class="echo-profile-badge is-none">NOVIP</span></template>
          <span v-else>尚未登录任何平台账号，可在下方登录</span>
        </span>
      </span>
    </header>
    <PlatformAccounts />
  </div>
</template>

<script setup lang="ts">
import UiIcon from '../components/UiIcon.vue'
import PlatformAccounts from '../components/PlatformAccounts.vue'
import { echoProfile } from '../services/platformAccounts'
import type { PlatformProfile } from '@common/platformAccounts'
import { computed } from 'vue'
// 模板内的可选链在 webpack 生成的虚拟 TS 文件里无法收窄，统一在脚本里取值。
const hero = computed<PlatformProfile | null>(() => echoProfile.value)
const heroAvatar = computed(() => hero.value?.avatar ?? '')
const heroName = computed(() => hero.value?.nickname ?? '未登录')
</script>

<style lang="less">
.echo-account-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.echo-account-hero {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  padding: 14px 16px;
  border-radius: var(--echo-radius-card);
  background: color-mix(in srgb, var(--echo-content-tone) 5%, transparent);
}
</style>
