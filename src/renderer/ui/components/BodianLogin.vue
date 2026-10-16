<template>
  <UiModal :show="Boolean(bodianLogin)" title="登录波点音乐" subtitle="使用波点音乐 App 扫码，在手机上确认登录" width="390px" @close="closeBodianLogin">
    <div v-if="bodianLogin" class="ui-bodian-login">
      <div class="ui-bodian-code" :class="{ inactive: bodianLogin?.status === 'expired' || bodianLogin?.status === 'error' }">
        <img v-if="bodianLogin?.image" :src="bodianLogin?.image" alt="波点音乐登录二维码" draggable="false">
        <span v-else>{{ bodianLogin?.status === 'loading' ? '正在获取二维码…' : '二维码未加载' }}</span>
      </div>
      <p role="status" :class="{ error: bodianLogin?.status === 'error' }">{{ statusText }}</p>
      <p class="ui-dialog-note">登录后自动汇总红心歌曲和歌单。播放范围以平台版权及当前账号权限为准。</p>
    </div>
    <template #footer><button type="button" class="ui-dialog-button" @click="closeBodianLogin">关闭</button><button v-if="bodianLogin?.status !== 'confirmed'" type="button" class="ui-dialog-button ui-dialog-button-primary" :disabled="bodianLogin?.status === 'loading'" @click="startBodianLogin">刷新二维码</button></template>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import UiModal from './UiModal.vue'
import { bodianLogin, closeBodianLogin, startBodianLogin } from '../services/bodianLogin'
const statusText = computed(() => {
  const login = bodianLogin.value
  if (!login) return ''
  return { loading: '正在连接波点音乐…', waiting: '等待扫码', scanned: '已扫码，请在手机上确认', confirmed: '登录成功，正在同步音乐库', expired: '二维码已过期，请刷新后重试', error: login.error }[login.status]
})
onBeforeUnmount(closeBodianLogin)
</script>

<style lang="less">
.ui-bodian-login { display: grid; justify-items: center; gap: 18px; text-align: center; > p { width: 100%; overflow-wrap: anywhere; &.error { color: #c66666; } } }
.ui-bodian-code { box-sizing: border-box; width: 224px; height: 224px; padding: 12px; display: grid; place-items: center; border-radius: 12px; background: #fff; color: #666; img { width: 200px; height: 200px; image-rendering: pixelated; } &.inactive img { opacity: .2; filter: blur(3px); } }
</style>
