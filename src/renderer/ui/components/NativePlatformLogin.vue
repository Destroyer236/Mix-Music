<template>
  <UiModal :show="Boolean(nativeQrLogin)" :title="`登录${platformName}`" :subtitle="subtitle" width="390px" @close="closeNativeQrLogin">
    <div v-if="nativeQrLogin" class="ui-native-login">
      <div class="ui-native-login-code" :class="{ inactive: nativeQrLogin?.status === 'expired' || nativeQrLogin?.status === 'error' }">
        <img v-if="nativeQrLogin?.image" :src="nativeQrLogin?.image" :alt="`${platformName}登录二维码`" draggable="false">
        <span v-else>{{ nativeQrLogin?.status === 'loading' ? '正在获取二维码…' : '二维码未加载' }}</span>
      </div>
      <p role="status" :class="{ error: nativeQrLogin?.status === 'error' }">{{ statusText }}</p>
      <p class="ui-dialog-note">登录后自动汇总红心歌曲和歌单。播放范围以平台版权及当前账号权限为准。</p>
    </div>
    <template #footer><button type="button" class="ui-dialog-button" @click="closeNativeQrLogin">关闭</button><button v-if="nativeQrLogin?.status !== 'confirmed'" type="button" class="ui-dialog-button ui-dialog-button-primary" :disabled="nativeQrLogin?.status === 'loading'" @click="refresh">刷新二维码</button></template>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import UiModal from './UiModal.vue'
import { closeNativeQrLogin, nativeQrLogin, startNativeQrLogin } from '../services/nativeQrLogin'

const platformName = computed(() => nativeQrLogin.value?.platform === 'qq' ? 'QQ 音乐' : '网易云音乐')
const subtitle = computed(() => nativeQrLogin.value?.platform === 'qq' ? '使用手机 QQ 扫码，在手机上确认登录' : '使用网易云音乐 App 扫码，在手机上确认登录')
const statusText = computed(() => {
  const login = nativeQrLogin.value
  if (!login) return ''
  return { loading: `正在连接${platformName.value}…`, waiting: '等待扫码', scanned: '已扫码，请在手机上确认', confirmed: '登录成功，正在同步音乐库', expired: '二维码已过期，请刷新后重试', error: login.error }[login.status]
})
function refresh() { if (nativeQrLogin.value) void startNativeQrLogin(nativeQrLogin.value.platform) }
onBeforeUnmount(closeNativeQrLogin)
</script>

<style lang="less">
.ui-native-login { display: grid; justify-items: center; gap: 18px; text-align: center; > p { width: 100%; overflow-wrap: anywhere; &.error { color: #c66666; } } }
.ui-native-login-code { box-sizing: border-box; width: 224px; height: 224px; padding: 12px; display: grid; place-items: center; border-radius: 12px; background: #fff; color: #666; img { width: 200px; height: 200px; image-rendering: pixelated; } &.inactive img { opacity: .2; filter: blur(3px); } }
</style>
