<template>
  <UiModal :show="Boolean(miguPhoneLogin)" title="咪咕音乐 · 手机号登录" subtitle="使用咪咕账号手机号登录，验证码以短信发送" width="360px" @close="closeMiguPhoneLogin">
    <div v-if="miguPhoneLogin" class="ui-migu-login">
      <label class="ui-migu-field">
        <span>手机号</span>
        <input v-model="view.phone" type="tel" maxlength="11" inputmode="numeric" placeholder="请输入咪咕账号手机号" autocomplete="off" @keyup.enter="submitMiguPhoneLogin">
      </label>
      <label class="ui-migu-field">
        <span>验证码</span>
        <span class="ui-migu-code">
          <input v-model="view.code" type="tel" maxlength="8" inputmode="numeric" placeholder="请输入短信验证码" autocomplete="off" @keyup.enter="submitMiguPhoneLogin">
          <button type="button" :disabled="view.sending || miguCountdown > 0 || view.submitting" @click="sendMiguPhoneCode">{{ codeButtonText }}</button>
        </span>
      </label>
      <p v-if="view.error" role="alert" class="ui-migu-status error">{{ view.error }}</p>
      <p v-else-if="view.notice" role="status" class="ui-migu-status">{{ view.notice }}</p>
      <p class="ui-dialog-note">登录即表示同意咪咕用户服务协议与隐私政策。红心与歌单同步范围以当前账号为准。</p>
    </div>
    <template #footer>
      <button type="button" class="ui-dialog-button" :disabled="view.submitting" @click="closeMiguPhoneLogin">关闭</button>
      <button type="button" class="ui-dialog-button ui-dialog-button-primary" :disabled="view.submitting || !view.sent" @click="submitMiguPhoneLogin">{{ view.submitting ? '登录中…' : '登录' }}</button>
    </template>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import UiModal from './UiModal.vue'
import { closeMiguPhoneLogin, miguCountdown, miguPhoneLogin, sendMiguPhoneCode, submitMiguPhoneLogin } from '../services/miguPhoneLogin'

// 弹窗关闭时视图对象为 null；用兜底对象让模板类型收窄（隐藏时写入不会发生）。
const view = computed(() => miguPhoneLogin.value ?? { phone: '', code: '', sending: false, submitting: false, sent: false, error: '', notice: '' })
const codeButtonText = computed(() => {
  if (view.value.sending) return '发送中…'
  if (miguCountdown.value > 0) return `${miguCountdown.value}s 后重发`
  return view.value.sent ? '重新获取' : '获取验证码'
})
onBeforeUnmount(closeMiguPhoneLogin)
</script>

<style lang="less">
.ui-migu-login { display: grid; gap: 14px; }
.ui-migu-field { display: grid; gap: 6px; font-size: 12px; color: var(--modern-muted); > span:first-child { font-size: 11px; } input { box-sizing: border-box; width: 100%; height: 36px; padding: 0 11px; border: 1px solid var(--modern-border); border-radius: 8px; background: var(--modern-panel); color: var(--modern-text); font-size: 13px; outline: none; &:focus { border-color: var(--modern-accent); } } }
.ui-migu-code { display: flex; gap: 8px; > input { flex: 1; min-width: 0; } > button { flex: none; height: 36px; padding: 0 12px; border: 1px solid var(--modern-border); border-radius: 8px; background: var(--modern-hover); color: var(--modern-accent-ink); font-size: 12px; cursor: pointer; &:disabled { opacity: .55; cursor: default; } } }
.ui-migu-status { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; &.error { color: #c66666; } }
</style>
