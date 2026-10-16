type SongRecord = Record<string, any>

const record = (value: unknown): SongRecord => value != null && typeof value === 'object' && !Array.isArray(value) ? value as SongRecord : {}
const flag = (value: unknown): boolean | undefined => {
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  return undefined
}
const firstFlag = (...values: unknown[]): boolean | undefined => {
  for (const value of values) {
    const result = flag(value)
    if (result != null) return result
  }
  return undefined
}
const jsonRecord = (value: unknown): SongRecord => {
  if (typeof value !== 'string') return record(value)
  try { return record(JSON.parse(value)) } catch { return {} }
}

/** Song-level membership metadata only. Quality/download privileges do not make a song VIP. */
export const songVip = (source: string, value: unknown, privilege?: unknown): boolean | undefined => {
  const song = record(value)
  const saved = firstFlag(record(song.meta).isVip, song.isVip)
  if (saved != null) return saved
  switch (source) {
    case 'wy': {
      const fee = song.fee ?? record(privilege).fee ?? record(song.privilege).fee
      if (fee == null || fee === '') return undefined
      // 8 allows free standard playback; 4 is a separately purchased digital release.
      return Number(fee) === 1 ? true : [0, 4, 8].includes(Number(fee)) ? false : undefined
    }
    case 'tx':
      return firstFlag(record(song.pay).pay_play, song.pay_play)
    case 'kg': {
      // Base-file privileges only. HQ/SQ privileges describe higher quality, not the song.
      const access = song.Privilege ?? song.privilege ?? record(song.audio_info).privilege
      if (access != null && typeof access !== 'object') {
        const code = Number(access)
        if (code === 8 || code === 10) return true
        if (code === 0) return false
      }
      return firstFlag(song.is_vip, song.isVipSong)
    }
    case 'kw': {
      const access = jsonRecord(song.payInfo ?? song.PAYINFO)
      const membership = flag(record(access.feeType).vip)
      const play = String(access.play ?? '')
      // The first bit is the standard stream. A paid HQ stream alone is not VIP playback.
      if (/^[01]+$/.test(play)) return play[0] === '1' && membership !== false
      return firstFlag(song.isListenFee, song.islistenfee, membership)
    }
    case 'mg':
      return firstFlag(song.isVip, song.isVIP, song.isVipSong, song.vipFlag)
    case 'qs':
      return firstFlag(record(song.label_info).only_vip_playable, song.only_vip_playable, song.onlyVip, song.is_vip)
    default:
      return undefined
  }
}
