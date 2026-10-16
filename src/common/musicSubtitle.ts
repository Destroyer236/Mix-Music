const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined
  if (!Array.isArray(value)) return undefined
  const values = value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  return [...new Set(values)].join(' / ') || undefined
}

/** Preserve the platform's song subtitle, without substituting album or version metadata. */
export const songSubtitle = (source: string, value: unknown): string | undefined => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const song = value as Record<string, unknown>
  if (source === 'tx') return text(song.subtitle)
  if (source === 'wy') return text(song.alia) ?? text(song.alias) ?? text(song.tns) ?? text(song.transNames)
  return undefined
}
