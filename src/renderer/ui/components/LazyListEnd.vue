<template>
  <div ref="marker" class="ui-lazy-list-end"><button type="button" :disabled="busy" @click="$emit('more')">{{ busy ? '正在加载…' : error ? '加载失败，点击重试' : '继续加载' }}<UiIcon name="chevronDown" /></button></div>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import UiIcon from './UiIcon.vue'
const props = withDefaults(defineProps<{ busy?: boolean, error?: boolean }>(), { busy: false, error: false })
const emit = defineEmits<{ more: [] }>()
const marker = ref<HTMLElement>()
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(entries => { if (!props.busy && !props.error && entries.some(entry => entry.isIntersecting)) emit('more') }, { rootMargin: '0px 0px 120px 0px' })
  if (marker.value) observer.observe(marker.value)
})
onBeforeUnmount(() => { observer?.disconnect() })
</script>
<style lang="less">
.ui-lazy-list-end { display: flex; justify-content: center; min-height: 52px; align-items: center; button { display: flex; align-items: center; gap: 7px; border: 0; padding: 8px 16px; background: transparent; color: var(--modern-muted); font: inherit; font-size: 12px; cursor: pointer; &:hover { color: var(--modern-accent-ink); } svg { width: 14px; height: 14px; } } }
</style>
