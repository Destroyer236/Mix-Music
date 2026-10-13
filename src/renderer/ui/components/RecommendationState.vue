<template>
  <div class="ui-recommend-state" :class="{ 'is-loading': loading }" role="status" :aria-busy="loading">
    <template v-if="loading"><div v-for="index in 3" :key="index" class="ui-recommend-placeholder"><span /><div><i /><i /></div></div><span class="ui-visually-hidden">{{ loadingText }}</span></template>
    <template v-else><UiIcon :name="error ? 'connectionError' : 'music'" /><div><strong>{{ error || emptyText }}</strong><p v-if="!error && description">{{ description }}</p></div><button v-if="error" type="button" @click="emit('retry')"><UiIcon name="refresh" />重试</button></template>
  </div>
</template>
<script setup lang="ts">
import UiIcon from './UiIcon.vue'
withDefaults(defineProps<{ loading?: boolean, error?: string, emptyText?: string, description?: string, loadingText?: string }>(), { loading: false, error: '', emptyText: '这里暂时没有推荐内容', description: '', loadingText: '正在寻找好音乐…' })
const emit = defineEmits<{ retry: [] }>()
</script>
