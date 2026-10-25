<template>
  <form ref="form" class="ui-global-search" role="search" aria-label="全局音乐搜索" @submit.prevent="submit()" @focusout="onBlur">
    <UiIcon name="search" />
    <input ref="field" v-model="input" type="search" role="combobox" autocomplete="off" :spellcheck="false" maxlength="200" aria-label="搜索音乐" :placeholder="isEchoSkin ? '搜索音乐、歌手、专辑' : '搜索歌曲、专辑、歌手或歌单'" aria-autocomplete="list" :aria-expanded="visible" :aria-controls="visible ? 'global-search-suggestions' : undefined" :aria-activedescendant="visible && selected >= 0 ? `global-search-option-${selected}` : undefined" @focus="onFocus" @click="opened = true" @input="opened = true" @keydown="onKey" @compositionstart="composing = true" @compositionend="composing = false">
    <router-link v-if="isEchoSkin" to="/search" class="ui-search-page-link" aria-label="打开搜索页" title="打开搜索页" @click="dismiss">搜索页</router-link>
    <button v-if="input" type="button" class="ui-search-clear" aria-label="清空搜索" title="清空搜索" @click="clear"><UiIcon name="close" /></button>
    <button type="submit" class="ui-search-submit" aria-label="搜索" title="搜索 · Enter" :disabled="!input.trim()"><UiIcon name="arrowRight" /></button>
    <Teleport to="body">
      <section v-if="visible" ref="panel" class="ui-search-suggestions" :style="position" aria-label="音乐搜索提示" @mousedown.prevent @keydown.esc.stop.prevent="dismiss" @focusout="onBlur">
        <header><span>{{ keyword ? '搜索建议' : '最近搜索' }}</span><small><kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>↵</kbd> 搜索</small></header>
        <div id="global-search-suggestions" class="ui-search-suggestions-list scroll" role="listbox" aria-label="搜索建议" :aria-busy="Boolean(keyword && suggestions.loading)">
          <template v-if="keyword && suggestions.loading">
            <div class="ui-search-preview-skeleton" role="status" aria-label="正在查找歌曲和歌手"><div v-for="index in 3" :key="index"><i /><span><i /><i /></span></div></div>
          </template>
          <template v-else>
            <div v-if="artistOptions.length" class="ui-search-preview-group ui-search-artists" role="group" aria-label="歌手"><h3>歌手 <span>{{ artistOptions.length }}</span></h3><div class="ui-search-artist-grid">
              <button v-for="option in artistOptions" :id="`global-search-option-${option.index}`" :key="option.key" class="ui-search-artist-option" type="button" role="option" tabindex="-1" :aria-label="`歌手：${option.name}`" :aria-selected="selected === option.index" @pointermove="selected = option.index" @click="choose(option)">
                <span class="ui-search-preview-art is-artist"><TrackArtwork v-if="option.image" :src="option.image" /><UiIcon v-else name="micVocal" /></span><span class="ui-search-preview-copy"><strong>{{ highlight(option.name)[0] }}<mark>{{ highlight(option.name)[1] }}</mark>{{ highlight(option.name)[2] }}</strong><small>歌手</small></span><UiIcon name="arrowRight" />
              </button>
            </div></div>
            <div v-if="songOptions.length" class="ui-search-preview-group ui-search-songs" role="group" aria-label="歌曲"><h3>歌曲 <span>{{ songOptions.length }}</span></h3>
              <button v-for="option in songOptions" :id="`global-search-option-${option.index}`" :key="option.key" class="ui-search-song-option" type="button" role="option" tabindex="-1" :aria-label="`歌曲：${option.name}，歌手：${option.singer || '未知歌手'}`" :aria-selected="selected === option.index" @pointermove="selected = option.index" @click="choose(option)">
                <span class="ui-search-preview-art"><TrackArtwork v-if="option.image" :src="option.image" /><UiIcon v-else name="disc" /></span><span class="ui-search-preview-copy"><strong>{{ highlight(option.name)[0] }}<mark>{{ highlight(option.name)[1] }}</mark>{{ highlight(option.name)[2] }}</strong><small>{{ highlight(option.singer || '未知歌手')[0] }}<mark>{{ highlight(option.singer)[1] }}</mark>{{ highlight(option.singer)[2] }}</small></span><UiIcon name="arrowRight" />
              </button>
            </div>
            <div v-if="wordOptions.length" class="ui-search-preview-group ui-search-words" role="group" :aria-label="keyword ? '相关搜索' : '最近搜索'"><h3 v-if="keyword">相关搜索</h3>
              <button v-for="option in wordOptions" :id="`global-search-option-${option.index}`" :key="option.key" type="button" role="option" tabindex="-1" :aria-selected="selected === option.index" @pointermove="selected = option.index" @click="choose(option)"><UiIcon :name="option.kind === 'history' ? 'clock' : 'search'" /><span>{{ highlight(option.name)[0] }}<mark>{{ highlight(option.name)[1] }}</mark>{{ highlight(option.name)[2] }}</span><UiIcon name="arrowRight" /></button>
            </div>
            <p v-if="keyword && !options.length" class="ui-search-suggestion-status" role="status">{{ suggestions.failed ? '联想暂时不可用，可直接搜索' : '没有更多建议，可直接搜索' }}</p>
          </template>
        </div>
        <button v-if="keyword" type="button" class="ui-search-suggestion-direct" @click="submit()"><UiIcon name="search" /><span>查看 <strong>“{{ keyword }}”</strong> 的全部结果</span><UiIcon name="arrowRight" /></button>
      </section>
    </Teleport>
  </form>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import music from '@renderer/utils/musicSdk'
import qqTipSearch from '@renderer/utils/musicSdk/tx/tipSearch'
import { historyList } from '@renderer/store/search/state'
import { getHistoryList } from '@renderer/store/search/action'
import { appSetting } from '@renderer/store/setting'
import { createSearchSuggestions, type SuggestionState } from '../searchSuggestions'
import { appearance } from '../../composables/useAppearance'
import UiIcon from './UiIcon.vue'
import TrackArtwork from './TrackArtwork.vue'
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string], submit: [] }>()
const input = computed({ get: () => props.modelValue, set: value => { emit('update:modelValue', value) } })
const keyword = computed(() => input.value.trim())
const form = ref<HTMLFormElement | null>(null)
const field = ref<HTMLInputElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const opened = ref(false)
const composing = ref(false)
const selected = ref(-1)
const isEchoSkin = computed(() => appearance.skin === 'echo')
const position = ref<Record<string, string>>({})
const suggestions = ref<SuggestionState>({ items: [], songs: [], artists: [], loading: false, failed: false })
const history = computed(() => appSetting['search.isShowHistorySearch'] ? historyList.slice(0, 15) : [])
interface PreviewOption { key: string, kind: 'artist' | 'song' | 'history' | 'keyword', name: string, singer: string, image: string, index: number }
const options = computed<PreviewOption[]>(() => {
  const result: Array<Omit<PreviewOption, 'index'>> = []
  if (keyword.value) {
    for (const artist of suggestions.value.artists) result.push({ ...artist, key: `artist:${artist.id}`, kind: 'artist' })
    for (const song of suggestions.value.songs) result.push({ ...song, key: `song:${song.id}`, kind: 'song' })
  }
  const matches = keyword.value ? history.value.filter(word => word.toLocaleLowerCase().includes(keyword.value.toLocaleLowerCase())) : history.value
  const seen = new Set(result.map(item => item.name.toLocaleLowerCase()))
  const words = [...matches, ...(keyword.value ? suggestions.value.items : [])]
  for (const word of words) {
    const key = word.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ key: `word:${key}`, kind: history.value.includes(word) ? 'history' : 'keyword', name: word, singer: '', image: '' })
    if (result.length >= (keyword.value ? 8 : 6)) break
  }
  return result.slice(0, keyword.value ? 8 : 6).map((item, index) => ({ ...item, index }))
})
const artistOptions = computed(() => options.value.filter(item => item.kind === 'artist'))
const songOptions = computed(() => options.value.filter(item => item.kind === 'song'))
const wordOptions = computed(() => options.value.filter(item => item.kind === 'history' || item.kind === 'keyword'))
const visible = computed(() => opened.value && !composing.value && Boolean(keyword.value || options.value.length))
// Local receivers isolate both providers' cancellation from other search inputs.
const provider = Object.assign(Object.create(qqTipSearch), { requestObj: null })
const fallback = Object.assign(Object.create(music.kw.tipSearch), { requestObj: null })
let providerVersion = 0
const controller = createSearchSuggestions({
  search: async text => {
    const version = providerVersion
    try { return await provider.tipSearch(text) } catch (error) {
      if (version !== providerVersion) throw error
      return await fallback.search(text)
    }
  },
  cancel: () => { providerVersion++; provider.cancelTipSearch(); fallback.cancelTipSearch() },
}, state => { suggestions.value = state })
const route = useRoute()
const router = useRouter()
function highlight(word: string) {
  const index = keyword.value ? word.toLocaleLowerCase().indexOf(keyword.value.toLocaleLowerCase()) : -1
  return index < 0 ? [word, '', ''] : [word.slice(0, index), word.slice(index, index + keyword.value.length), word.slice(index + keyword.value.length)]
}
function place() {
  const bounds = form.value?.getBoundingClientRect()
  if (!bounds) return
  const width = Math.min(Math.max(bounds.width, 420), innerWidth - 24)
  const top = bounds.bottom + 8
  const playerTop = document.querySelector('.ui-shell > .ui-player')?.getBoundingClientRect().top ?? innerHeight
  const bottom = Math.min(innerHeight - 16, playerTop - 12)
  position.value = { left: `${Math.max(12, Math.min(bounds.left, innerWidth - width - 12))}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${Math.min(460, Math.max(0, bottom - top))}px` }
}
function dismiss() { opened.value = false; selected.value = -1 }
function outside(event: PointerEvent) { const target = event.target as Node; if (!form.value?.contains(target) && !panel.value?.contains(target)) dismiss() }
function onBlur(event: FocusEvent) { const target = event.relatedTarget as Node | null; if (!target || (!form.value?.contains(target) && !panel.value?.contains(target))) dismiss() }
function onFocus() { opened.value = true; void getHistoryList().catch(() => {}) }
function clear() { input.value = ''; selected.value = -1; field.value?.focus(); opened.value = true }
function submit(word = keyword.value) {
  if (composing.value || !word.trim()) return
  input.value = word.trim()
  dismiss()
  emit('submit')
}
function choose(option: PreviewOption) {
  if (option.kind !== 'artist') { submit(option.kind === 'song' && option.singer ? `${option.name} ${option.singer}` : option.name); return }
  input.value = option.name
  dismiss()
  void router.push({ path: '/search', query: { text: option.name, type: 'artist' } })
}
function onKey(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) {
    if (event.key === 'Enter') event.preventDefault()
    return
  }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    opened.value = true
    if (!options.value.length) return
    selected.value = event.key === 'ArrowDown' ? (selected.value + 1) % options.value.length : (selected.value <= 0 ? options.value.length : selected.value) - 1
    void nextTick(() => { document.getElementById(`global-search-option-${selected.value}`)?.scrollIntoView({ block: 'nearest' }) })
  } else if (event.key === 'Enter' && visible.value && selected.value >= 0) {
    event.preventDefault()
    choose(options.value[selected.value])
  }
}
watch([keyword, opened, composing], ([text, open, composition]) => {
  selected.value = -1
  if (open && !composition) controller.update(text)
  else controller.close()
})
watch(options, () => { selected.value = -1 })
watch(() => route.fullPath, dismiss)
function removeListeners() { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', place); window.removeEventListener('blur', dismiss) }
watch(visible, async show => {
  removeListeners()
  if (!show) return
  place()
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', place)
  window.addEventListener('blur', dismiss)
  await nextTick()
  if (visible.value) place()
})
onBeforeUnmount(() => { controller.dispose(); removeListeners() })
defineExpose({ focus: () => { field.value?.focus() } })
</script>
