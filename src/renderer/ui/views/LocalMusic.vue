<template>
  <section ref="pageContainer" class="ui-local-music">
    <nav class="ui-device-tabs" aria-label="本地与下载"><router-link to="/local" aria-current="page">本地音乐</router-link><router-link to="/download">下载管理</router-link></nav>
    <div class="ui-local-toolbar">
      <button type="button" class="ui-local-button ui-local-primary" :disabled="loading || playing || !filteredTracks.length" @click="playTrack(filteredTracks[0])"><UiIcon name="play" filled />{{ playing ? '正在准备…' : '播放全部' }}</button>
      <button type="button" class="ui-local-button" :disabled="importing" @click="importAudio('files')"><UiIcon name="plus" />导入音乐</button>
      <button type="button" class="ui-local-button" :disabled="importing" @click="importAudio('folder')"><UiIcon name="folder" />选择目录</button>
      <button type="button" class="ui-local-button ui-local-icon-button" :disabled="loading || importing" title="刷新曲库" aria-label="刷新曲库" @click="loadTracks()"><UiIcon name="refresh" /></button>
      <label class="ui-local-search"><UiIcon name="search" /><input v-model="query" placeholder="搜索本地音乐" aria-label="搜索本地音乐"><button v-if="query" type="button" aria-label="清空本地搜索" @click="query = ''"><UiIcon name="close" /></button></label>
    </div>

    <div class="ui-local-classification">
      <div class="ui-local-tabs" role="tablist" aria-label="本地音乐分类"><button v-for="tab in categories" :id="`local-tab-${tab.id}`" :key="tab.id" type="button" role="tab" :aria-selected="category === tab.id" aria-controls="local-tracks-panel" :tabindex="category === tab.id ? 0 : -1" :class="{ active: category === tab.id }" @click="chooseCategory(tab.id)" @keydown="tabKeydown($event, tab.id)">{{ tab.label }}</button></div>
      <span class="ui-local-summary">{{ groupIndex.artist.length }} 位歌手 <i />{{ groupIndex.album.length }} 张专辑 <i />{{ groupIndex.folder.length }} 个文件夹</span>
    </div>

    <div v-if="importing && importProgress" class="ui-local-notice ui-local-import-progress" role="status" aria-live="polite"><div><strong>正在扫描并导入音乐</strong><p>发现 {{ importProgress.discovered }} 首 · 已导入 {{ importProgress.imported }} 首 · 跳过 {{ importProgress.skipped }} 项 · 失败 {{ importProgress.failed + importProgress.metadataFailed }} 项</p><small :title="importProgress.directory">{{ importProgress.directory || '正在读取所选文件…' }}</small></div><button type="button" :disabled="importCancelled" @click="importCancelled = true">{{ importCancelled ? '正在停止…' : '停止导入' }}</button></div>
    <div v-if="message" class="ui-local-notice" role="status"><span>{{ message }}</span><button type="button" aria-label="关闭提示" @click="message = ''"><UiIcon name="close" /></button></div>
    <div v-if="actionError" class="ui-local-notice ui-local-error" role="alert"><span :title="actionError">{{ actionError }}</span><button type="button" aria-label="关闭错误提示" @click="actionError = ''"><UiIcon name="close" /></button></div>

    <div id="local-tracks-panel" class="ui-local-body" role="tabpanel" :aria-labelledby="`local-tab-${category}`">
      <aside v-if="category !== 'all'" class="ui-local-groups" :aria-label="`${categoryLabel}分类列表`">
        <div class="ui-local-group-heading"><strong>{{ categoryLabel }}</strong><span>{{ matchingGroups.length }}</span></div>
        <div class="ui-local-group-scroll scroll">
          <button type="button" class="ui-local-group-all" :class="{ active: !groupId }" :aria-pressed="!groupId" @click="chooseGroup(null)"><UiIcon :name="categoryIcon" /><span>全部{{ categoryLabel }}</span></button>
          <button v-for="group in visibleGroups" :key="group.id" type="button" class="ui-local-group" :class="{ active: groupId === group.id }" :aria-label="`${categoryLabel}：${group.name}，${group.trackIds.length} 首`" :aria-pressed="groupId === group.id" :title="group.subtitle || group.name" @click="chooseGroup(group.id)">
            <span class="ui-local-group-art"><UiIcon v-if="category === 'folder'" name="folder" /><TrackArtwork v-else :track="trackById.get(group.trackIds[0])" :list-id="LOCAL_LIBRARY_ID" /></span>
            <span class="ui-local-group-label"><strong>{{ group.name }}</strong><small>{{ group.trackIds.length }} 首<span v-if="category === 'album' && group.subtitle"> · {{ group.subtitle }}</span></small></span>
          </button>
          <p v-if="!matchingGroups.length" class="ui-local-group-empty">{{ query ? `没有找到匹配的${categoryLabel}` : `导入音乐后会自动生成${categoryLabel}分类` }}</p>
          <button v-if="visibleGroups.length < matchingGroups.length" type="button" class="ui-local-more-groups" @click="groupLimit += GROUP_PAGE_SIZE">显示更多（{{ matchingGroups.length - visibleGroups.length }}）</button>
        </div>
      </aside>

      <main class="ui-local-content">
        <div v-if="category !== 'all' || query" class="ui-local-section-heading"><div><h2>{{ currentGroup?.name || (category === 'all' ? '搜索结果' : `全部${categoryLabel}`) }}</h2><p v-if="currentGroup?.subtitle" :title="currentGroup.subtitle">{{ currentGroup.subtitle }}</p></div><span>{{ filteredTracks.length }} 首</span><button v-if="groupId" type="button" @click="chooseGroup(null)">查看全部</button></div>
        <div v-if="selected.size" class="ui-local-selection"><span>已选择 {{ selected.size }} 首</span><button type="button" @click="addTracks(selectedTracks)">加入歌单</button><button type="button" @click="requestRemove(selectedTracks)">移除</button><button type="button" @click="selected = new Set()">取消选择</button></div>
        <div v-if="!loading && !error && !tracks.length" class="ui-local-empty">
          <div class="ui-local-empty-art" aria-hidden="true"><UiIcon name="music" /></div><h2>收藏在电脑里的好音乐</h2><p>导入歌曲，或选择一个音乐文件夹。<br>按歌手、专辑和文件夹，找到想听的声音。</p><div><button type="button" class="ui-local-button ui-local-primary" :disabled="importing" @click="importAudio('folder')"><UiIcon name="folder" />选择音乐目录</button><button type="button" class="ui-local-button" :disabled="importing" @click="importAudio('files')">选择音乐文件</button></div><small>音乐文件保留在原位置</small>
        </div>
        <LocalTrackTable v-else :list="filteredTracks" :list-id="LOCAL_LIBRARY_ID" :loading="loading" :error="error" :selected-ids="selected" empty-title="没有找到匹配的本地音乐" empty-description="试试其他关键词，或切换歌手、专辑和文件夹。" @play="playTrack" @add="addTrack" @edit="editTrack" @remove="removeTrack" @select="toggleSelected" @artist="chooseArtist" @album="chooseAlbum" @retry="loadTracks()" />
        <footer v-if="filteredTracks.length && !loading" class="ui-local-pagination"><label><input type="checkbox" :checked="allSelected" aria-label="选择全部音乐" @change="selectAll">选择全部</label><span>{{ filteredTracks.length }} 首{{ query ? '搜索结果' : '歌曲' }}</span><span class="ui-library-scroll-hint">向下滚动，继续浏览</span></footer>
      </main>
    </div>
    <TrackActionModal :show="addOpen" action="add" :tracks="actionTracks" :from-list-id="LOCAL_LIBRARY_ID" @close="addOpen = false" @success="handleSuccess" />
    <TrackMetadataModal :show="metadataOpen" :track="metadataTrack" :list-id="LOCAL_LIBRARY_ID" @close="metadataOpen = false" @saved="metadataSaved" />
    <UiModal :show="removeOpen" title="从本地音乐移除" :subtitle="`已选择 ${removeTracks.length} 首音乐`" @close="removeOpen = false"><p class="ui-dialog-note">只移除 LinkLine 中的本地曲库记录，电脑上的音乐文件会继续保留，其他歌单中的记录也不受影响。</p><template #footer><button type="button" class="ui-dialog-button" :disabled="removing" @click="removeOpen = false">取消</button><button type="button" class="ui-dialog-button ui-dialog-button-danger" :disabled="removing" @click="confirmRemove">{{ removing ? '移除中…' : '移除音乐' }}</button></template></UiModal>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { LIST_IDS } from '@common/constants'
import { LOCAL_AUDIO_EXTENSIONS, LOCAL_LIBRARY_ID } from '@common/localMusic'
import { getListMusics, removeListMusics, setTempList } from '@renderer/store/list/action'
import { playList } from '@renderer/core/player'
import { showSelectDialog } from '@renderer/utils/ipc'
import { saveListPrevSelectId } from '@renderer/utils/data'
import { ensureLocalLibrary, importLocalAudio, type LocalImportProgress } from '../services/localLibrary'
import { buildLocalLibraryIndex, filterLocalLibraryTracks, type LocalLibraryCategory, type LocalLibraryGroup } from '../services/localLibraryGroups'
import LocalTrackTable from '../components/LocalTrackTable.vue'
import TrackArtwork from '../components/TrackArtwork.vue'
import TrackActionModal from '../components/TrackActionModal.vue'
import TrackMetadataModal from '../components/TrackMetadataModal.vue'
import UiIcon from '../components/UiIcon.vue'
import UiModal from '../components/UiModal.vue'
import { usePaginationScroll } from '../usePaginationScroll'

const GROUP_PAGE_SIZE = 100
const categories: Array<{ id: LocalLibraryCategory, label: string }> = [{ id: 'all', label: '全部歌曲' }, { id: 'artist', label: '歌手' }, { id: 'album', label: '专辑' }, { id: 'folder', label: '文件夹' }]
const tracks = shallowRef<LX.Music.MusicInfoLocal[]>([])
const category = ref<LocalLibraryCategory>('all')
const groupId = ref<string | null>(null)
const query = ref('')
const pageContainer = usePaginationScroll([query, category, groupId], '.local-track-table__scroll')
const groupLimit = ref(GROUP_PAGE_SIZE)
const loading = ref(true)
const error = ref('')
const actionError = ref('')
const message = ref('')
const playing = ref(false)
const importing = ref(false)
const importCancelled = ref(false)
const importProgress = shallowRef<LocalImportProgress | null>(null)
const selected = ref(new Set<string>())
const addOpen = ref(false)
const actionTracks = shallowRef<LX.Music.MusicInfoLocal[]>([])
const metadataOpen = ref(false)
const metadataTrack = shallowRef<LX.Music.MusicInfoLocal | null>(null)
const removeOpen = ref(false)
const removeTracks = shallowRef<LX.Music.MusicInfoLocal[]>([])
const removing = ref(false)
const groupIndex = computed(() => buildLocalLibraryIndex(tracks.value))
const trackById = computed(() => new Map(tracks.value.map(track => [track.id, track])))
const groups = computed<LocalLibraryGroup[]>(() => category.value === 'all' ? [] : groupIndex.value[category.value])
const categoryLabel = computed(() => categories.find(tab => tab.id === category.value)?.label ?? '歌曲')
const categoryIcon = computed(() => category.value === 'folder' ? 'folder' : category.value === 'album' ? 'library' : 'music')
const currentGroup = computed(() => groups.value.find(group => group.id === groupId.value))
const searchedTracks = computed(() => filterLocalLibraryTracks(tracks.value, groupIndex.value, 'all', null, query.value))
const searchedIds = computed(() => new Set(searchedTracks.value.map(track => track.id)))
const matchingGroups = computed(() => query.value.trim() ? groups.value.filter(group => group.trackIds.some(id => searchedIds.value.has(id))) : groups.value)
const visibleGroups = computed(() => matchingGroups.value.slice(0, groupLimit.value))
const filteredTracks = computed(() => filterLocalLibraryTracks(searchedTracks.value, groupIndex.value, category.value, groupId.value, ''))
const selectedTracks = computed(() => tracks.value.filter(track => selected.value.has(track.id)))
const allSelected = computed(() => filteredTracks.value.length > 0 && filteredTracks.value.every(track => selected.value.has(track.id)))
let requestId = 0
let disposed = false

// Reset only view state: classification never changes the stored local library.
watch(query, () => { groupLimit.value = GROUP_PAGE_SIZE; selected.value = new Set() })
function chooseCategory(value: LocalLibraryCategory) { category.value = value; groupId.value = null; groupLimit.value = GROUP_PAGE_SIZE; selected.value = new Set() }
function chooseGroup(id: string | null) { groupId.value = id; selected.value = new Set() }
function tabKeydown(event: KeyboardEvent, id: LocalLibraryCategory) {
  const index = categories.findIndex(tab => tab.id === id)
  let next: number
  if (event.key === 'ArrowRight') next = (index + 1) % categories.length
  else if (event.key === 'ArrowLeft') next = (index + categories.length - 1) % categories.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = categories.length - 1
  else return
  event.preventDefault()
  chooseCategory(categories[next].id)
  document.getElementById(`local-tab-${categories[next].id}`)?.focus()
}
function chooseArtist(text: string) { query.value = ''; chooseCategory('artist'); chooseGroup(groupIndex.value.artist.find(group => group.name === text)?.id ?? null) }
function chooseAlbum(_text: string, track: LX.Music.MusicInfoLocal) { query.value = ''; chooseCategory('album'); chooseGroup(groupIndex.value.album.find(group => group.trackIds.includes(track.id))?.id ?? null) }
async function loadTracks(background = false) {
  const request = ++requestId
  if (!background) loading.value = true
  error.value = ''
  try {
    const data = await getListMusics(LOCAL_LIBRARY_ID)
    if (disposed || request !== requestId) return
    tracks.value = data.filter((track): track is LX.Music.MusicInfoLocal => track.source === 'local')
    selected.value = new Set([...selected.value].filter(id => trackById.value.has(id)))
    if (groupId.value && !groups.value.some(group => group.id === groupId.value)) groupId.value = null
  } catch (err) { if (!disposed && request === requestId) error.value = err instanceof Error ? err.message : '本地曲库加载失败，请重试。' } finally { if (!disposed && request === requestId) loading.value = false }
}
function handleListUpdate(ids: string[]) { if (!importing.value && ids.includes(LOCAL_LIBRARY_ID)) void loadTracks(true) }
onMounted(async() => {
  window.app_event.on('myListUpdate', handleListUpdate)
  saveListPrevSelectId(LOCAL_LIBRARY_ID)
  try { await ensureLocalLibrary(); if (!disposed) await loadTracks() } catch (err) { if (!disposed) { loading.value = false; error.value = err instanceof Error ? err.message : '本地曲库加载失败。' } }
})
onBeforeUnmount(() => { disposed = true; requestId++; importCancelled.value = true; window.app_event.off('myListUpdate', handleListUpdate) })
async function perform(task: () => Promise<void>) { actionError.value = ''; try { await task() } catch (err) { if (!disposed) actionError.value = err instanceof Error ? err.message : '操作未能完成，请重试。' } }
async function playTrack(track?: LX.Music.MusicInfoLocal) {
  if (!track || playing.value) return
  const queue = [...filteredTracks.value]
  const index = queue.findIndex(item => item.id === track.id)
  if (index < 0) return
  playing.value = true
  await perform(async() => { await setTempList(`local_library__${category.value}__${groupId.value ?? 'all'}`, queue); if (!disposed) playList(LIST_IDS.TEMP, index) })
  playing.value = false
}
function toggleSelected(id: string) { const next = new Set(selected.value); if (next.has(id)) next.delete(id); else next.add(id); selected.value = next }
function selectAll() { const next = new Set(selected.value); const remove = allSelected.value; for (const track of filteredTracks.value) { if (remove) next.delete(track.id); else next.add(track.id) }; selected.value = next }
function addTracks(list: LX.Music.MusicInfoLocal[]) { if (!list.length) return; actionTracks.value = [...list]; addOpen.value = true }
function addTrack(track: LX.Music.MusicInfoLocal) { addTracks([track]) }
function removeTrack(track: LX.Music.MusicInfoLocal) { requestRemove([track]) }
function handleSuccess(value: string) { message.value = value; selected.value = new Set() }
function editTrack(track: LX.Music.MusicInfoLocal) { metadataTrack.value = track; metadataOpen.value = true }
async function metadataSaved() { await loadTracks(true); message.value = '歌曲信息与本地分类已更新' }
function requestRemove(list: LX.Music.MusicInfoLocal[]) { if (!list.length) return; removeTracks.value = [...list]; removeOpen.value = true }
async function confirmRemove() {
  if (removing.value) return
  removing.value = true
  await perform(async() => { await removeListMusics({ listId: LOCAL_LIBRARY_ID, ids: removeTracks.value.map(track => track.id) }); await loadTracks(true); removeOpen.value = false; selected.value = new Set(); message.value = '已移除曲库记录，原音乐文件已保留' })
  removing.value = false
}
async function importAudio(mode: 'files' | 'folder') {
  if (importing.value) return
  importing.value = true
  importCancelled.value = false
  importProgress.value = null
  await perform(async() => {
    const result = await showSelectDialog(mode === 'folder'
      ? { title: '选择音乐文件夹（包含子文件夹）', properties: ['openDirectory', 'multiSelections'] }
      : { title: '导入本地音乐', properties: ['openFile', 'multiSelections'], filters: [{ name: '音频文件', extensions: [...LOCAL_AUDIO_EXTENSIONS] }] })
    if (disposed || result.canceled || !result.filePaths.length) return
    const info = await importLocalAudio(result.filePaths, progress => { if (!disposed) importProgress.value = progress }, () => importCancelled.value)
    if (disposed) return
    message.value = `${info.cancelled ? '已停止导入，' : ''}已导入 ${info.imported} 首 · 跳过 ${info.skipped} 项 · 失败 ${info.failed + info.metadataFailed} 项`
    if (info.errors.length) actionError.value = `未能读取：${info.errors.join('；')}`
    await loadTracks(true)
  })
  importing.value = false
}
</script>

<style lang="less">
.ui-local-music { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; padding: 26px 28px 0; color: var(--modern-text); background: var(--modern-panel); box-sizing: border-box; container-type: inline-size; button { cursor: pointer; &:disabled { opacity: .4; cursor: default; } &:focus-visible { outline: 2px solid var(--modern-accent); outline-offset: 3px; } } }
.ui-local-heading { display: flex; align-items: center; gap: 16px; flex: none; > div { min-width: 0; } h1 { margin: 4px 0; font-size: 25px; font-weight: 650; line-height: 1.4; small { margin-left: 8px; font-size: 11px; color: var(--modern-muted); font-weight: 400; white-space: nowrap; } } p { color: var(--modern-muted); font-size: 11px; line-height: 1.6; } }
.ui-local-emblem { display: grid; place-items: center; width: 64px; height: 64px; flex: none; border-radius: var(--modern-radius-small); background: var(--modern-accent-soft); color: var(--modern-accent-ink); svg { width: 30px; height: 30px; } }
.ui-local-eyebrow { color: var(--modern-muted); font-size: 8px; letter-spacing: 1.7px; }
.ui-local-directory { display: flex; align-items: center; gap: 3px; margin-left: auto; padding: 8px 0 8px 12px; border: 0; background: transparent; color: var(--modern-accent-ink); font-size: 11px; white-space: nowrap; svg { width: 15px; height: 15px; } }
.ui-local-toolbar { display: flex; align-items: center; gap: 8px; padding: 22px 0 16px; flex: none; }
.ui-local-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 9px 13px; border: 1px solid var(--modern-border); border-radius: var(--modern-radius-small); background: var(--modern-panel); color: var(--modern-text); font-size: 11px; white-space: nowrap; svg { width: 15px; height: 15px; } &:hover { background: var(--modern-hover); } }
.ui-local-primary { border-color: transparent; background: var(--modern-text); color: var(--modern-panel); &:hover { background: var(--modern-text); opacity: .85; } }
.ui-local-icon-button { width: 34px; padding: 9px 0; }
.ui-local-search { display: flex; align-items: center; gap: 8px; margin-left: auto; min-width: 80px; width: 215px; padding: 8px 11px; border: 1px solid var(--modern-border); border-radius: 20px; color: var(--modern-muted); svg { width: 15px; height: 15px; } input { width: 100%; min-width: 0; border: 0; background: transparent; color: var(--modern-text); font: inherit; font-size: 11px; outline: none; } &:focus-within { border-color: var(--modern-accent); } button { display: grid; place-items: center; padding: 0; border: 0; background: transparent; color: inherit; } }
.ui-local-classification { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 18px; flex: none; }
.ui-local-tabs { display: inline-flex; gap: 3px; padding: 4px; border-radius: 24px; background: var(--modern-hover); button { padding: 7px 16px; border-radius: 20px; border: 0; background: transparent; color: var(--modern-muted); font-size: 11px; white-space: nowrap; &.active { background: var(--modern-panel); color: var(--modern-text); box-shadow: 0 2px 6px rgba(0, 0, 0, .06); } &:hover { color: var(--modern-text); } } }
.ui-local-summary { display: inline-flex; align-items: center; gap: 9px; color: var(--modern-muted); font-size: 10px; white-space: nowrap; i { width: 2px; height: 2px; border-radius: 50%; background: currentColor; opacity: .6; } }
.ui-local-body { flex: 1; display: flex; min-height: 0; min-width: 0; gap: 20px; }
.ui-local-groups { width: 194px; flex: none; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--modern-border); padding-right: 16px; }
.ui-local-group-heading { display: flex; align-items: center; justify-content: space-between; min-height: 36px; padding: 0 8px; color: var(--modern-muted); font-size: 10px; strong { font-weight: 500; } span { font-variant-numeric: tabular-nums; } }
.ui-local-group-scroll { overflow: auto; flex: 1; min-height: 0; padding: 3px 0 14px; }
.ui-local-group, .ui-local-group-all { display: flex; align-items: center; width: 100%; gap: 10px; padding: 10px 9px; border: 0; border-radius: var(--modern-radius-small); margin-bottom: 5px; color: var(--modern-muted); background: transparent; text-align: left; font-size: 11px; &:hover { background: var(--modern-hover); } &.active { background: var(--modern-accent-soft); color: var(--modern-accent-ink); } }
.ui-local-group-all { min-height: 39px; svg { width: 17px; height: 17px; } }
.ui-local-group-art { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border-radius: 10px; overflow: hidden; background: var(--modern-hover); color: var(--modern-accent-ink); > svg { width: 20px; height: 20px; } }
.ui-local-group-label { display: block; min-width: 0; strong, small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } strong { color: var(--modern-text); font-size: 11px; font-weight: 500; } small { margin-top: 5px; color: var(--modern-muted); font-size: 9px; } }
.ui-local-group.active .ui-local-group-label strong { color: var(--modern-accent-ink); }
.ui-local-group-empty { padding: 22px 9px; color: var(--modern-muted); font-size: 11px; line-height: 1.7; }
.ui-local-more-groups { width: 100%; padding: 9px; border: 1px solid var(--modern-border); border-radius: 8px; background: transparent; color: var(--modern-muted); font-size: 10px; }
.ui-local-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; .local-track-table { flex: 1; min-height: 0; } }
.ui-local-section-heading { display: flex; align-items: center; gap: 12px; flex: none; padding: 0 10px 12px; > div { min-width: 0; } h2 { font-size: 14px; font-weight: 550; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } p { font-size: 9px; color: var(--modern-muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } > span { margin-left: auto; font-size: 10px; color: var(--modern-muted); white-space: nowrap; } button { padding: 3px; border: 0; background: transparent; color: var(--modern-accent-ink); font-size: 10px; white-space: nowrap; } }
.ui-local-empty { display: flex; align-items: center; justify-content: center; flex-direction: column; flex: 1; min-height: 0; text-align: center; padding: 24px 10px; h2 { font-size: 17px; font-weight: 550; margin-bottom: 10px; } p { color: var(--modern-muted); font-size: 11px; line-height: 1.9; } > div:last-of-type { display: flex; gap: 8px; margin-top: 22px; } > small { color: var(--modern-muted); font-size: 9px; margin-top: 14px; } }
.ui-local-empty-art { position: relative; display: grid; place-items: center; width: 94px; height: 80px; border-radius: 24px; margin-bottom: 27px; color: var(--modern-accent-ink); background: var(--modern-accent-soft); transform: rotate(-6deg); > svg { width: 52px; height: 52px; } span { position: absolute; right: -10px; bottom: -7px; display: grid; place-items: center; width: 39px; height: 39px; border: 4px solid var(--modern-panel); border-radius: 13px; color: var(--modern-panel); background: var(--modern-accent-ink); transform: rotate(12deg); svg { width: 21px; height: 21px; } } }
.ui-local-notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; margin-bottom: 10px; border-radius: var(--modern-radius-small); background: var(--modern-accent-soft); color: var(--modern-accent-ink); font-size: 11px; line-height: 1.6; button { display: grid; place-items: center; flex: none; padding: 3px; border: 0; background: transparent; color: inherit; svg { width: 15px; height: 15px; } } }
.ui-local-import-progress { > div { flex: 1; min-width: 0; } strong { font-weight: 600; } p { margin-top: 3px; } small { display: block; color: var(--modern-muted); font-size: 9px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } button { border: 1px solid var(--modern-border); border-radius: 7px; padding: 6px 9px; background: var(--modern-panel); } }
.ui-local-error { color: #c66666; background: rgba(197, 78, 78, .08); span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } }
.ui-local-selection { display: flex; align-items: center; gap: 12px; padding: 9px 12px; margin-bottom: 8px; border-radius: 9px; background: var(--modern-accent-soft); color: var(--modern-accent-ink); font-size: 11px; button { border: 0; padding: 0; background: transparent; color: inherit; font-size: 11px; } }
.ui-local-pagination { display: flex; align-items: center; gap: 12px; padding: 13px 4px; flex: none; font-size: 10px; color: var(--modern-muted); label { display: flex; align-items: center; gap: 6px; white-space: nowrap; input { accent-color: var(--modern-accent); } } label + span { margin-right: auto; } button { border: 1px solid var(--modern-border); border-radius: 7px; padding: 5px 8px; background: transparent; color: inherit; font-size: 10px; white-space: nowrap; } }
@container (max-width: 700px) { .ui-local-summary { display: none; } .ui-local-groups { width: 155px; padding-right: 12px; } .ui-local-body { gap: 12px; } }
@media (max-width: 1050px) { .ui-local-music { padding: 22px 18px 0; } }
@media (max-width: 760px) { .ui-local-music { padding: 18px 12px 0; } .ui-local-heading { gap: 10px; h1 { font-size: 21px; } p { display: none; } } .ui-local-emblem { width: 46px; height: 46px; svg { width: 25px; height: 25px; } } .ui-local-toolbar { flex-wrap: wrap; padding-top: 18px; } .ui-local-search { width: 150px; flex: 1; } .ui-local-tabs button { padding-left: 12px; padding-right: 12px; } }
@media (max-height: 700px) { .ui-local-music { padding-top: 16px; } .ui-local-heading { h1 { font-size: 22px; } p, .ui-local-eyebrow { display: none; } } .ui-local-emblem { width: 44px; height: 44px; svg { width: 24px; height: 24px; } } .ui-local-toolbar { padding-top: 14px; padding-bottom: 12px; } .ui-local-classification { padding-bottom: 10px; } .ui-local-notice { padding-top: 7px; padding-bottom: 7px; margin-bottom: 8px; } .ui-local-empty { padding-top: 12px; padding-bottom: 12px; } .ui-local-empty-art { width: 70px; height: 62px; margin-bottom: 20px; > svg { width: 40px; height: 40px; } } }
@container (max-width: 470px) { .ui-local-groups { width: 124px; padding-right: 8px; } .ui-local-group { gap: 6px; padding-left: 5px; padding-right: 5px; } .ui-local-group-art { width: 28px; height: 28px; } .ui-local-body { gap: 8px; } .ui-local-pagination { gap: 6px; label + span { display: none; } .ui-local-pagination label { margin-right: auto; } } .ui-local-empty { h2 { font-size: 14px; } > div:last-of-type { flex-direction: column; } } }
</style>
