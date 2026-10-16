<template>
  <button type="button" class="ui-heartbeat-button" :class="{ active: heartbeatActive }" :aria-label="label" :title="label" :aria-pressed="heartbeatActive" :aria-busy="heartbeatLoading" :disabled="heartbeatLoading" @click.stop="toggle"><UiIcon name="heartPulse" /></button>
  <Teleport to="body"><div v-if="notice" class="ui-heartbeat-toast" :class="`ui-heartbeat-toast--${notice.kind}`" role="status" aria-live="polite"><UiIcon :name="notice.kind === 'warning' ? 'alertCircle' : 'heartPulse'" /><span>{{ notice.message }}</span></div></Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { disposeHeartbeat, heartbeatActive, heartbeatLoading, toggleHeartbeat, type HeartbeatNotice } from '../services/heartbeat'
import UiIcon from './UiIcon.vue'

const label = computed(() => heartbeatLoading.value ? '正在加载心动模式' : heartbeatActive.value ? '退出心动模式' : '心动模式')
const notice = ref<HeartbeatNotice | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let mounted = true
function showNotice(result: HeartbeatNotice) {
  notice.value = result
  noticeTimer = setTimeout(() => { notice.value = null }, 3200)
}
async function toggle() {
  clearTimeout(noticeTimer)
  notice.value = null
  const result = await toggleHeartbeat()
  if (!mounted || !result) return
  showNotice(result)
}
onBeforeUnmount(() => { mounted = false; clearTimeout(noticeTimer); disposeHeartbeat() })
</script>

<style lang="less">
.ui-heartbeat-toast { position: fixed; z-index: 3000; left: 50%; bottom: calc(120px + var(--modern-panel-gap)); transform: translateX(-50%); display: flex; align-items: center; gap: 10px; box-sizing: border-box; width: max-content; max-width: calc(100vw - 32px); padding: 13px 18px; border: 1px solid var(--modern-border); border-radius: var(--modern-radius); background: var(--modern-panel); color: var(--modern-text); box-shadow: var(--modern-shadow); font-size: 14px; line-height: 1.6; pointer-events: none; svg { width: 20px; height: 20px; color: var(--modern-accent-ink); flex: none; } &--warning svg { color: #e5a31a; } }
</style>
