import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import music from '@renderer/utils/musicSdk'
import { toNewMusicInfo } from '@renderer/utils'
import { sameRecording } from '@common/platformMatching'
import { sources, sortList, type ListInfoItem, type TagInfoItem } from '@renderer/store/songList/state'
import { getListDetail as getPlaylistDetail, getTags } from '@renderer/store/songList/action'
import { getBoardsList, getListDetail } from '@renderer/store/leaderboard/action'
import { getSongListSetting } from '@renderer/utils/data'
import { favoriteTracks } from './services/platformAccounts'
import { freshRecommendations, randomMix, recommendationArtists, recommendationKey } from './recommendationMix'
import { getRecommendationHistory } from './recommendationHistory'
import { RecommendationBuffer, type RecommendationBatch } from './recommendationBuffer'

export type RecommendationSource = LX.OnlineSource | 'all'

// Two platform jobs at a time; only bounded display candidates are retained.
export function useRecommendations(initialSource: RecommendationSource = 'all') {
  const source = ref<RecommendationSource>(initialSource)
  const playlists = shallowRef<ListInfoItem[]>([])
  const trending = shallowRef<LX.Music.MusicInfo[]>([])
  const discoveries = shallowRef<LX.Music.MusicInfo[]>([])
  const tags = shallowRef<TagInfoItem[]>([])
  const tagId = ref('')
  const page = ref(1)
  const hasNext = ref(false)
  const boardId = ref('')
  const boardName = ref('')
  const selectedArtist = ref('')
  const playlistLoading = ref(true)
  const trendingLoading = ref(true)
  const discoveryLoading = ref(false)
  const playlistError = ref('')
  const trendingError = ref('')
  const discoveryError = ref('')
  let playlistVersion = 0
  let tagVersion = 0
  let ready = false
  let active = true
  let running = 0
  const jobs: Array<{ run: () => Promise<void>, background: boolean, owner: RecommendationSource }> = []
  let backgroundRunning = 0
  const deadlines = new Map<ReturnType<typeof setTimeout>, () => void>()
  const artists = computed(() => {
    const counts = new Map<string, number>()
    for (const track of favoriteTracks.value.slice(-200)) {
      for (const name of track.singer.split(/[、&,，;；/|]/).map(value => value.trim()).filter(Boolean)) {
        if (name === '未知歌手') continue
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name)
  })
  const recommended = shallowRef<LX.Music.MusicInfo[]>([])
  const recommendationLoading = ref(true)
  const recommendationError = ref('')
  const history = getRecommendationHistory()
  void history.ready.catch(() => {})
  interface SourceContext {
    source: RecommendationSource
    candidates: LX.Music.MusicInfo[]
    tracks: LX.Music.MusicInfo[]
    preview: RecommendationBatch | null
    first: boolean
    round: number
    version: number
    loading: boolean
    error: string
    trending: LX.Music.MusicInfo[]
    discoveries: LX.Music.MusicInfo[]
    boardId: string
    boardName: string
    initial: Promise<RecommendationBatch | null> | null
    loadingTask: Promise<void> | null
    buffer: RecommendationBuffer
  }
  const contexts = new Map<RecommendationSource, SourceContext>()
  for (const platform of ['all', ...sources] as RecommendationSource[]) {
    const context: SourceContext = {
      source: platform,
      candidates: [],
      tracks: [],
      preview: null,
      first: true,
      round: 0,
      version: 0,
      loading: false,
      error: '',
      trending: [],
      discoveries: [],
      boardId: '',
      boardName: '',
      initial: null,
      loadingTask: null,
      buffer: new RecommendationBuffer({
        history: () => history.current.keys,
        prepare: async(excluded, valid, background) => prepareSongs(context, excluded, valid, background),
        commit: async batch => {
          if (!active || context.source !== source.value) throw new Error('已切换推荐平台。')
          context.tracks = batch.tracks; showContext(context)
          await history.record(batch.tracks, batch.round)
        },
        usable: batch => !batch.tracks.some(track => history.current.keys.includes(recommendationKey(track)) || favoriteTracks.value.some(saved => sameRecording(track, saved))),
      }),
    }
    contexts.set(platform, context)
  }
  const currentContext = () => contexts.get(source.value)!
  function showContext(context: SourceContext) {
    if (!active || context.source !== source.value) return
    recommended.value = context.tracks
    recommendationLoading.value = context.loading
    recommendationError.value = context.error
    trending.value = context.trending; discoveries.value = context.discoveries
    boardId.value = context.boardId; boardName.value = context.boardName
    trendingLoading.value = context.loading; discoveryLoading.value = context.loading
    trendingError.value = ''; discoveryError.value = ''
  }
  let warmTimer: ReturnType<typeof setTimeout> | undefined
  let warming = false
  let warmRequested = false
  function warmSongs() {
    warmRequested = true
    clearTimeout(warmTimer)
    warmTimer = setTimeout(() => { void warmSources() }, 150)
  }
  async function warmSources() {
    if (!active || warming) return
    warming = true
    warmRequested = false
    try {
      // Prepare the visible tab first, then each other tab with its own pool.
      const ordered = [currentContext(), ...[...contexts.values()].filter(context => context.source !== source.value)]
      for (const context of ordered) {
        if (!active) break
        if (context.loading) continue
        if (context.first && !context.preview) await firstSongs(context, true)
        if (active) await context.buffer.warm()
      }
    } finally { warming = false; if (active && warmRequested) warmSongs() }
  }
  watch(artists, names => {
    if (names.includes(selectedArtist.value)) return
    selectedArtist.value = names[0] ?? ''
  }, { immediate: true })
  watch(() => favoriteTracks.value.map(recommendationKey).sort().join('\n'), () => {
    for (const context of contexts.values()) context.buffer.reset()
    if (!ready) return
    warmSongs()
  })

  function pump() {
    while (running < 2 && jobs.length) {
      const index = jobs.findIndex(job => !job.background || job.owner === source.value)
      if (index < 0 && backgroundRunning) return
      const job = jobs.splice(index < 0 ? 0 : index, 1)[0]
      running++
      if (job.background) backgroundRunning++
      void job.run().finally(() => { running--; if (job.background) backgroundRunning--; pump() })
    }
  }
  async function bounded<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = () => { deadlines.delete(timer); reject(new Error('平台响应超时或页面已离开。')) }
      const timer = setTimeout(cancel, 12000)
      deadlines.set(timer, cancel)
      void Promise.resolve().then(task).then(resolve, reject).finally(() => { clearTimeout(timer); deadlines.delete(timer) })
    })
  }
  async function collect<T>(owner: RecommendationSource, read: (platform: LX.OnlineSource) => Promise<T[]>, valid: () => boolean, update: (items: T[]) => void, background = false, onGroup?: (items: T[]) => void) {
    const platforms = owner === 'all' ? [...sources] : [owner]
    const groups = new Map<LX.OnlineSource, T[]>()
    await Promise.allSettled(platforms.map(async platform => new Promise<void>(resolve => {
      jobs.push({
        background,
        owner,
        run: async() => {
          try {
            if (!valid()) return
            const result = await bounded(async() => read(platform))
            if (!valid()) return
            groups.set(platform, result)
            onGroup?.(result)
          } catch {} finally { resolve() }
        },
      })
      pump()
    })))
    const result = [...groups.values()].flat()
    if (valid()) update(result)
    return result
  }
  async function loadPlaylists() {
    const version = ++playlistVersion
    const mixed = source.value === 'all'
    const selectedTag = tagId.value
    const selectedPage = page.value
    const valid = () => active && version === playlistVersion
    playlistLoading.value = true
    playlistError.value = ''
    hasNext.value = false
    const items = await collect<ListInfoItem>(source.value, async platform => {
      const result = await music[platform]?.songList.getList(sortList[platform]?.[0]?.id ?? '', selectedTag, selectedPage)
      if (!result) throw new Error('这个平台暂时无法提供歌单。')
      if (valid()) hasNext.value ||= selectedPage * (result.limit || result.list.length || 30) < Number(result.total)
      return result.list.slice(0, 8)
    }, valid, list => { playlists.value = mixed ? randomMix(list, 8, (a, b) => a.source === b.source && a.id === b.id) : list.slice(0, 8) })
    if (!valid()) return
    if (!items.length) playlistError.value = '歌单暂时无法加载，可以重试或切换平台。'
    playlistLoading.value = false
  }
  async function loadTrending(context = currentContext(), background = false, onGroup?: (items: LX.Music.MusicInfo[]) => void) {
    const version = context.version
    const valid = () => active && version === context.version
    const round = context.round
    const items = await collect<LX.Music.MusicInfo>(context.source, async platform => {
      const boards = await getBoardsList(platform)
      if (!valid()) return []
      const board = boards?.list.find(item => (round % 2 ? /新歌|原创|飙升/ : /热歌|热榜|热播/).test(item.name)) ?? boards?.list[round % (boards?.list.length || 1)]
      if (!board) throw new Error('没有可用榜单。')
      const result = await getListDetail(board.id, 1)
      if (valid() && !context.boardId) { context.boardId = board.id; context.boardName = board.name }
      return result.list.slice(0, 120)
    }, valid, list => { context.trending = list; showContext(context) }, background, onGroup)
    return items
  }
  async function discoveryCandidates(platform: LX.OnlineSource, round: number) {
    const artist = artists.value.length ? artists.value[round % artists.value.length] : ''
    const related: LX.Music.MusicInfo[] = artist ? await music[platform]?.musicSearch.search(artist, 1 + round % 5, 30).then((result: { list: LX.Music.MusicInfo[] }) => result.list.map(track => toNewMusicInfo(track))).catch(() => []) ?? [] : []
    const relatedArtist = related.filter(track => recommendationArtists(track).some(name => recommendationArtists({ ...track, singer: artist }).includes(name)))
    const sorts = sortList[platform] ?? []
    const playlists = await music[platform]?.songList.getList(sorts[round % (sorts.length || 1)]?.id ?? '', '', 1 + (round + sources.indexOf(platform) * 3) % 12).catch(() => null)
    const choices = playlists?.list ?? []
    const choice = choices.length ? choices[round % choices.length] : null
    const broader = choice ? await getPlaylistDetail(choice.id, platform, 1).then(result => result.list.slice(0, 120)).catch(() => []) : []
    return [...relatedArtist, ...broader].filter(track => !favoriteTracks.value.some(saved => sameRecording(track, saved)))
  }
  async function loadDiscoveries(context = currentContext(), background = false, onGroup?: (items: LX.Music.MusicInfo[]) => void) {
    const version = context.version
    const valid = () => active && version === context.version
    const round = context.round
    return collect<LX.Music.MusicInfo>(context.source, async platform => discoveryCandidates(platform, round), valid, list => { context.discoveries = list; showContext(context) }, background, onGroup)
  }
  function retainCandidates(context: SourceContext, items: LX.Music.MusicInfo[]) {
    const seen = new Set<string>()
    context.candidates = items.filter(track => {
      if (context.source !== 'all' && track.source !== context.source) return false
      const key = recommendationKey(track); if (seen.has(key)) return false; seen.add(key); return true
    }).slice(0, context.source === 'all' ? 1500 : 500)
  }
  async function firstSongs(context: SourceContext, background = false) {
    if (context.preview) return context.preview
    if (context.initial) return context.initial
    const version = context.version
    const valid = () => active && version === context.version
    const round = ++context.round
    const task = new Promise<RecommendationBatch | null>(resolve => {
      let displayed = false
      const accept = (items: LX.Music.MusicInfo[]) => {
        if (!valid()) return
        retainCandidates(context, [...context.candidates, ...items])
        // Reuse fetched platform candidates without sharing buffers or selections.
        if (context.source === 'all') {
          for (const platform of sources) {
            const other = contexts.get(platform)!
            retainCandidates(other, [...other.candidates, ...items.filter(track => track.source === platform)])
          }
        }
        if (displayed || !items.length) return
        displayed = true
        context.preview = { tracks: randomMix(context.candidates, 9, (a, b) => a === b), round }
        resolve(context.preview)
      }
      if (context.candidates.length) accept(context.candidates)
      if (displayed) return
      // The first available platform can paint the page while the others finish.
      void Promise.allSettled([loadTrending(context, background, accept), loadDiscoveries(context, background, accept)]).then(() => {
        if (!displayed) resolve(null)
        else if (valid()) warmSongs()
      })
    }).finally(() => { if (context.initial === task) context.initial = null })
    context.initial = task
    return task
  }
  async function prepareSongs(context: SourceContext, excluded: string[], current: () => boolean, background: boolean) {
    const version = context.version
    const valid = () => active && version === context.version && current()
    await history.ready
    if (!valid()) return null
    context.round = Math.max(context.round, history.current.round) + 1
    if (!context.candidates.length && !background) {
      await Promise.all([loadTrending(context), loadDiscoveries(context)])
      if (!valid()) return null
      retainCandidates(context, [...context.discoveries, ...context.trending])
    }
    const blocked = () => [...excluded, ...history.current.keys, ...context.tracks.map(recommendationKey), ...(context.preview?.tracks.map(recommendationKey) ?? [])]
    let selection = freshRecommendations(context.candidates, favoriteTracks.value, blocked())
    for (let attempt = 0; selection.length < 9 && attempt < 2; attempt++) {
      const round = ++context.round
      const extra = await collect<LX.Music.MusicInfo>(context.source, async platform => discoveryCandidates(platform, round), valid, () => {}, background)
      if (!valid()) return null
      retainCandidates(context, [...extra, ...context.candidates])
      selection = freshRecommendations(context.candidates, favoriteTracks.value, blocked())
    }
    return selection.length && valid() ? { tracks: selection, round: context.round } : null
  }
  async function loadSongs() {
    const context = currentContext()
    if (context.loadingTask) return context.loadingTask
    const version = context.version
    const valid = () => active && version === context.version
    context.loading = true; context.error = ''; showContext(context)
    clearTimeout(warmTimer)
    const task = (async() => {
      try {
        const initial = context.first
        const batch = initial ? await firstSongs(context) : await context.buffer.next()
        if (!valid()) return
        if (!batch) throw new Error('这一批暂时没有新的推荐，换个平台或稍后再试。')
        if (initial && context.source !== source.value) return
        context.tracks = batch.tracks
        if (initial) { context.first = false; context.preview = null; showContext(context); await history.record(batch.tracks, batch.round, true) }
      } catch (error) { if (valid() && context.source === source.value) context.error = error instanceof Error ? error.message : '推荐暂时无法加载，请稍后重试。' } finally {
        context.loading = false
        showContext(context)
        if (valid()) warmSongs()
      }
    })().finally(() => { if (context.loadingTask === task) context.loadingTask = null })
    context.loadingTask = task
    return task
  }
  async function loadTags() {
    const version = ++tagVersion
    const platform = source.value
    if (platform === 'all') { tags.value = []; return }
    try {
      const result = await getTags(platform)
      if (active && version === tagVersion) tags.value = result.hotTag.slice(0, 6)
    } catch { if (active && version === tagVersion) tags.value = [] }
  }
  function loadAll() {
    clearTimeout(warmTimer)
    playlists.value = []; tags.value = []
    const context = currentContext()
    showContext(context)
    if (!context.tracks.length) void loadSongs()
    else warmSongs()
    pump()
    void loadPlaylists(); void loadTags()
  }
  function selectSource(value: RecommendationSource) {
    if (value === source.value) return
    source.value = value; tagId.value = ''; page.value = 1; loadAll()
  }
  function selectTag(value: string) { tagId.value = value; page.value = 1; void loadPlaylists() }
  function nextPlaylists() { page.value = hasNext.value ? page.value + 1 : 1; void loadPlaylists() }
  onMounted(async() => {
    if (initialSource !== 'all') {
      const saved = await getSongListSetting().catch(() => null)
      if (!active) return
      if (saved?.source && sources.includes(saved.source as LX.OnlineSource)) source.value = saved.source as LX.OnlineSource
    }
    ready = true
    loadAll()
  })
  onUnmounted(() => {
    active = false; playlistVersion++; tagVersion++
    for (const context of contexts.values()) { context.version++; context.buffer.reset(); context.candidates = []; context.preview = null }
    clearTimeout(warmTimer)
    for (const [timer, cancel] of deadlines) { clearTimeout(timer); cancel() }
    deadlines.clear()
  })
  return { loadSongs, recommendationLoading, recommendationError, sources, source, playlists, trending, discoveries, recommended, tags, tagId, boardId, boardName, selectedArtist, playlistLoading, trendingLoading, discoveryLoading, playlistError, trendingError, discoveryError, selectSource, selectTag, nextPlaylists, loadPlaylists, loadTrending, loadDiscoveries }
}
