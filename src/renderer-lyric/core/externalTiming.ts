/** Timed lyric primitives for LinkLine's external lyric windows. */
export interface LyricWord { text: string, start: number, end: number }
export interface ExternalLine { text: string, start: number, end: number, words: LyricWord[], translation: string, timed: boolean }

const timeToMs = (label: string) => label.split(':').reduce((value, part) => value * 60 + Number(part), 0) * 1000

export function parseExternalLyric(source: string, translation = ''): ExternalLine[] {
  const entries = new Map<number, ExternalLine>()
  const read = (value: string, translated: boolean) => {
    for (const row of value.split(/\r?\n|\r/)) {
      const labels = row.match(/^(?:\[\d+(?::\d+){1,2}(?:\.\d+)?\])+/)?.[0]
      if (!labels) continue
      const content = row.slice(labels.length).trim()
      if (!content || content === '//') continue
      for (const label of labels.matchAll(/\[([^\]]+)\]/g)) {
        const start = timeToMs(label[1])
        if (!Number.isFinite(start)) continue
        if (translated) {
          // Providers occasionally differ in timestamp precision by a few milliseconds.
          const target = entries.get(start) ?? [...entries.values()].find(line => Math.abs(line.start - start) < 30)
          if (target) target.translation = content
          continue
        }
        const existing = entries.get(start)
        if (existing) { existing.translation ||= content; continue }
        const words: LyricWord[] = []
        for (const word of content.matchAll(/<(\d+),(\d+)>([^<]*)/g)) {
          const wordStart = start + Number(word[1])
          words.push({ text: word[3], start: wordStart, end: wordStart + Number(word[2]) })
        }
        const text = words.length ? words.map(word => word.text).join('') : content
        entries.set(start, { text, start, end: start + 5000, words, translation: '', timed: words.length > 0 })
      }
    }
  }
  read(source, false)
  read(translation, true)
  const lines = [...entries.values()].sort((a, b) => a.start - b.start)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    line.end = Math.max(line.start + 1, lines[index + 1]?.start ?? Math.max(line.start + 5000, line.words.at(-1)?.end ?? 0))
    if (line.timed) continue
    // Keep spaces attached to the preceding word, while CJK characters retain individual timing.
    const pieces = line.text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*\s*|\S\s*/gu) ?? [line.text]
    const total = Math.max(1, pieces.reduce((sum, piece) => sum + piece.trim().length, 0))
    let cursor = line.start
    line.words = pieces.map(text => {
      const start = cursor
      cursor += (line.end - line.start) * text.trim().length / total
      return { text, start, end: cursor }
    })
  }
  return lines
}

export function findExternalLine(lines: ExternalLine[], time: number): number {
  let low = 0
  let high = lines.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (lines[middle].start <= time) low = middle + 1
    else high = middle
  }
  return low - 1
}

export function wordProgress(word: LyricWord, time: number): number {
  if (time < word.start) return 0
  return Math.min(1, (time - word.start) / Math.max(1, word.end - word.start))
}

export function lyricScrollOffset(time: number, line: ExternalLine, activatedAt: number, distance: number): number {
  const start = Math.max(line.start, activatedAt)
  const duration = Math.max(1200, line.end - start)
  const moving = duration - Math.min(2000, duration * 0.2)
  const progress = Math.min(1, Math.max(0, ((time - start) / moving - 0.3) / 0.7))
  return progress > 0 && distance > 0 ? -distance * progress : 0
}
