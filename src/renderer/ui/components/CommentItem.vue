<template>
  <article class="ui-comment">
    <div class="ui-comment-avatar" aria-hidden="true"><img v-if="comment.avatar && !avatarFailed" :src="comment.avatar" alt="" loading="lazy" decoding="async" @error="avatarFailed = true"><span v-else>{{ (comment.userName || '听友').slice(0, 1) }}</span></div>
    <div class="ui-comment-content">
      <header><strong>{{ comment.userName || '听友' }}</strong><time>{{ comment.timeStr }}</time></header>
      <p>{{ comment.text }}</p>
      <div v-if="comment.images?.length" class="ui-comment-images"><img v-for="(url, i) in comment.images" :key="i" :src="url" alt="评论图片" loading="lazy" decoding="async"></div>
      <small v-if="comment.likedCount != null" class="ui-comment-likes" :aria-label="`${comment.likedCount} 人赞同`"><UiIcon name="heart" />{{ comment.likedCount }}</small>
      <div v-if="comment.reply?.length" class="ui-comment-replies"><CommentItem v-for="(reply, i) in comment.reply" :key="reply.id ?? i" :comment="reply" /></div>
    </div>
  </article>
</template>
<script setup>
import UiIcon from '@renderer/ui/components/UiIcon.vue'
import { ref, watch } from 'vue'
const props = defineProps({ comment: { type: Object, required: true } })
const avatarFailed = ref(false)
watch(() => props.comment.avatar, () => { avatarFailed.value = false })
</script>
<style scoped lang="less">
.ui-comment { display: flex; align-items: flex-start; gap: 14px; padding: 22px 0; border-bottom: 1px solid var(--modern-border); }
.ui-comment-avatar { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: var(--modern-accent-soft); color: var(--modern-accent-ink); font-size: 13px; > img { width: 100%; height: 100%; object-fit: cover; } }
.ui-comment-content { min-width: 0; flex: 1; > header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 5px 16px; padding-top: 2px; strong { font-size: 13px; line-height: 1.6; font-weight: 600; overflow-wrap: anywhere; } time { color: var(--modern-muted); font-size: 10px; line-height: 1.6; } } > p { margin: 9px 0 12px; color: var(--modern-text); font-size: 13px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; } }
.ui-comment-likes { display: inline-flex; align-items: center; gap: 6px; color: var(--modern-muted); font-size: 11px; svg { width: 13px; height: 13px; } }
.ui-comment-images { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; img { max-width: 100%; width: 180px; height: 180px; object-fit: contain; background: var(--modern-hover); border-radius: 8px; } }
.ui-comment-replies { margin-top: 14px; padding: 0 14px; border-radius: 8px; background: var(--modern-hover); .ui-comment { padding: 14px 0; gap: 10px; } .ui-comment:last-child { border-bottom: 0; } }
@media (max-width: 650px) { .ui-comment { gap: 10px; padding: 18px 0; } .ui-comment-avatar { width: 30px; height: 30px; } .ui-comment-content > header time { flex-basis: 100%; } .ui-comment-images img { width: 140px; height: 140px; } }
</style>
