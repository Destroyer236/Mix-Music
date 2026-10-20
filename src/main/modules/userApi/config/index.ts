// Retire only the entries created automatically by earlier LinkLine versions.
// Manually imported scripts have their own IDs and remain user-managed.
export const retiredDefaultSourceIds = new Set([
  'user_api_default_sixyin',
  'user_api_default_lx',
  'user_api_default_flower',
  'user_api_default_huibq',
  'user_api_default_juhe',
])

export const removeRetiredDefaultSourceSettings = (setting?: Partial<LX.AppSetting>): Partial<LX.AppSetting> | undefined => {
  if (!setting) return setting
  const next = { ...setting }
  if (retiredDefaultSourceIds.has(next['common.apiSource'] ?? '')) next['common.apiSource'] = ''
  const preferred = next['player.preferredSource']
  if (typeof preferred === 'string' && preferred.startsWith('imported:') && retiredDefaultSourceIds.has(preferred.slice('imported:'.length))) next['player.preferredSource'] = 'auto'
  return next
}
