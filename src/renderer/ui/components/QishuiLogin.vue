<template>
  <UiModal :show="Boolean(qishuiLogin)" title="登录汽水音乐" subtitle="打开汽水音乐 App，进入搜索页，点击搜索框右侧“扫一扫”" width="390px" @close="closeQishuiLogin">
    <div v-if="qishuiLogin" class="ui-qishui-login">
      <div class="ui-qishui-code" :class="{ inactive: qishuiLogin?.status === 'expired' || qishuiLogin?.status === 'error' }">
        <img v-if="qishuiLogin?.image" :src="qishuiLogin?.image" alt="汽水音乐登录二维码" draggable="false">
        <span v-else>{{ qishuiLogin?.status === 'loading' ? '正在获取二维码…' : '二维码未加载' }}</span>
      </div>
      <p role="status" :class="{ error: qishuiLogin?.status === 'error' }">{{ statusText }}</p>
      <p class="ui-dialog-note">登录后自动汇总红心歌曲和歌单。播放范围以平台版权及当前账号权限为准。</p>
    </div>
    <template #footer><button type="button" class="ui-dialog-button" @click="closeQishuiLogin">关闭</button><button v-if="qishuiLogin?.status !== 'confirmed'" type="button" class="ui-dialog-button ui-dialog-button-primary" :disabled="qishuiLogin?.status === 'loading'" @click="startQishuiLogin">刷新二维码</button></template>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import UiModal from './UiModal.vue'
import { closeQishuiLogin, qishuiLogin, startQishuiLogin } from '../services/qishuiLogin'
const statusText = computed(() => {
  const login = qishuiLogin.value
  if (!login) return ''
  if (login.error) return login.error
  if (login.retryAt) return '汽水音乐查询暂时受限，正在等待自动重试…'
  return { loading: '正在连接汽水音乐…', waiting: '等待扫码', scanned: '已扫码，请在手机上确认', verifying: '请在弹出的汽水音乐官方窗口中完成安全验证', confirmed: '登录成功，正在同步音乐库', expired: '二维码已过期，请刷新后重试', error: login.error }[login.status]
})
onBeforeUnmount(closeQishuiLogin)
</script>

<style lang="less">
.ui-qishui-login { display: grid; justify-items: center; gap: 18px; text-align: center; > p { width: 100%; overflow-wrap: anywhere; &.error { color: #c66666; } } }
.ui-qishui-code { box-sizing: border-box; width: 224px; height: 224px; padding: 12px; display: grid; place-items: center; border-radius: 12px; background: #fff; color: #666; img { width: 200px; height: 200px; image-rendering: pixelated; } &.inactive img { opacity: .2; filter: blur(3px); } }
</style>
