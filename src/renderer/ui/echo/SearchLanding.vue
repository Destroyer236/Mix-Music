<template>
  <div class="echo-search-landing">
    <h1 class="echo-search-landing-title">搜索</h1>
    <div class="echo-search-landing-input">
      <UiIcon name="search" />
      <input
        v-model="text"
        type="search"
        role="searchbox"
        aria-label="搜索音乐、歌手、专辑"
        placeholder="搜索音乐、歌手、专辑"
        enterkeyhint="search"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @keydown.enter.prevent="!composing && submit()"
      >
      <button type="button" class="echo-search-landing-submit" :disabled="!text.trim()" @click="submit()">搜索</button>
    </div>

    <section v-if="historyVisible && historyList.length" class="echo-search-landing-section">
      <div class="echo-search-landing-head">
        <h2>历史搜索</h2>
        <button type="button" class="echo-search-landing-clear" aria-label="清空搜索历史" title="清空搜索历史" @click="clearHistoryList('')"><UiIcon name="trash" /></button>
      </div>
      <div class="echo-search-landing-chips">
        <span v-for="(word, index) in historyList.slice(0, 20)" :key="word" class="echo-history-chip">
          <button type="button" class="echo-history-chip-main" @click="submit(word)"><UiIcon name="clock" /><span>{{ word }}</span></button>
          <button type="button" class="echo-history-chip-remove" :aria-label="`删除搜索记录 ${word}`" @click="removeHistoryWord(index)"><UiIcon name="close" /></button>
        </span>
      </div>
    </section>

    <section class="echo-search-landing-section">
      <div class="echo-search-landing-head"><h2>热门搜索</h2></div>
      <div class="echo-search-landing-tabs" role="group" aria-label="热搜来源">
        <button v-for="item in hotSources" :key="item.value" type="button" :class="{ 'is-active': hotSource === item.value }" :aria-pressed="hotSource === item.value" @click="switchHotSource(item.value)">{{ item.label }}</button>
      </div>
      <p v-if="hotLoading" class="echo-search-landing-status" role="status">正在获取热搜…</p>
      <div v-else-if="hotList.length" class="echo-search-landing-chips">
        <button v-for="(word, index) in hotList" :key="word + index" type="button" class="echo-hot-chip" @click="submit(word)">{{ word }}</button>
      </div>
      <p v-else class="echo-search-landing-status">暂无热门搜索</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import music from '@renderer/utils/musicSdk'
import { sourceNames } from '@renderer/store'
import { historyList } from '@renderer/store/search/state'
import { clearHistoryList, getHistoryList, removeHistoryWord } from '@renderer/store/search/action'
import { appSetting } from '@renderer/store/setting'

const router = useRouter()
const text = ref('')
const composing = ref(false)

// 历史搜索沿用全局搜索 store（顶栏搜索框与设置开关共用同一份数据）
const historyVisible = computed(() => appSetting['search.isShowHistorySearch'] as boolean | undefined ?? true)

// 热门搜索：按平台取热搜词（kw/wy/tx/mg/kg 提供 hotSearch），结果按来源缓存
const hotSources = (['kw', 'wy', 'tx', 'mg', 'kg'] as const).map(value => ({ value, label: sourceNames.value[value] }))
const hotSource = ref<string>('kw')
const hotLoading = ref(false)
const hotList = ref<string[]>([])
const hotCache = new Map<string, string[]>()

function switchHotSource(value: string) {
  if (hotSource.value === value) return
  hotSource.value = value
  void loadHot()
}
async function loadHot() {
  const source = hotSource.value
  if (hotCache.has(source)) {
    hotList.value = hotCache.get(source) ?? []
    return
  }
  hotLoading.value = true
  try {
    const modules = music as unknown as Record<string, { hotSearch?: { getList: () => Promise<{ list?: unknown[] }> } } | undefined>
    const result = await modules[source]?.hotSearch?.getList()
    const list = (result?.list ?? []).filter((word: unknown): word is string => typeof word === 'string' && word.trim().length > 0)
    hotCache.set(source, list)
    if (hotSource.value === source) hotList.value = list
  } catch {
    if (hotSource.value === source) hotList.value = []
  } finally {
    if (hotSource.value === source) hotLoading.value = false
  }
}

function submit(word?: string) {
  const value = (word ?? text.value).trim()
  if (!value) return
  text.value = value
  void router.push({ path: '/search', query: { text: value } })
}

onMounted(() => { void getHistoryList().catch(() => {}) })
watch(hotSource, () => { void loadHot() }, { immediate: true })
</script>

<style lang="less">
// echo 搜索页落地页（对照 EchoMusic views/Search.vue 无关键词状态）：
// 标题 + 大输入框 + 历史搜索 chips + 热门搜索（来源 tab + 关键词 chips）
.echo-search-landing {
  display: flex;
  flex-direction: column;
}
.echo-search-landing-title {
  margin: 0 0 18px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -.4px;
}
.echo-search-landing-input {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 5px 0 14px;
  border: 1px solid color-mix(in srgb, var(--echo-content-tone) 10%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--echo-content-tone) 5%, transparent);
  transition: background .12s var(--echo-motion-standard), border-color .12s;
  &:focus-within { border-color: color-mix(in srgb, var(--echo-content-tone) 22%, transparent); background: color-mix(in srgb, var(--echo-content-tone) 7%, transparent); }
  > svg { width: 17px; height: 17px; flex: none; color: color-mix(in srgb, var(--echo-content-tone) 55%, transparent); }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--modern-text);
    font-size: 14px;
    &::placeholder { color: var(--modern-muted); opacity: 1; }
    &::-webkit-search-cancel-button { display: none; }
  }
}
.echo-search-landing-submit {
  flex: none;
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 7px;
  background: var(--modern-accent);
  color: var(--modern-accent-contrast);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity .15s;
  &:hover { opacity: .9; }
  &:disabled { opacity: .4; cursor: default; }
}
.echo-search-landing-section { margin-top: 26px; }
.echo-search-landing-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  h2 { margin: 0; font-size: 13px; font-weight: 600; }
}
.echo-search-landing-clear {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--echo-radius-control);
  background: transparent;
  color: var(--modern-muted);
  cursor: pointer;
  svg { width: 14px; height: 14px; }
  &:hover { background: color-mix(in srgb, var(--echo-content-tone) 8%, transparent); color: var(--modern-text); }
}
.echo-search-landing-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.echo-search-landing-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  button {
    height: 30px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--echo-content-tone) 5%, transparent);
    color: var(--modern-muted);
    font-size: 12px;
    cursor: pointer;
    transition: background .15s var(--echo-motion-enter), color .15s var(--echo-motion-enter);
    &:hover { background: color-mix(in srgb, var(--echo-content-tone) 10%, transparent); color: var(--modern-text); }
    &.is-active { background: color-mix(in srgb, var(--modern-accent) 14%, transparent); color: var(--modern-accent-ink); font-weight: 600; }
  }
}
.echo-search-landing-status { margin: 4px 0; color: var(--modern-muted); font-size: 12px; }
.echo-history-chip {
  display: inline-flex;
  align-items: center;
  height: 30px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--echo-content-tone) 5%, transparent);
  transition: background .15s var(--echo-motion-enter);
  &:hover { background: color-mix(in srgb, var(--echo-content-tone) 10%, transparent); }
}
.echo-history-chip-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 4px 0 12px;
  border: 0;
  background: transparent;
  color: var(--modern-text);
  font-size: 12px;
  cursor: pointer;
  svg { width: 11px; height: 11px; color: color-mix(in srgb, var(--echo-content-tone) 50%, transparent); }
  span { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
.echo-history-chip-remove {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-right: 5px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--modern-muted);
  cursor: pointer;
  svg { width: 9px; height: 9px; }
  &:hover { background: color-mix(in srgb, var(--echo-content-tone) 14%, transparent); color: var(--modern-text); }
}
.echo-hot-chip {
  height: 30px;
  padding: 0 13px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--echo-content-tone) 5%, transparent);
  color: var(--modern-text);
  font-size: 12px;
  cursor: pointer;
  transition: background .15s var(--echo-motion-enter);
  &:hover { background: color-mix(in srgb, var(--echo-content-tone) 10%, transparent); }
}
</style>
