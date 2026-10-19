const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../src/main/modules/platformAccounts/qishuiLoginDiagnostics.ts')
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText

function load(io = fs.promises) {
  const subject = new Module(filename, module)
  subject.filename = filename
  subject.paths = module.paths
  const nativeRequire = subject.require.bind(subject)
  subject.require = name => name === 'node:fs/promises' ? io : nativeRequire(name)
  subject._compile(source, filename)
  return subject.exports.createQishuiLoginDiagnosticWriter
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-qishui-diagnostics-'))
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()))
    assert(path.basename(directory).startsWith('linkline-qishui-diagnostics-'))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const file = path.join(directory, 'logs', 'qishui-login-diagnostics.json')
  return { directory, file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) }
}

test('diagnostics retain only fixed metadata even when runtime input contains credentials, decisions and errors', async t => {
  const f = fixture(t)
  const writer = load()(f.file)
  writer({
    phase: 'response',
    operation: 'check-qr',
    status: 'scanned',
    code: 2046,
    httpStatus: 200,
    hasDecision: true,
    hasSessionCookie: false,
    hasSessionId: false,
    resend: false,
    elapsedMs: 125,
    phaseCode: 'QV04_HOST',
    outcome: 'failed',
    token: 'PRIVATE_QR_TOKEN',
    cookies: [{ value: 'PRIVATE_COOKIE' }],
    url: 'https://private.example/?ticket=PRIVATE_TICKET',
    headers: { authorization: 'PRIVATE_AUTHORIZATION' },
    decision: { account: 'PRIVATE_ACCOUNT' },
    error: new Error('PRIVATE_ERROR'),
    timestamp: 'PRIVATE_TIMESTAMP',
    toJSON: () => ({ token: 'PRIVATE_TOJSON' }),
  })
  writer({ phase: 'PRIVATE_PHASE', url: 'https://private.example/' })
  writer({ phase: 'request-failed', operation: 'PRIVATE_OPERATION', status: 'PRIVATE_STATUS', phaseCode: 'QV05 PRIVATE_ERROR', outcome: 'PRIVATE_OUTCOME', code: '2156 PRIVATE_CODE', httpStatus: NaN, elapsedMs: Infinity, hasDecision: 'PRIVATE_BOOLEAN', resend: 1 })
  assert.doesNotThrow(() => writer(Object.defineProperty({}, 'phase', { get() { throw new Error('PRIVATE_GETTER') } })))
  let phaseReads = 0
  let decisionReads = 0
  writer({
    get phase() { return ++phaseReads <= 2 ? 'response' : 'PRIVATE_PHASE_GETTER' },
    get hasDecision() { return ++decisionReads === 1 ? true : 'PRIVATE_BOOLEAN_GETTER' },
  })
  await writer.settled()
  const document = f.read()
  assert.equal(document.formatVersion, 1)
  assert.equal(document.events.length, 3)
  const first = document.events[0]
  assert.match(first.timestamp, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
  assert.deepEqual({ ...first, timestamp: undefined }, {
    timestamp: undefined,
    phase: 'response',
    operation: 'check-qr',
    status: 'scanned',
    code: 2046,
    httpStatus: 200,
    hasDecision: true,
    hasSessionCookie: false,
    hasSessionId: false,
    resend: false,
    elapsedMs: 125,
    phaseCode: 'QV04_HOST',
    outcome: 'failed',
  })
  assert.deepEqual(Object.keys(document.events[1]).sort(), ['phase', 'timestamp'])
  assert.equal(phaseReads, 1, 'Only the validated value from a runtime getter may be persisted')
  assert.equal(decisionReads, 1)
  assert.deepEqual({ ...document.events[2], timestamp: undefined }, { timestamp: undefined, phase: 'response', hasDecision: true })
  assert.doesNotMatch(fs.readFileSync(f.file, 'utf8'), /PRIVATE_|private\.example|authorization|"token"|"cookies"|"decision"|"error"|"headers"/)
})

test('rapid reports serialize atomic snapshots and persist only the latest 64 events', async t => {
  const f = fixture(t)
  let activeWrites = 0
  let maximumWrites = 0
  const committed = []
  const writer = load({
    ...fs.promises,
    async writeFile(...args) {
      activeWrites++
      maximumWrites = Math.max(maximumWrites, activeWrites)
      await new Promise(resolve => setTimeout(resolve, 1))
      try { return await fs.promises.writeFile(...args) } finally { activeWrites-- }
    },
    async rename(temporary, target) {
      assert.equal(target, f.file)
      const snapshot = JSON.parse(await fs.promises.readFile(temporary, 'utf8'))
      assert(snapshot.events.length <= 64)
      await fs.promises.rename(temporary, target)
      committed.push(snapshot.events.at(-1).elapsedMs)
    },
  })(f.file)
  for (let elapsedMs = 0; elapsedMs < 80; elapsedMs++) writer({ phase: 'response', operation: 'check-qr', elapsedMs })
  await writer.settled()
  assert.equal(maximumWrites, 1, 'Concurrent writes must not race or replace a newer snapshot')
  assert.deepEqual(committed, Array.from({ length: 80 }, (_, index) => index))
  assert.deepEqual(f.read().events.map(event => event.elapsedMs), Array.from({ length: 64 }, (_, index) => index + 16))
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), [path.basename(f.file)])
})

test('a write failure is swallowed and later reports can still persist a bounded snapshot', async t => {
  const f = fixture(t)
  let writes = 0
  const writer = load({
    ...fs.promises,
    async writeFile(...args) {
      if (++writes === 1) throw new Error('Synthetic disk failure')
      return fs.promises.writeFile(...args)
    },
  })(f.file)
  assert.doesNotThrow(() => writer({ phase: 'start' }))
  await assert.doesNotReject(writer.settled())
  writer({ phase: 'response', code: 2156 })
  await assert.doesNotReject(writer.settled())
  assert.deepEqual(f.read().events.map(event => event.phase), ['start', 'response'])
  assert.equal(f.read().events[1].code, 2156)
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), [path.basename(f.file)])
})
