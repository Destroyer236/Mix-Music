type Json = Record<string, any>
const object = (value: unknown): Json => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const flag = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true'
const marker = (value: unknown) => value != null && String(value).trim() !== '' && value !== false && value !== 0 && value !== '0' && value !== 'false'
const first = (value: Json, keys: string[]) => keys.map(key => value[key]).find(item => item != null)

export interface AudioStream {
  urls: string[]
  duration: number
  protected: boolean
  preview: boolean
  quality: string
  bitrate: number
}

export function protectedAudio(node: Json): boolean {
  return [node, object(node.encrypt_info), object(node.EncryptInfo), object(node.encryptInfo)].some(info =>
    ['encrypt', 'encrypted', 'is_encrypted', 'Encrypt', 'Encrypted'].some(key => flag(info[key])) ||
    ['kid', 'Kid', 'play_auth', 'PlayAuth', 'PlayAuthID', 'spade_a', 'SpadeA', 'spadeA', 'EncryptionMethod'].some(key => marker(info[key])),
  )
}

const qualityOrder: Record<string, number> = { master: 8, lossless: 7, original: 6, highest: 5, higher: 4, high: 3, medium: 2, low: 1 }
export const streamQuality = (quality: string): number => qualityOrder[quality.toLowerCase()] ?? 0

// Official web responses use both lists and nested quality maps, and may
// encode video_model as JSON more than once. Never execute player scripts.
export function audioStreams(value: unknown): AudioStream[] {
  const streams: AudioStream[] = []
  let remaining = 1000
  const visit = (value: unknown, inherited: Omit<AudioStream, 'urls'>, hint = '', depth = 0) => {
    if (depth > 12 || --remaining < 0 || streams.length >= 24) return
    for (let layer = 0; typeof value === 'string' && layer < 3; layer++) {
      if (value.length > 4_000_000) return
      try { value = JSON.parse(value) } catch { return }
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child, inherited, hint, depth + 1)
      return
    }
    const node = object(value)
    const meta = object(node.video_meta)
    const duration = [node.video_duration, node.duration, node.Duration, meta.duration, meta.Duration, inherited.duration].map(Number).find(duration => Number.isFinite(duration) && duration > 0) ?? 0
    const state = {
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      protected: inherited.protected || protectedAudio(node) || protectedAudio(meta),
      preview: inherited.preview || [node.is_preview, node.IsPreview, node.is_trial].some(flag),
      quality: String(first(node, ['quality', 'Quality', 'definition', 'Definition']) ?? first(meta, ['quality', 'Quality']) ?? (streamQuality(hint) ? hint : inherited.quality)),
      bitrate: Number(first(node, ['bitrate', 'Bitrate', 'bit_rate']) ?? first(meta, ['bitrate', 'real_bitrate']) ?? inherited.bitrate) || 0,
    }
    const urls: string[] = []
    for (const key of ['main_play_url', 'MainPlayUrl', 'main_url', 'MainUrl', 'url', 'URL', 'play_url', 'PlayURL', 'backup_play_url', 'BackupPlayUrl', 'backup_url', 'BackupUrl', 'backup_url_1', 'backup_url_2', 'backup_url_3', 'backup_urls', 'backupUrls', 'url_list', 'UrlList']) {
      const field = node[key]
      for (const url of Array.isArray(field) ? field : [field]) {
        if (typeof url === 'string' && url.startsWith('https://') && !urls.includes(url)) urls.push(url)
      }
    }
    if (urls.length) streams.push({ ...state, urls: urls.slice(0, 4) })
    for (const [key, child] of Object.entries(node)) {
      if (child != null && (typeof child === 'object' || typeof child === 'string')) visit(child, state, key, depth + 1)
    }
  }
  visit(value, { duration: 0, protected: false, preview: false, quality: '', bitrate: 0 })
  return streams
}
