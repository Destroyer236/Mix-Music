// A JS heap budget is per isolate, not a cap on Electron's total process memory.
// Keep room for large libraries, backup imports and authenticated login pages.
export const RENDERER_OLD_SPACE_MIB = 512
export const DATABASE_WORKER_LIMITS = { maxOldGenerationSizeMb: 512 }

const optionalFeatures = ['MediaRouter', 'DialMediaRouteProvider', 'OptimizationHints', 'AutofillServerCommunication']
const optionalServices = ['disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'disable-extensions', 'disable-sync', 'disable-default-apps']

export function applyRuntimePerformance(commandLine: Pick<Electron.CommandLine, 'getSwitchValue' | 'appendSwitch'>) {
  // Preserve unrelated V8/Chromium switches supplied by the environment.
  const flags = commandLine.getSwitchValue('js-flags').replace(/(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)\d+/g, '').trim()
  commandLine.appendSwitch('js-flags', `${flags ? `${flags} ` : ''}--max-old-space-size=${RENDERER_OLD_SPACE_MIB}`)
  const disabled = new Set([...commandLine.getSwitchValue('disable-features').split(',').filter(Boolean), ...optionalFeatures])
  commandLine.appendSwitch('disable-features', [...disabled].join(','))
  // Disable browser infrastructure unused by this music client. These switches
  // leave normal HTTP requests, platform cookies, audio and app updates intact.
  for (const name of optionalServices) commandLine.appendSwitch(name)
}
