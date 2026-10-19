import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface QishuiLoginDiagnostic {
  phase: 'request-start' | 'response' | 'request-failed' | 'verification-start' | 'verification-result' | 'confirmed' | 'cancelled' | 'expired' | 'start'
  operation?: 'get-qr' | 'check-qr'
  status?: 'waiting' | 'scanned' | 'verifying' | 'confirmed' | 'expired' | 'unknown'
  code?: number
  httpStatus?: number
  hasDecision?: boolean
  hasSessionCookie?: boolean
  hasSessionId?: boolean
  resend?: boolean
  elapsedMs?: number
  outcome?: 'passed' | 'cancelled' | 'failed'
  phaseCode?: 'QV01' | 'QV02' | 'QV03' | 'QV04' | 'QV04_EMPTY' | 'QV04_FORMAT' | 'QV04_HOST' | 'QV05' | 'QV06' | 'QV07'
}

export type QishuiLoginDiagnosticWriter = ((event: QishuiLoginDiagnostic) => void) & { settled: () => Promise<void> }

const phases = new Set(['request-start', 'response', 'request-failed', 'verification-start', 'verification-result', 'confirmed', 'cancelled', 'expired', 'start'])
const operations = new Set(['get-qr', 'check-qr'])
const statuses = new Set(['waiting', 'scanned', 'verifying', 'confirmed', 'expired', 'unknown'])
const outcomes = new Set(['passed', 'cancelled', 'failed'])
const phaseCodes = new Set(['QV01', 'QV02', 'QV03', 'QV04', 'QV04_EMPTY', 'QV04_FORMAT', 'QV04_HOST', 'QV05', 'QV06', 'QV07'])

// Build every persisted field here. Never spread a caller's event: even a
// typed callback can receive extra error, decision, cookie or URL properties.
function sanitize(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  const event = input as Record<string, unknown>
  const phase = event.phase
  if (typeof phase !== 'string' || !phases.has(phase)) return
  const safe: Record<string, unknown> = { timestamp: new Date().toISOString(), phase }
  for (const [key, values] of [['operation', operations], ['status', statuses], ['outcome', outcomes], ['phaseCode', phaseCodes]] as const) {
    const value = event[key]
    if (typeof value === 'string' && values.has(value)) safe[key] = value
  }
  for (const key of ['hasDecision', 'hasSessionCookie', 'hasSessionId', 'resend'] as const) {
    const value = event[key]
    if (typeof value === 'boolean') safe[key] = value
  }
  for (const [key, minimum, maximum] of [['code', 0, 2_147_483_647], ['httpStatus', 100, 599], ['elapsedMs', 0, 86_400_000]] as const) {
    const value = event[key]
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum) safe[key] = value
  }
  return safe
}

/** A bounded diagnostic snapshot; logging must never affect a login attempt. */
export function createQishuiLoginDiagnosticWriter(file: string): QishuiLoginDiagnosticWriter {
  const events: Array<Record<string, unknown>> = []
  const temporary = `${file}.${randomUUID()}.tmp`
  let queue = Promise.resolve()
  const report = (input: QishuiLoginDiagnostic) => {
    try {
      const event = sanitize(input)
      if (!event) return
      events.push(event)
      if (events.length > 64) events.shift()
      const snapshot = JSON.stringify({ formatVersion: 1, events }) + '\n'
      queue = queue.then(async() => {
        try {
          await mkdir(dirname(file), { recursive: true, mode: 0o700 })
          await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
          await rename(temporary, file)
        } catch {
          await unlink(temporary).catch(() => {})
        }
      }).catch(() => {})
    } catch {}
  }
  return Object.assign(report, { settled: async() => queue })
}
