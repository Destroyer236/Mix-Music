import { watch } from 'vue'
import { LIST_IDS } from '@common/constants'
import { setQueueContinuation } from '@renderer/core/player/queueContinuation'
import { addListMusics, getListMusicsFromCache, mutateTempList, removeListMusics } from '@renderer/store/list/action'
import { tempListMeta } from '@renderer/store/list/state'
import { isPlay, playedList, playInfo, playMusicInfo } from '@renderer/store/player/state'
import { removePlayedList, updatePlayIndex } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { recommendationKey } from '../recommendationMix'
import { getRecommendations, type RecommendationSource } from '../useRecommendations'
import { isRecommendationDisliked } from '../recommendationDislikes'

/** A recommendation session owns its source even after the user changes pages. */
export function startRecommendationPlayback(source: RecommendationSource, queueId: string) {
  const recommendations = getRecommendations()
  const seen = new Set<string>()
  let disposed = false
  let pending: Promise<void> | null = null
  let retryAt = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const valid = () => !disposed && playInfo.playerListId === LIST_IDS.TEMP && tempListMeta.id === queueId
  const tracks = () => getListMusicsFromCache(LIST_IDS.TEMP)
  const current = () => tracks()[playInfo.playerPlayIndex]
  const remember = () => {
    const track = current()
    if (track && !playMusicInfo.isTempPlay) seen.add(recommendationKey(track))
  }
  const remaining = () => appSetting['player.togglePlayMethod'] === 'random'
    ? tracks().filter(track => !isRecommendationDisliked(track) && !seen.has(recommendationKey(track))).length
    : tracks().slice(playInfo.playerPlayIndex + 1).filter(track => !isRecommendationDisliked(track)).length

  async function trim() {
    const list = tracks()
    if (list.length <= 90) return
    const track = current()
    const removable = appSetting['player.togglePlayMethod'] === 'random'
      ? list.filter(item => item !== track && seen.has(recommendationKey(item)))
      : list.slice(0, Math.max(0, playInfo.playerPlayIndex - 20))
    const ids = removable.slice(0, list.length - 90).map(item => item.id)
    if (!ids.length || !valid()) return
    await removeListMusics({ listId: LIST_IDS.TEMP, ids })
    if (!valid()) return
    updatePlayIndex()
    const retained = new Set(tracks().map(recommendationKey))
    for (const key of seen) if (!retained.has(key)) seen.delete(key)
    for (let index = playedList.length - 1; index >= 0; index--) {
      const item = playedList[index]
      if (item.listId === LIST_IDS.TEMP && ids.includes(item.musicInfo.id)) removePlayedList(index)
    }
  }

  function retry() {
    retryAt = Date.now() + 5000
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      if (valid() && isPlay.value) void ensure()
    }, 5000)
  }

  async function ensure(manual = false): Promise<boolean> {
    if (!valid()) return true
    remember()
    if (!manual && ['singleLoop', 'none'].includes(appSetting['player.togglePlayMethod'])) return true
    if (remaining() > 3) return true
    if (!pending && (manual || Date.now() >= retryAt)) {
      const task = recommendations.nextForPlayback(source, valid, async(batch, eligible = valid) => mutateTempList(async() => {
        if (!valid() || !eligible()) return false
        const existing = new Set(tracks().map(recommendationKey))
        // The entire batch must remain valid so artist and discovery quotas hold.
        if (batch.some(track => existing.has(recommendationKey(track)))) return false
        await addListMusics(LIST_IDS.TEMP, batch, 'bottom')
        if (!valid()) return false
        // Trimming is housekeeping; failure must not put a delivered batch back.
        await trim().catch(() => {})
        return true
      })).then(delivered => {
        if (!valid()) return
        if (delivered) { retryAt = 0; clearTimeout(retryTimer) } else retry()
      }, () => { if (valid()) retry() }).finally(() => { if (pending === task) pending = null })
      pending = task
    }
    // Fetch in the background while there is music left. At the boundary, wait
    // for delivery instead of wrapping to the first song of the original batch.
    if (remaining() > 0) return true
    await pending
    return !valid() || remaining() > 0
  }

  const notify = () => { if (valid()) { remember(); void ensure() } }
  const stopModeWatch = watch(() => appSetting['player.togglePlayMethod'], notify)
  setQueueContinuation({
    valid,
    notify,
    ensure,
    filter: list => appSetting['player.togglePlayMethod'] === 'random' ? list.filter(track => !seen.has(recommendationKey('metadata' in track ? track.metadata.musicInfo : track))) : list,
    excludes: track => isRecommendationDisliked('metadata' in track ? track.metadata.musicInfo : track),
    dispose: () => {
      disposed = true
      clearTimeout(retryTimer)
      stopModeWatch()
      recommendations.setPlaybackReservation(() => [])
    },
  })
  recommendations.setPlaybackReservation(() => valid() ? tracks().map(recommendationKey) : [])
}
