export interface LyricWord {
  text: string
  start: number
  duration: number
}

export function parseTimedLyricText(source: string | null): Map<number, string> {
  const result = new Map<number, string>()
  for (const line of (source ?? '').split(/\r?\n|\r/)) {
    const match = /^((?:\[\d+(?::\d+){0,2}(?:\.\d+)?\])+)(.*)$/.exec(line.trim())
    if (!match) continue
    const text = match[2].replace(/<\d+,\d+>/g, '').trim()
    if (!text || text === '//') continue
    for (const stamp of match[1].matchAll(/\[([\d:.]+)\]/g)) {
      const time = Math.round(stamp[1].split(':').reduce((total, part) => total * 60 + Number(part), 0) * 1000)
      if (Number.isFinite(time)) result.set(time, result.has(time) ? `${result.get(time)!}\n${text}` : text)
    }
  }
  return result
}

export interface CopyLyricLine {
  text: string
  translation: string
  romanization: string
}

export interface CopyLyricOptions {
  original: boolean
  translation: boolean
  romanization: boolean
  songName: boolean
  artist: boolean
  emptyLine: boolean
}

export function composeLyricCopy(lines: CopyLyricLine[], options: CopyLyricOptions, name: string, singer: string): string {
  const separator = options.emptyLine ? '\n\n' : '\n'
  const content = lines.map(line => [options.original ? line.text : '', options.translation ? line.translation : '', options.romanization ? line.romanization : ''].filter(Boolean).join('\n')).filter(Boolean)
  const metadata = [options.songName && name ? `《${name}》` : '', options.artist ? singer : ''].filter(Boolean).join(' - ')
  if (metadata) content.push(`—— ${metadata}`)
  return content.join(separator)
}

/** LinkLine's normalized LX lyric format stores each word relative to its line. */
export function parseLyricWords(source: string | null): Map<number, LyricWord[]> {
  const result = new Map<number, LyricWord[]>()
  for (const line of (source ?? '').split(/\r?\n|\r/)) {
    const stamp = /^((?:\[\d+(?::\d+){0,2}(?:\.\d+)?\])+)(.*)$/.exec(line.trim())
    if (!stamp) continue
    const words = Array.from(stamp[2].matchAll(/<(\d+),(\d+)>([^<]*)/g), match => ({
      text: match[3], start: Number(match[1]), duration: Number(match[2]),
    }))
    if (!words.length) continue
    for (const match of stamp[1].matchAll(/\[([\d:.]+)\]/g)) {
      const seconds = match[1].split(':').reduce((total, part) => total * 60 + Number(part), 0)
      if (Number.isFinite(seconds)) result.set(Math.round(seconds * 1000), words)
    }
  }
  return result
}

export function wordProgress(word: LyricWord, elapsed: number): number {
  if (elapsed < word.start) return 0
  if (word.duration <= 0) return 1
  return Math.max(0, Math.min(1, (elapsed - word.start) / word.duration))
}

export function lyricSeekTime(lineTime: number, offset: number, duration: number): number {
  const seconds = Math.max(0, (lineTime - offset) / 1000)
  return duration > 0 ? Math.min(duration, seconds) : seconds
}
