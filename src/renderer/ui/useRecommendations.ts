import { computed, effectScope, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import music from '@renderer/utils/musicSdk'
import { toNewMusicInfo } from '@renderer/utils'
import { sameRecording } from '@common/platformMatching'
import { sortList, type ListInfoItem, type TagInfoItem } from '@renderer/store/songList/state'
import { getListDetail as getPlaylistDetail, getTags } from '@renderer/store/songList/action'
import { getBoardsList, getListDetail } from '@renderer/store/leaderboard/action'
import { getSongListSetting } from '@renderer/utils/data'
import { favoriteTracks } from './services/platformAccounts'
import { freshRecommendations, randomMix, recommendationArtists, recommendationKey, recommendationPreferences, normalizeRecommendationArtist } from './recommendationMix'
import { getRecommendationHistory } from './recommendationHistory'
import { RecommendationBuffer, type RecommendationBatch } from './recommendationBuffer'
import { musicLinksFile } from './useMusicLinks'
import { isPlay, playMusicInfo } from '@renderer/store/player/state'
import { dislikeRulesVersion } from '@renderer/store/dislikeList'
import { isRecommendationDisliked } from './recommendationDislikes'

export type RecommendationSource = LX.OnlineSource | 'all'
const sources = music.sources
  .filter(item => Boolean(music[item.id as LX.OnlineSource]?.musicSearch?.search))
  .map(item => item.id as LX.OnlineSource)

// Two platform jobs at a time; only bounded display candidates are retained.
function createRecommendations() {
  const source = ref<RecommendationSource>('all')
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
  let viewers = 0
  let fastAvailable = true
  let playbackReserved: () => string[] = () => []
  let running = 0
  const jobs: Array<{ run: () => Promise<void>, background: boolean, owner: RecommendationSource, priority: number }> = []
  let backgroundRunning = 0
  const recent = shallowRef<Array<{ name: string, singer: string }>>([])
  void musicLinksFile.ready.then(data => { recent.value = data.recent }, () => {})
  watch(() => [isPlay.value, playMusicInfo.musicInfo] as const, ([playing, original]) => {
    if (!playing || !original) return
    const track = 'metadata' in original ? original.metadata.musicInfo : original
    recent.value = [track, ...recent.value.filter(item => recommendationKey(item) !== recommendationKey(track))].slice(0, 100)
  })
  const preferences = computed(() => recommendationPreferences(favoriteTracks.value.filter(track => !isRecommendationDisliked(track)), recent.value.filter(track => !isRecommendationDisliked(track))))
  const artists = computed(() => preferences.value.seeds)
  const affinity = new Map<string, number>()
  const score = (track: LX.Music.MusicInfo) => preferences.value.score(track) + (affinity.get(recommendationKey(track)) ?? 0)
  const selectRecommendations = (items: LX.Music.MusicInfo[], excluded: string[], rank = score) => freshRecommendations(items.filter(track => !isRecommendationDisliked(track)), favoriteTracks.value, excluded, 9, rank)
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
    displayVersion: number
    playbackRequests: number
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
      displayVersion: 0,
      playbackRequests: 0,
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
        commit: async batch => commitDisplay(context, batch, () => true),
        usable: batch => usable(context, batch),
        repair: (batch, excluded) => {
          const cached = new Set(batch.tracks.map(recommendationKey))
          const tracks = selectRecommendations([...batch.tracks, ...context.candidates], [...excluded, ...reserved(context)], track => score(track) + (cached.has(recommendationKey(track)) ? 10 : 0))
          return tracks.length ? { tracks, round: batch.round } : null
        },
      }),
    }
    contexts.set(platform, context)
  }
  const currentContext = () => contexts.get(source.value)!
  async function commitDisplay(context: SourceContext, batch: RecommendationBatch, valid: () => boolean) {
    await history.record(batch.tracks, batch.round, false, () => {
      if (!viewers || !valid() || context.source !== source.value || !usable(context, batch)) return false
      context.tracks = batch.tracks; context.first = false; showContext(context)
      return true
    })
  }
  function reserved(context: SourceContext) {
    return [...playbackReserved(), ...[...contexts.values()].flatMap(other => [
      ...other.tracks.map(recommendationKey),
      ...(other.preview?.tracks.map(recommendationKey) ?? []),
      ...(other === context ? [] : other.buffer.reserved),
    ])]
  }
  function usable(context: SourceContext, batch: RecommendationBatch) {
    const blocked = new Set([...history.current.keys, ...reserved(context), ...favoriteTracks.value.map(recommendationKey)])
    const familiar = new Set(favoriteTracks.value.flatMap(recommendationArtists))
    const names = new Set<string>()
    const songs = new Set<string>()
    let outside = 0
    for (const track of batch.tracks) {
      const key = recommendationKey(track)
      const artists = recommendationArtists(track)
      if (isRecommendationDisliked(track) || blocked.has(key) || songs.has(key) || !artists.length || artists.some(name => names.has(name))) return false
      songs.add(key); artists.forEach(name => names.add(name))
      if (artists.every(name => !familiar.has(name))) outside++
    }
    return outside >= Math.ceil(batch.tracks.length * 0.2)
  }
  function showContext(context: SourceContext) {
    if (context.source !== source.value) return
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
    if (warming) return
    warming = true
    warmRequested = false
    try {
      // Give every tab one batch before filling second and third slots. Re-read
      // the visible source between jobs so switching tabs changes priority.
      for (let target = 1; target <= 3; target++) {
        const pending = new Set(contexts.values())
        while (pending.size) {
          const context = pending.has(currentContext()) ? currentContext() : [...pending].sort((a, b) => a.buffer.size - b.buffer.size)[0]
          pending.delete(context)
          if (!context.loading) await context.buffer.warm(target)
        }
      }
    } finally { warming = false; if (warmRequested) warmSongs() }
  }
  watch(artists, names => {
    if (names.includes(selectedArtist.value)) return
    selectedArtist.value = names[0] ?? ''
  }, { immediate: true })
  watch(() => favoriteTracks.value.map(recommendationKey).sort().join('\n'), () => {
    for (const context of contexts.values()) context.buffer.refresh()
    if (!ready) return
    warmSongs()
  })
  watch(dislikeRulesVersion, () => {
    for (const context of contexts.values()) {
      context.candidates = context.candidates.filter(track => !isRecommendationDisliked(track))
      context.tracks = context.tracks.filter(track => !isRecommendationDisliked(track))
      if (context.preview) context.preview.tracks = context.preview.tracks.filter(track => !isRecommendationDisliked(track))
      context.buffer.refresh()
    }
    showContext(currentContext())
    if (ready) {
      warmSongs()
      if (viewers && !currentContext().tracks.length) void loadSongs()
    }
  }, { flush: 'sync' })

  function pump() {
    while (running < 2 && jobs.length) {
      const urgent = (job: typeof jobs[number]) => Boolean(contexts.get(job.owner)?.playbackRequests) || (Boolean(contexts.get(job.owner)?.loading) && job.owner === source.value)
      const eligible = jobs.filter(job => !job.background || urgent(job) || backgroundRunning === 0)
      if (!eligible.length) return
      eligible.sort((a, b) => (urgent(a) ? 0 : a.priority) - (urgent(b) ? 0 : b.priority) || Number(b.owner === source.value) - Number(a.owner === source.value))
      const job = eligible[0]
      jobs.splice(jobs.indexOf(job), 1)
      running++
      if (job.background) backgroundRunning++
      void job.run().finally(() => { running--; if (job.background) backgroundRunning--; pump() })
    }
  }
  async function bounded<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = () => { reject(new Error('平台响应超时。')) }
      const timer = setTimeout(cancel, 8000)
      void Promise.resolve().then(task).then(resolve, reject).finally(() => { clearTimeout(timer) })
    })
  }
  async function collect<T>(owner: RecommendationSource, read: (platform: LX.OnlineSource) => Promise<T[]>, valid: () => boolean, update: (items: T[]) => void, background = false, onGroup?: (items: T[]) => void, enough?: () => boolean, priority = 0) {
    const platforms = owner === 'all' ? [...sources] : [owner]
    const groups = new Map<LX.OnlineSource, T[]>()
    let finished = false
    let finish: () => void
    const completion = new Promise<void>(resolve => { finish = () => { if (!finished) { finished = true; resolve() } } })
    void Promise.allSettled(platforms.map(async platform => new Promise<void>(resolve => {
      jobs.push({
        background,
        owner,
        priority: background ? 2 : priority,
        run: async() => {
          try {
            if (!valid() || finished) return
            const result = await bounded(async() => read(platform))
            if (!valid() || finished) return
            groups.set(platform, result)
            onGroup?.(result)
            if (enough?.()) finish()
          } catch {} finally { resolve() }
        },
      })
      pump()
    }))).then(() => { finish() })
    await completion
    const result = [...groups.values()].flat()
    if (valid()) update(result)
    return result
  }
  async function loadPlaylists() {
    const version = ++playlistVersion
    const mixed = source.value === 'all'
    const selectedTag = tagId.value
    const selectedPage = page.value
    const valid = () => version === playlistVersion
    playlistLoading.value = true
    playlistError.value = ''
    hasNext.value = false
    const items = await collect<ListInfoItem>(source.value, async platform => {
      const sorts = sortList[platform] ?? []
      const result = sorts.length
        ? await music[platform]?.songList.getList(sorts[0]?.id ?? '', selectedTag, selectedPage)
        : await music[platform]?.songList.search('热门歌单', selectedPage)
      if (!result) throw new Error('这个平台暂时无法提供歌单。')
      if (valid()) hasNext.value ||= selectedPage * (result.limit || result.list.length || 30) < Number(result.total)
      return result.list.slice(0, 8)
    }, valid, list => { playlists.value = mixed ? randomMix(list, 8, (a, b) => a.source === b.source && a.id === b.id) : list.slice(0, 8) }, false, undefined, undefined, 1)
    if (!valid()) return
    if (!items.length) playlistError.value = '歌单暂时无法加载，可以重试或切换平台。'
    playlistLoading.value = false
  }
  async function loadTrending(context = currentContext(), background = false, onGroup?: (items: LX.Music.MusicInfo[]) => void) {
    const version = context.version
    const valid = () => version === context.version
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
  async function discoveryCandidates(platform: LX.OnlineSource, round: number): Promise<LX.Music.MusicInfo[]> {
    const seeds = artists.value
    const offset = (round * 2 + sources.indexOf(platform) * 3) % (seeds.length || 1)
    const selected = [...new Set([seeds[offset], seeds[(offset + 1) % (seeds.length || 1)]].filter(Boolean))]
    const searches: Array<Promise<LX.Music.MusicInfo[]>> = selected.map(async artist => {
      const result: { list: LX.Music.MusicInfo[] } | null | undefined = await music[platform]?.musicSearch.search(artist, 1 + Math.floor(round / Math.max(1, seeds.length)) % 4, 30).catch(() => null)
      const key = normalizeRecommendationArtist(artist)
      return (result?.list ?? []).map((track: LX.Music.MusicInfo) => toNewMusicInfo(track)).filter((track: LX.Music.MusicInfo) => recommendationArtists(track).includes(key))
    })
    const broader = (async() => {
      const sorts = sortList[platform] ?? []
      const playlists = sorts.length
        ? await music[platform]?.songList.getList(sorts[round % sorts.length]?.id ?? '', '', 1 + (round + sources.indexOf(platform) * 3) % 12).catch(() => null)
        : await music[platform]?.songList.search('热门歌单', 1 + (round + sources.indexOf(platform) * 3) % 4).catch(() => null)
      const choices = playlists?.list ?? []
      const choice = choices.length ? choices[round % choices.length] : null
      const tracks = choice ? await getPlaylistDetail(choice.id, platform, 1).then(result => result.list.slice(0, 120)).catch(() => []) : []
      const familiar = new Set(favoriteTracks.value.flatMap(recommendationArtists))
      // Co-occurrence in a playlist is a weak taste signal for new artists,
      // rather than treating every unfamiliar artist as equally relevant.
      if (tracks.some(track => recommendationArtists(track).some(name => familiar.has(name)))) {
        for (const track of tracks) affinity.set(recommendationKey(track), 1.5)
        while (affinity.size > 3000) affinity.delete(affinity.keys().next().value!)
      }
      return tracks
    })()
    return (await Promise.all([...searches, broader])).flat().filter(track => !favoriteTracks.value.some(saved => sameRecording(track, saved)))
  }
  async function loadDiscoveries(context = currentContext(), background = false, onGroup?: (items: LX.Music.MusicInfo[]) => void) {
    const version = context.version
    const valid = () => version === context.version
    const round = context.round
    return collect<LX.Music.MusicInfo>(context.source, async platform => discoveryCandidates(platform, round), valid, list => { context.discoveries = list; showContext(context) }, background, onGroup)
  }
  function retainCandidates(context: SourceContext, items: LX.Music.MusicInfo[]) {
    const seen = new Set<string>()
    context.candidates = items.filter(track => {
      if (isRecommendationDisliked(track)) return false
      if (context.source !== 'all' && track.source !== context.source) return false
      const key = recommendationKey(track); if (seen.has(key)) return false; seen.add(key); return true
    }).slice(0, context.source === 'all' ? 1500 : 500)
  }
  async function firstSongs(context: SourceContext, background = false) {
    if (context.preview) return context.preview
    if (context.initial) return context.initial
    const version = context.version
    const valid = () => version === context.version
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
        const favorites = new Set(favoriteTracks.value.map(recommendationKey))
        context.preview = { tracks: randomMix(context.candidates.filter(track => !favorites.has(recommendationKey(track))), 9, (a, b) => recommendationKey(a) === recommendationKey(b)), round }
        if (!context.preview.tracks.length) { displayed = false; context.preview = null; return }
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
    const valid = () => version === context.version && current()
    await history.ready
    if (!valid()) return null
    context.round = Math.max(context.round, history.current.round) + 1
    if (context.source === 'all') retainCandidates(context, [...context.candidates, ...[...contexts.values()].flatMap(other => other.candidates)])
    const blocked = () => [...excluded, ...history.current.keys, ...reserved(context)]
    let selection = selectRecommendations(context.candidates, blocked())
    for (let attempt = 0; selection.length < 9 && attempt < 2; attempt++) {
      const round = ++context.round
      const accept = (items: LX.Music.MusicInfo[]) => {
        retainCandidates(context, [...items, ...context.candidates])
        selection = selectRecommendations(context.candidates, blocked())
      }
      await collect<LX.Music.MusicInfo>(context.source, async platform => {
        const items = await discoveryCandidates(platform, round)
        if (items.length || context.candidates.length) return items
        const boards = await getBoardsList(platform)
        const board = boards?.list[round % (boards.list.length || 1)]
        return board ? (await getListDetail(board.id, 1)).list.slice(0, 120) : []
      }, valid, () => {}, background, accept, () => selection.length === 9)
      if (!valid()) return null
    }
    return selection.length && valid() ? { tracks: selection, round: context.round } : null
  }
  async function loadSongs() {
    const context = currentContext()
    if (context.loadingTask) return context.loadingTask
    const version = context.displayVersion
    const valid = () => version === context.displayVersion
    context.loading = true; context.error = ''; showContext(context)
    clearTimeout(warmTimer)
    const task = (async() => {
      try {
        const initial = context.first && fastAvailable
        if (initial) fastAvailable = false
        const batch = initial ? await firstSongs(context) : await context.buffer.next(async batch => commitDisplay(context, batch, valid))
        if (!valid()) { if (initial && context.preview === batch) context.preview = null; return }
        if (!batch) throw new Error('这一批暂时没有新的推荐，换个平台或稍后再试。')
        if (initial && context.source !== source.value) { context.preview = null; return }
        if (initial) {
          await history.record(batch.tracks, batch.round, true, () => {
            if (!viewers || !valid() || context.source !== source.value || !batch.tracks.length || batch.tracks.some(isRecommendationDisliked)) { context.preview = null; return false }
            context.tracks = batch.tracks; context.first = false; context.preview = null; showContext(context)
            return true
          })
        }
      } catch (error) { if (valid() && context.source === source.value) context.error = error instanceof Error ? error.message : '推荐暂时无法加载，请稍后重试。' } finally {
        if (valid()) { context.loading = false; showContext(context) }
        if (valid()) warmSongs()
      }
    })().finally(() => { if (context.loadingTask === task) context.loadingTask = null })
    context.loadingTask = task
    return task
  }
  function setPlaybackReservation(reserved: () => string[]) { playbackReserved = reserved }
  async function nextForPlayback(platform: RecommendationSource, valid: () => boolean, append: (tracks: LX.Music.MusicInfo[], eligible: () => boolean) => Promise<boolean>) {
    const context = contexts.get(platform)!
    context.playbackRequests++
    pump()
    try {
      const batch = await context.buffer.next(async batch => {
        await history.record(batch.tracks, batch.round, false, async() => {
          if (!valid() || !usable(context, batch)) return false
          return append(batch.tracks, () => valid() && usable(context, batch))
        })
      })
      return Boolean(batch && valid())
    } finally {
      context.playbackRequests--
      warmSongs()
    }
  }
  async function loadTags() {
    const version = ++tagVersion
    const platform = source.value
    if (platform === 'all' || !(sortList[platform]?.length)) { tags.value = []; return }
    try {
      const result = await getTags(platform)
      if (version === tagVersion) tags.value = result.hotTag.slice(0, 6)
    } catch { if (version === tagVersion) tags.value = [] }
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
    cancelForeground(currentContext())
    source.value = value; tagId.value = ''; page.value = 1; loadAll()
  }
  function selectTag(value: string) { tagId.value = value; page.value = 1; void loadPlaylists() }
  function nextPlaylists() { page.value = hasNext.value ? page.value + 1 : 1; void loadPlaylists() }
  function cancelForeground(context: SourceContext) {
    if (!context.loading) return
    // Cancelling a view must not invalidate a batch being delivered to playback.
    context.displayVersion++
    context.loading = false; context.loadingTask = null
  }
  function attach(initialSource: RecommendationSource) { viewers++; void start(initialSource) }
  function detach() {
    viewers = Math.max(0, viewers - 1)
    if (!viewers) for (const context of contexts.values()) cancelForeground(context)
  }
  async function start(initialSource: RecommendationSource) {
    if (!ready && initialSource !== 'all') {
      const saved = await getSongListSetting().catch(() => null)
      if (saved?.source && sources.includes(saved.source as LX.OnlineSource)) source.value = saved.source as LX.OnlineSource
    }
    if (ready) {
      const context = currentContext()
      showContext(context)
      if (!context.tracks.length) void loadSongs()
      else warmSongs()
      return
    }
    ready = true
    loadAll()
  }
  return { attach, detach, loadSongs, nextForPlayback, setPlaybackReservation, recommendationLoading, recommendationError, sources, source, playlists, trending, discoveries, recommended, tags, tagId, boardId, boardName, selectedArtist, playlistLoading, trendingLoading, discoveryLoading, playlistError, trendingError, discoveryError, selectSource, selectTag, nextPlaylists, loadPlaylists, loadTrending, loadDiscoveries }
}

// The six bounded pools and their prepared batches live for this app session,
// independently of router view mounts. Only the first display gets the fast path.
let sharedRecommendations: ReturnType<typeof createRecommendations> | undefined
export function getRecommendations() {
  return sharedRecommendations ??= effectScope(true).run(createRecommendations)!
}
export function useRecommendations(initialSource: RecommendationSource = 'all') {
  const state = getRecommendations()
  onMounted(() => { state.attach(initialSource) })
  onUnmounted(state.detach)
  return state
}
