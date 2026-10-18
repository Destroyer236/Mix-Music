import { markRaw, ref } from '@common/utils/vueTools'

// import { deduplicationList } from '@common/utils/renderer'


export const dislikeInfo: LX.Dislike.DislikeInfo = markRaw({
  names: markRaw(new Set()),
  musicNames: markRaw(new Set()),
  singerNames: markRaw(new Set()),
  rules: '',
})

export const dislikeRuleCount = ref(0)
// Rule edits can keep the same count; consumers must still invalidate caches.
export const dislikeRulesVersion = ref(0)
