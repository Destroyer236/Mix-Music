<template>
  <div class="ui-radial-categories">
    <button type="button" class="ui-category-trigger" aria-haspopup="dialog" :aria-expanded="open" aria-label="打开环形歌单分类" :title="`选择分类 · ${selectedGroup?.name || '歌单'}${selectedTag ? ' / ' + selectedTag.name : ''}`" @click="show">
      <UiIcon :name="groupIcon(selectedGroup?.name || '')" />
      <span class="ui-category-selected">{{ selectedGroup?.name || '选择分区' }}</span>
      <template v-if="selectedTag"><span class="ui-category-selection-divider" aria-hidden="true">/</span><span class="ui-category-selected-tag">{{ selectedTag.name }}</span></template>
      <UiIcon name="chevronDown" />
    </button>
    <UiModal :show="open" title="歌单分类" subtitle="选择一个分区，找到喜欢的音乐" width="600px" @close="open = false">
      <div class="ui-category-browser">
        <div class="ui-category-wheel">
          <div class="ui-category-orbit" @pointermove="motion?.move($event)" @pointerleave="motion?.release()"><svg viewBox="0 0 300 300" aria-label="歌单大类">
            <g v-for="(group, index) in visibleGroups" :key="group.name" role="button" tabindex="0" :aria-label="group.name" :aria-pressed="group === current" :class="{ active: group === current }" :style="{ '--wedge-x': (point(Number(index), visibleGroups.length).x - 150) * 0.035 + 'px', '--wedge-y': (point(Number(index), visibleGroups.length).y - 150) * 0.035 + 'px' }" @click="selectGroup(group.name)" @keydown.enter.prevent="selectGroup(group.name)" @keydown.space.prevent="selectGroup(group.name)">
              <path :d="wedge(Number(index), visibleGroups.length)" />
              <UiIcon :name="groupIcon(group.name)" :x="point(Number(index), visibleGroups.length).x - 11" :y="point(Number(index), visibleGroups.length).y - 22" width="22" height="22" />
              <text :x="point(Number(index), visibleGroups.length).x" :y="point(Number(index), visibleGroups.length).y + 18" text-anchor="middle">{{ group.name }}</text>
            </g>
            <circle cx="150" cy="150" r="67" />
            <text class="ui-category-center-name" x="150" y="175" text-anchor="middle">{{ current?.name || '全部音乐' }}</text>
            <text class="ui-category-center-count" x="150" y="194" text-anchor="middle">{{ current?.list.length || 0 }} 个分类</text>
          </svg><CategoryMotion ref="motion" :symbol="groupSymbol(current?.name || '')" /></div>
          <div v-if="groups.length > 8" class="ui-category-wheel-footer"><button type="button" :disabled="page === 0" aria-label="上一组分类" @click="page--"><UiIcon name="back" /></button><span>{{ page + 1 }} / {{ Math.ceil(groups.length / 8) }}</span><button type="button" :disabled="(page + 1) * 8 >= groups.length" aria-label="下一组分类" @click="page++"><UiIcon name="chevronRight" /></button></div>
        </div>
        <section class="ui-category-detail" :aria-label="current?.name || '详细分类'">
          <Transition name="ui-category-details" mode="out-in"><div :key="current?.name" class="ui-category-detail-panel">
            <div class="ui-category-detail-heading">
              <span class="ui-category-detail-icon"><UiIcon :name="groupIcon(current?.name || '')" /></span>
              <div><h3>{{ current?.name || '选择大类' }}<span>{{ current?.list.length || 0 }} 类</span></h3><p>{{ groupDescription(current?.name || '') }}</p></div>
            </div>
            <label class="ui-category-search"><UiIcon name="search" /><input v-model="tagQuery" type="search" placeholder="查找分类" :aria-label="`查找${current?.name || ''}分类`" /></label>
            <div class="ui-category-detail-tags">
              <button v-for="(tag, index) in filteredTags" :key="tag.id" type="button" :title="tag.name" :style="{ '--tag-delay': Math.min(Number(index), 8) * 18 + 'ms' }" :aria-pressed="modelValue === tag.id" @click="choose(tag.id)"><span>{{ tag.name }}</span><UiIcon v-if="modelValue === tag.id" name="check" /></button>
            </div>
            <p v-if="tagQuery && !filteredTags.length" class="ui-category-no-match">没有匹配的分类</p>
          </div></Transition>
        </section>
      </div>
      <template #footer><div class="ui-category-current-selection"><span>当前</span><strong>{{ selectedGroup?.name || '歌单' }}<template v-if="selectedTag"><span aria-hidden="true"> / </span>{{ selectedTag.name }}</template></strong></div><div class="ui-category-footer-actions"><button type="button" class="ui-category-clear" @click="choose('')">全部歌单</button><button type="button" class="ui-category-done" @click="open = false">完成<UiIcon name="arrowRight" /></button></div></template>
    </UiModal>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TagInfoTypeItem } from '@renderer/store/songList/state'
import UiModal from './UiModal.vue'
import UiIcon from './UiIcon.vue'
import CategoryMotion from './CategoryMotion.vue'
const props: { groups: TagInfoTypeItem[], modelValue: string, source: LX.OnlineSource } = defineProps<{ groups: TagInfoTypeItem[], modelValue: string, source: LX.OnlineSource }>()
const emit = defineEmits<{ change: [id: string] }>()
const open = ref(false)
const selected = ref('')
const page = ref(0)
const tagQuery = ref('')
const motion = ref<{ move: (event: PointerEvent) => void, release: () => void } | null>(null)
const preferenceKey = 'linkline.song-list.category.'
const selectedTagGroup = computed(() => props.groups.find(group => group.list.some(tag => tag.id === props.modelValue)))
const selectedGroup = computed(() => selectedTagGroup.value ?? props.groups.find(group => group.name === selected.value) ?? props.groups[0])
const selectedTag = computed(() => selectedTagGroup.value?.list.find(tag => tag.id === props.modelValue))
const visibleGroups = computed(() => props.groups.slice(page.value * 8, page.value * 8 + 8))
const current = computed(() => visibleGroups.value.find(group => group.name === selected.value) ?? visibleGroups.value[0])
const filteredTags = computed(() => {
  const query = tagQuery.value.trim().toLocaleLowerCase()
  return (current.value?.list ?? []).filter(tag => !query || tag.name.toLocaleLowerCase().includes(query))
})
watch([current, open], () => { tagQuery.value = '' })
watch([() => props.groups, () => props.source], () => {
  open.value = false
  let remembered = ''
  try { remembered = localStorage.getItem(preferenceKey + props.source) ?? '' } catch {}
  const matching = props.groups.find(group => group.list.some(tag => tag.id === props.modelValue))
  selected.value = matching?.name ?? props.groups.find(group => group.name === remembered)?.name ?? props.groups[0]?.name ?? ''
  page.value = Math.max(0, Math.floor(props.groups.findIndex(group => group.name === selected.value) / 8))
}, { immediate: true })
watch(() => props.modelValue, id => {
  const group = props.groups.find(group => group.list.some(tag => tag.id === id))
  if (group) selectGroup(group.name)
})
function selectGroup(name: string) {
  selected.value = name
  try { localStorage.setItem(preferenceKey + props.source, name) } catch {}
}
function show() {
  selected.value = selectedGroup.value?.name ?? ''
  const index = props.groups.findIndex(group => group.name === selectedGroup.value?.name)
  page.value = Math.max(0, Math.floor(index / 8))
  open.value = true
}
function choose(id: string) {
  const group = props.groups.find(group => group.list.some(tag => tag.id === id))
  if (group) selectGroup(group.name)
  emit('change', id)
  open.value = false
}
function polar(radius: number, degrees: number) { const angle = degrees * Math.PI / 180; return { x: 150 + radius * Math.cos(angle), y: 150 + radius * Math.sin(angle) } }
function point(index: number, count: number) { return polar(106, -90 + index * 360 / count) }
function wedge(index: number, count: number) {
  const center = -90 + index * 360 / count
  const span = 360 / count - 3
  const start = center - span / 2
  const end = center + span / 2
  const a = polar(143, start); const b = polar(143, end); const c = polar(74, end); const d = polar(74, start)
  return `M${a.x},${a.y} A143,143 0 ${span > 180 ? 1 : 0} 1 ${b.x},${b.y} L${c.x},${c.y} A74,74 0 ${span > 180 ? 1 : 0} 0 ${d.x},${d.y} Z`
}
function groupIcon(name: string) {
  if (/语种|语言|地区/.test(name)) return 'languages'
  if (/情感|心情/.test(name)) return 'smile'
  if (name.includes('场景')) return 'headphones'
  if (/年代|年份/.test(name)) return 'calendarDays'
  if (/风格|曲风|流派/.test(name)) return 'quality'
  if (name.includes('主题')) return 'sparkles'
  if (/有声|听书|广播/.test(name)) return 'micVocal'
  if (/专区|专辑/.test(name)) return 'disc'
  return 'shapes'
}
function groupSymbol(name: string) {
  const symbols: Record<string, string> = { languages: '文', smile: '♡', headphones: '♫', calendarDays: '◷', quality: '♬', sparkles: '✦', micVocal: '♪', disc: '◎', shapes: '✧' }
  return symbols[groupIcon(name)]
}
function groupDescription(name: string) {
  if (/语种|语言|地区/.test(name)) return '听见不同语言里的旋律'
  if (/情感|心情/.test(name)) return '让音乐陪伴此刻的心情'
  if (name.includes('场景')) return '为生活里的每个片刻选一首歌'
  if (/年代|年份/.test(name)) return '重温属于那个年代的声音'
  if (/风格|曲风|流派/.test(name)) return '找到合拍的节奏与风格'
  if (name.includes('主题')) return '从一个主题，发现更多好音乐'
  if (/有声|听书|广播/.test(name)) return '听故事，也听见新的世界'
  return '选择喜欢的分类，探索更多歌单'
}
</script>
<style lang="less">
.ui-category-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--modern-border); border-radius: 6px; background: transparent; color: var(--modern-muted); font: inherit; cursor: pointer; .ui-svg-icon { width: 15px; height: 15px; } }
.ui-category-browser { display: grid; grid-template-columns: 272px minmax(0, 1fr); gap: 24px; min-height: 300px; }
.ui-category-orbit { position: relative; > svg { display: block; width: 100%; } > svg > g { color: var(--modern-muted); cursor: pointer; outline: none; > path { fill: var(--modern-hover); stroke: var(--modern-border); stroke-width: .8; } > text { fill: currentColor; font-size: 12px; pointer-events: none; } &:hover, &:focus-visible, &.active { color: var(--modern-text); > path { fill: color-mix(in srgb, #d1bb76 30%, var(--modern-panel)); stroke: #bca35a; } } &:focus-visible > path { stroke-width: 2; } } > svg > circle { fill: var(--modern-panel); stroke: var(--modern-border); } .ui-category-center-name { fill: var(--modern-text); font-size: 16px; font-weight: 600; } .ui-category-center-count { fill: var(--modern-muted); font-size: 11px; } }
.ui-category-wheel-footer { display: flex; align-items: center; justify-content: center; gap: 8px; > button { border: 0; border-radius: 5px; padding: 4px 8px; background: var(--modern-hover); color: var(--modern-muted); font: inherit; cursor: pointer; &:disabled { opacity: .4; cursor: default; } } > span { font-size: 11px; } .ui-svg-icon { width: 15px; height: 15px; } }
.ui-category-detail { min-width: 0; h3 { display: flex; align-items: center; gap: 8px; margin: 0; padding: 0; font-size: 16px; > span { font-size: 11px; color: var(--modern-muted); font-weight: 400; } } }
.ui-category-detail-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; p { margin: 5px 0 0; color: var(--modern-muted); font-size: 11px; line-height: 1.6; } }
.ui-category-detail-icon { display: grid; place-items: center; flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px; color: var(--modern-accent-ink); background: var(--modern-accent-soft); .ui-svg-icon { width: 22px; height: 22px; } }
.ui-category-detail-tags { display: flex; align-content: flex-start; flex-wrap: wrap; gap: 8px; max-height: 274px; overflow-y: auto; > button { display: inline-flex; align-items: center; gap: 4px; padding: 7px 11px; border: 0; border-radius: 5px; background: var(--modern-hover); color: var(--modern-text); font: inherit; font-size: 12px; cursor: pointer; &:hover, &[aria-pressed='true'] { background: var(--modern-accent-soft); color: var(--modern-accent-ink); } .ui-svg-icon { width: 12px; height: 12px; } } }
@media (max-width: 650px) { .ui-category-browser { grid-template-columns: 230px minmax(0, 1fr); gap: 16px; min-height: 260px; } .ui-category-detail-tags { max-height: 242px; } }
@media (max-width: 510px) { .ui-category-browser { grid-template-columns: 1fr; } .ui-category-wheel { width: 220px; margin: auto; } .ui-category-detail-tags { max-height: 150px; } }
</style>
