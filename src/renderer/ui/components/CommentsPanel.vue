<template>
  <section class="ui-comments-section" aria-label="评论列表" :aria-busy="loading">
    <header class="ui-comments-toolbar">
      <h2>评论<span v-if="!loading && !error">{{ total.toLocaleString() }}</span></h2>
      <div class="ui-comments-tabs" role="group" aria-label="评论排序"><button type="button" :class="{ active: kind === 'hot' }" :aria-pressed="kind === 'hot'" @click="selectKind('hot')">热门评论</button><button type="button" :class="{ active: kind === 'new' }" :aria-pressed="kind === 'new'" @click="selectKind('new')">最新评论</button></div>
    </header>
    <div v-if="loading" class="ui-comments-skeleton" role="status" aria-label="正在加载评论"><div v-for="index in 3" :key="index" aria-hidden="true"><i /><span><i /><i /><i /></span></div></div>
    <UiEmpty v-else-if="error || !list.length" :title="error || '还没有评论'" :description="error ? '' : '听听音乐，感受这首歌的故事。'" :retry="Boolean(error) && supported" @retry="load" />
    <div v-else class="ui-comments-feed"><CommentItem v-for="(comment, index) in list" :key="comment.id ?? index" :comment="comment" /></div>
    <LazyListEnd v-if="!error && !loading && hasMore" :busy="loadingMore" :error="Boolean(moreError)" @more="loadMore" />
    <p v-if="moreError" class="ui-comments-more-error" role="status">{{ moreError }}</p>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import music from '@renderer/utils/musicSdk'
import { toOldMusicInfo } from '@renderer/utils'
import UiEmpty from './UiEmpty.vue'
import LazyListEnd from './LazyListEnd.vue'
import CommentItem from './CommentItem.vue'
const props = defineProps({ track: { type: Object, required: true } })
const emit = defineEmits(['navigate'])
const kind = ref('hot')
const page = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const moreError = ref('')
const list = ref([])
const total = ref(0)
const pages = ref(1)
const exhausted = ref(false)
const hasMore = computed(() => !exhausted.value && page.value < pages.value)
const supported = computed(() => Boolean(music[props.track.source]?.comment?.[kind.value === 'hot' ? 'getHotComment' : 'getComment']))
let requestId = 0
function selectKind(value) { if (kind.value !== value) kind.value = value }
const commentKey = comment => String(comment.id ?? `${comment.userName}:${comment.time}:${comment.text}`)
async function fetchPage(nextPage, append, id) {
  const api = music[props.track.source]?.comment
  const method = kind.value === 'hot' ? 'getHotComment' : 'getComment'
  if (!api?.[method]) { error.value = '这个音乐平台暂不支持评论'; return }
  if (append) loadingMore.value = true
  else loading.value = true
  moreError.value = ''
  try {
    const result = await api[method](toOldMusicInfo(props.track), nextPage, 20)
    if (id !== requestId) return
    const incoming = result.comments || []
    const seen = new Set(list.value.map(commentKey))
    const fresh = incoming.filter(comment => { const key = commentKey(comment); if (seen.has(key)) return false; seen.add(key); return true })
    list.value = append ? [...list.value, ...fresh] : fresh
    total.value = Number(result.total) || 0
    pages.value = Math.max(1, Number(result.maxPage) || Math.ceil(total.value / (Number(result.limit) || 20)))
    page.value = nextPage
    exhausted.value = !incoming.length || (append && !fresh.length)
  } catch {
    if (id !== requestId) return
    if (append) moreError.value = '更多评论暂时无法获取，可以点击重试'
    else error.value = '评论暂时无法获取，请稍后重试'
  } finally {
    if (id === requestId) { loading.value = false; loadingMore.value = false }
  }
}
async function load() {
  const id = ++requestId
  list.value = []; total.value = 0; page.value = 0; pages.value = 1; error.value = ''; moreError.value = ''; exhausted.value = false; loadingMore.value = false; loading.value = false
  await fetchPage(1, false, id)
}
async function loadMore() { if (!loading.value && !loadingMore.value && hasMore.value) await fetchPage(page.value + 1, true, requestId) }
watch(kind, () => { emit('navigate') }, { flush: 'post' })
watch([kind, () => props.track.source, () => props.track.id], load, { immediate: true })
onBeforeUnmount(() => { requestId++ })
</script>
<style lang="less">
.ui-comments-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--modern-border); h2 { display: flex; align-items: baseline; gap: 9px; font-size: 19px; font-weight: 600; span { color: var(--modern-muted); font-size: 12px; font-weight: 400; } } }
.ui-comments-tabs { display: flex; align-items: center; gap: 24px; button { position: relative; padding: 12px 0 15px; border: 0; background: transparent; color: var(--modern-muted); font: inherit; font-size: 13px; cursor: pointer; &.active { color: var(--modern-accent-ink); font-weight: 600; &::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; border-radius: 2px; background: var(--modern-accent); } } &:hover { color: var(--modern-text); } } }
.ui-comments-skeleton { > div { display: flex; gap: 14px; padding: 24px 0; border-bottom: 1px solid var(--modern-border); > i { width: 36px; height: 36px; border-radius: 50%; flex: none; } > span { flex: 1; padding-top: 3px; i { display: block; height: 10px; border-radius: 4px; margin-bottom: 14px; &:first-child { width: 96px; } &:last-child { width: 65%; } } } i { background: var(--modern-hover); } } }
@media (max-width: 650px) { .ui-comments-tabs { gap: 16px; button { font-size: 12px; } } .ui-comments-toolbar { gap: 12px; } }
</style>
