/** Imported scripts keep their own identity instead of masquerading as a platform. */
export type ImportedPlatformSource = `imported:${string}`
export type PreferredPlatformSource = 'auto' | LX.OnlineSource | ImportedPlatformSource

export const platformSourceLabels: Record<'auto' | LX.OnlineSource, string> = {
  auto: '自动 · 优选音质',
  tx: 'QQ 音乐',
  wy: '网易云音乐',
  qs: '汽水音乐',
  bo: '波点音乐',
  kg: '酷狗音乐',
  kw: '酷我音乐',
  mg: '咪咕音乐',
  bi: '哔哩哔哩',
}

export const getImportedSourceId = (value: unknown): string | null => typeof value === 'string' ? /^imported:(user_api_[A-Za-z0-9_-]{1,160})$/.exec(value)?.[1] ?? null : null
export const isImportedSource = (value: unknown): value is ImportedPlatformSource => getImportedSourceId(value) !== null
export const createImportedSource = (id: string): ImportedPlatformSource => {
  const value: ImportedPlatformSource = `imported:${id}`
  if (!isImportedSource(value)) throw new Error('无效的导入音源标识。')
  return value
}

export const isPreferredPlatformSource = (value: unknown): value is PreferredPlatformSource => typeof value === 'string' && (Object.prototype.hasOwnProperty.call(platformSourceLabels, value) || isImportedSource(value))

export interface PreferredSourceOption { value: PreferredPlatformSource, label: string }
export const buildPreferredSourceOptions = (apis: ReadonlyArray<Pick<LX.UserApi.UserApiInfo, 'id' | 'name'>>, selected?: PreferredPlatformSource): PreferredSourceOption[] => {
  const options = (Object.entries(platformSourceLabels) as Array<['auto' | LX.OnlineSource, string]>).map(([value, label]) => ({ value, label })) as PreferredSourceOption[]
  for (const api of apis) {
    if (!isImportedSource(`imported:${api.id}`)) continue
    options.push({ value: createImportedSource(api.id), label: `${api.name || '未命名音源'} · 导入音源` })
  }
  if (isImportedSource(selected) && !options.some(option => option.value === selected)) options.push({ value: selected, label: '导入音源（已移除或尚未载入）' })
  return options
}
