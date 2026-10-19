export interface ReleaseNoteNode {
  tag: string
  children: Array<string | ReleaseNoteNode>
  href?: string
  start?: number
}

// Release text comes from a remote feed. Only our own tags become elements;
// source HTML always remains text and links are limited to web protocols.
export const releaseNoteLink = (value: string): string | undefined => {
  if (!/^https?:\/\//i.test(value) || Array.from(value).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return
  try {
    const url = new URL(value)
    if (!url.hostname || url.username || url.password) return
    return url.href
  } catch {}
}

export const parseReleaseNoteInline = (text: string, depth = 0): Array<string | ReleaseNoteNode> => {
  if (depth > 8) return [text]
  const nodes: Array<string | ReleaseNoteNode> = []
  const tokens = /(`+)([^`]*?)\1|\[([^\]\n]+)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_|~~([^\n]+?)~~/g
  let offset = 0
  let match: RegExpExecArray | null
  while ((match = tokens.exec(text))) {
    if (match.index > offset) nodes.push(text.slice(offset, match.index))
    if (match[1]) nodes.push({ tag: 'code', children: [match[2]] })
    else if (match[3]) {
      const label = parseReleaseNoteInline(match[3], depth + 1)
      const href = releaseNoteLink(match[4])
      nodes.push(...(href ? [{ tag: 'a', href, children: label }] : label))
    } else {
      const content = match[5] ?? match[6] ?? match[7] ?? match[8] ?? match[9]
      nodes.push({ tag: match[5] || match[6] ? 'strong' : match[9] ? 'del' : 'em', children: parseReleaseNoteInline(content, depth + 1) })
    }
    offset = tokens.lastIndex
  }
  if (offset < text.length) nodes.push(text.slice(offset))
  return nodes
}

const listLine = (line: string) => /^\s*(?:([-+*])|([0-9]+)[.)])\s+(.+)$/.exec(line)
const fenceLine = (line: string) => /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
const isRule = (line: string) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
const isBlock = (line: string) => !line.trim() || /^\s{0,3}#{1,6}\s+/.test(line) || /^\s*>\s?/.test(line) || Boolean(listLine(line)) || Boolean(fenceLine(line)) || isRule(line)

export const parseReleaseNotes = (text: string, depth = 0): ReleaseNoteNode[] => {
  if (depth > 8) return [{ tag: 'p', children: [text] }]
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const nodes: ReleaseNoteNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }
    const fence = fenceLine(line)
    if (fence) {
      const content: string[] = []
      index++
      while (index < lines.length) {
        const end = fenceLine(lines[index])
        if (end && end[1][0] === fence[1][0] && end[1].length >= fence[1].length && !end[2].trim()) { index++; break }
        content.push(lines[index++])
      }
      nodes.push({ tag: 'pre', children: [{ tag: 'code', children: [content.join('\n')] }] })
      continue
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      nodes.push({ tag: 'h' + heading[1].length, children: parseReleaseNoteInline(heading[2]) })
      index++
      continue
    }
    if (isRule(line)) { nodes.push({ tag: 'hr', children: [] }); index++; continue }
    const item = listLine(line)
    if (item) {
      const ordered = Boolean(item[2])
      const children: ReleaseNoteNode[] = []
      while (index < lines.length) {
        const next = listLine(lines[index])
        if (!next || Boolean(next[2]) !== ordered) break
        children.push({ tag: 'li', children: parseReleaseNoteInline(next[3]) })
        index++
      }
      nodes.push({ tag: ordered ? 'ol' : 'ul', ...(ordered ? { start: Number(item[2]) } : {}), children })
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''))
      nodes.push({ tag: 'blockquote', children: parseReleaseNotes(quote.join('\n'), depth + 1) })
      continue
    }
    const paragraph = [line]
    index++
    while (index < lines.length && !isBlock(lines[index])) paragraph.push(lines[index++])
    nodes.push({ tag: 'p', children: parseReleaseNoteInline(paragraph.join('\n')) })
  }
  return nodes
}
