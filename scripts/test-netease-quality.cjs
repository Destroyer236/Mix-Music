/* NetEase quality discovery and playback contracts: mocked official responses, no account or network. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { performance } = require('node:perf_hooks')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(relative, dependencies = {}) {
  const file = path.join(root, relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('@common/')) return load(`src/common/${name.slice(8)}.ts`)
    return nativeRequire(name)
  }
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file)
  return instance.exports
}

const songId = 19723756
const track = { id: `wy_${songId}`, source: 'wy', name: 'Fixture', singer: 'Singer', interval: '03:00', meta: { songId, albumName: '', qualitys: [], _qualitys: {} } }
const formats = {
  songId,
  l: { size: 1000, br: 128000, sr: 44100 },
  m: { size: 2000, br: 192000, sr: 44100 },
  h: { size: 3000, br: 320000, sr: 44100 },
  sq: { size: 4000, br: 800000, sr: 48000 },
  hr: { size: 5000, br: 1800000, sr: 96000 },
  je: { size: 6000, br: 1600000, sr: 96000 },
  jm: { size: 7000, br: 3000000, sr: 192000 },
  sk: { size: 8000, br: 500000, sr: 48000 },
  sks: [{ size: 8000, br: 500000, sr: 48000, it: 'c51' }],
  vi: { size: 9000, br: 3000000, sr: 96000 },
}
const allQualities = ['128k', '192k', '320k', 'flac', 'flac24bit', 'jyeffect', 'sky', 'jymaster', 'vivid']
const detailPath = '/weapi/song/music/detail/get'
const songPath = '/weapi/v3/song/detail'
const playerPath = '/weapi/song/enhance/player/url/v1'

function fixture(responder) {
  const requests = []
  const encrypted = []
  const provider = load('src/main/modules/platformAccounts/providers/netease.ts', {
    'NeteaseCloudMusicApi/util/crypto': { weapi: value => { encrypted.push(value); return value } },
  }).neteaseProvider
  const context = {
    cookies: async() => ({ MUSIC_U: 'fixture-session', __csrf: 'fixture-csrf' }),
    session: {
      fetch: async(url, options) => {
        const request = { url: new URL(url), options, data: Object.fromEntries(new URLSearchParams(options.body)) }
        requests.push(request)
        const body = await responder(request)
        return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
      },
    },
  }
  return { provider, context, requests, encrypted }
}

function responseFor(request, detail = formats) {
  if (request.url.pathname === detailPath) return { code: 200, data: detail }
  if (request.url.pathname === songPath) return { code: 200, songs: [{ id: songId, l: formats.l, m: formats.m, h: formats.h, sq: formats.sq }], privileges: [{ id: songId, maxbr: 999000 }] }
  throw new Error(`Unexpected endpoint: ${request.url.pathname}`)
}

const audio = (level, extra = {}) => ({ id: songId, url: `https://audio.example.test/${level}.flac`, level, br: 512000, expi: 600, freeTrialInfo: null, ...extra })

test('dedicated quality metadata exposes NetEase advanced formats and uses the authenticated songId protocol', async() => {
  const { provider, context, requests, encrypted } = fixture(request => responseFor(request))
  assert.deepEqual(await provider.musicQualitys(context, track), allQualities)
  const request = requests.find(item => item.url.pathname === detailPath)
  assert.ok(request, 'the ordinary song detail response does not advertise every available audio format')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.url.searchParams.get('csrf_token'), 'fixture-csrf')
  assert.equal(request.data.songId, String(songId))
  assert.equal(request.data.csrf_token, 'fixture-csrf')
  assert.equal(encrypted.find(item => item.songId != null).songId, songId, 'the encryption input carries a numeric song ID')
  assert.equal(requests.some(item => item.url.pathname === songPath), false, 'a valid dedicated response needs no duplicate ordinary metadata request')
})

test('surround metadata supports sk and the sks format list', async() => {
  for (const detail of [{ songId, sk: formats.sk }, { songId, sks: formats.sks }]) {
    const { provider, context } = fixture(request => {
      if (request.url.pathname === detailPath) return { code: 200, data: detail }
      return { code: 200, songs: [{ id: songId }], privileges: [{ id: songId, maxbr: 128000 }] }
    })
    const qualitys = await provider.musicQualitys(context, track)
    assert.ok(qualitys.includes('sky'), `surround was lost: ${JSON.stringify(detail)}`)
  }
})

test('failed dedicated metadata retains the ordinary song detail fallback', async() => {
  const { provider, context } = fixture(request => {
    if (request.url.pathname === detailPath) return { code: 503 }
    return responseFor(request)
  })
  assert.deepEqual(await provider.musicQualitys(context, track), ['128k', '192k', '320k', 'flac'])
})

test('empty dedicated metadata retains the ordinary song detail fallback', async() => {
  const { provider, context } = fixture(request => request.url.pathname === detailPath ? { code: 200, data: null } : responseFor(request))
  assert.deepEqual(await provider.musicQualitys(context, track), ['128k', '192k', '320k', 'flac'])
})

test('dedicated metadata for a different song cannot leak advanced formats', async() => {
  const { provider, context } = fixture(request => request.url.pathname === detailPath ? { code: 200, data: { ...formats, songId: songId + 1 } } : responseFor(request))
  assert.deepEqual(await provider.musicQualitys(context, track), ['128k', '192k', '320k', 'flac'])
})

test('unavailable placeholder formats are excluded from the quality menu', async() => {
  const { provider, context } = fixture(request => responseFor(request, { songId, l: formats.l, hr: { size: 0, br: 0 }, je: {}, sks: [], jm: null, vi: { size: 0, br: 0 } }))
  assert.deepEqual(await provider.musicQualitys(context, track), ['128k'])
})

test('auto checks lower advertised qualities before accepting a premium preview', async() => {
  const { provider, context, requests } = fixture(request => {
    if (request.url.pathname !== playerPath) return responseFor(request)
    const { level } = request.data
    return { code: 200, data: [audio(level, level === 'jymaster' ? { url: null } : level === 'sky' ? { freeTrialInfo: { start: 0, end: 30 } } : {})] }
  })
  const stream = await provider.musicUrl(context, track, 'auto')
  assert.equal(stream.quality, 'jyeffect')
  assert.equal(stream.type, 'flac24bit')
  assert.equal(stream.isTrial, false)
  assert.deepEqual(requests.filter(item => item.url.pathname === playerPath).map(item => item.data.level), ['jymaster', 'sky', 'jyeffect'])
  const surroundRequest = requests.find(item => item.data.level === 'sky')
  assert.equal(surroundRequest.data.immerseType, 'c51')
})

test('auto walks every advertised tier before the official standard preview', async() => {
  const { provider, context, requests } = fixture(request => {
    if (request.url.pathname !== playerPath) return responseFor(request)
    const { level } = request.data
    return { code: 200, data: [audio(level, { url: level === 'standard' ? 'https://audio.example.test/preview.mp3' : null, freeTrialInfo: { start: 0, end: 30 } })] }
  })
  const stream = await provider.musicUrl(context, track, 'auto')
  assert.equal(stream.isTrial, true)
  assert.deepEqual(requests.filter(item => item.url.pathname === playerPath).map(item => item.data.level), ['jymaster', 'sky', 'jyeffect', 'hires', 'lossless', 'exhigh', 'higher', 'standard'])
  assert.equal(requests.some(item => item.data.level === 'vivid'), false, 'auto does not request the AV3A format unsupported by Electron')
})

test('auto still tries advanced streams if both metadata endpoints are temporarily unavailable', async() => {
  const { provider, context, requests } = fixture(request => {
    if (request.url.pathname !== playerPath) return { code: 503 }
    return { code: 200, data: [audio(request.data.level, { url: request.data.level === 'jyeffect' ? 'https://audio.example.test/full.flac' : null })] }
  })
  const stream = await provider.musicUrl(context, track, 'auto')
  assert.equal(stream.quality, 'jyeffect')
  assert.deepEqual(requests.filter(item => item.url.pathname === playerPath).map(item => item.data.level), ['jymaster', 'sky', 'jyeffect'])
})

test('auto keeps searching when a premium request returns a downgraded full stream', async() => {
  const { provider, context, requests } = fixture(request => {
    if (request.url.pathname !== playerPath) return responseFor(request)
    if (request.data.level === 'jymaster') return { code: 200, data: [audio('lossless')] }
    if (request.data.level === 'jyeffect') return { code: 200, data: [audio('jyeffect')] }
    return { code: 200, data: [audio(request.data.level, { url: null })] }
  })
  const stream = await provider.musicUrl(context, track, 'auto')
  assert.equal(stream.quality, 'jyeffect', 'a working higher format takes priority over an earlier downgraded full stream')
  assert.deepEqual(requests.filter(item => item.url.pathname === playerPath).map(item => item.data.level), ['jymaster', 'sky', 'jyeffect'])
})

test('auto retains the best downgraded full stream and skips candidate tiers that cannot improve it', async() => {
  const { provider, context, requests } = fixture(request => {
    if (request.url.pathname !== playerPath) return responseFor(request)
    if (request.data.level === 'jymaster') return { code: 200, data: [audio('lossless')] }
    return { code: 200, data: [audio(request.data.level, { url: null })] }
  })
  const stream = await provider.musicUrl(context, track, 'auto')
  assert.equal(stream.quality, 'flac')
  assert.deepEqual(requests.filter(item => item.url.pathname === playerPath).map(item => item.data.level), ['jymaster', 'sky', 'jyeffect', 'hires'])
})

test('auto returns an acquired full stream before the outer source timeout when a higher-tier request stalls', { timeout: 6500 }, async() => {
  let hangingAborted = false
  const { provider, context, requests } = fixture(request => {
    if (request.url.pathname !== playerPath) return responseFor(request)
    if (request.data.level === 'jymaster') return { code: 200, data: [audio('lossless')] }
    assert.equal(request.data.level, 'sky', 'a budget abort must not start another lower-tier request')
    assert.ok(request.options.signal, 'the playback budget must reach the actual fetch request')
    return new Promise((resolve, reject) => {
      const signal = request.options.signal
      const abort = () => { hangingAborted = true; reject(signal.reason ?? new DOMException('Aborted', 'AbortError')) }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
  })
  const started = performance.now()
  // AbortSignal.timeout uses an unref'ed timer; keep this mocked network request
  // alive just as a real session.fetch would, and bound regression failures.
  let guard
  const stream = await Promise.race([
    provider.musicUrl(context, track, 'auto'),
    new Promise((resolve, reject) => { guard = setTimeout(() => reject(new Error('auto lost its acquired stream past the source timeout')), 5900) }),
  ]).finally(() => clearTimeout(guard))
  assert.equal(stream.quality, 'flac')
  assert.equal(stream.type, 'flac')
  assert.equal(hangingAborted, true, 'the pending higher-tier request is cancelled before returning the acquired full stream')
  assert.ok(performance.now() - started < 5900, 'return the acquired full stream before playback.ts expires the 6-second source budget')
  assert.deepEqual(requests.filter(item => item.url.pathname === playerPath).map(item => item.data.level), ['jymaster', 'sky'])
})

test('an explicit unsupported Audio Vivid request fails before any network request', async() => {
  const { provider, context, requests } = fixture(() => assert.fail('no network request expected'))
  await assert.rejects(provider.musicUrl(context, track, 'vivid'), /Audio Vivid|AV3A|暂不支持/i)
  assert.equal(requests.length, 0)
})

test('auto keeps the first official preview if all lower full streams are denied', async() => {
  const { provider, context } = fixture(request => {
    if (request.url.pathname !== playerPath) return responseFor(request)
    const { level } = request.data
    return { code: 200, data: [audio(level, { url: level === 'jymaster' ? 'https://audio.example.test/premium-preview.mp3' : null, freeTrialInfo: { start: 0, end: 30 } })] }
  })
  const stream = await provider.musicUrl(context, track, 'auto')
  assert.equal(stream.isTrial, true)
  assert.equal(stream.url, 'https://audio.example.test/premium-preview.mp3')
})

test('returned level determines the actual format even at a lower encoded bitrate', async() => {
  for (const [level, expectedQuality, expectedType] of [
    ['jymaster', 'jymaster', 'flac24bit'], ['sky', 'sky', 'flac24bit'], ['jyeffect', 'jyeffect', 'flac24bit'],
    ['hires', 'flac24bit', 'flac24bit'], ['lossless', 'flac', 'flac'], ['exhigh', '320k', '320k'],
  ]) {
    const { provider, context } = fixture(() => ({ code: 200, data: [audio(level, { br: 256000 })] }))
    const stream = await provider.musicUrl(context, track, 'jymaster')
    assert.equal(stream.quality, expectedQuality)
    assert.equal(stream.type, expectedType, `${level} must not be mislabeled by bitrate alone`)
  }
})

test('explicit unavailable premium quality retains the official standard fallback', async() => {
  const { provider, context, requests } = fixture(request => ({ code: 200, data: [audio(request.data.level, { url: request.data.level === 'standard' ? 'https://audio.example.test/standard.mp3' : null })] }))
  const stream = await provider.musicUrl(context, track, 'jymaster')
  assert.equal(stream.quality, '128k')
  assert.equal(stream.type, '128k')
  assert.deepEqual(requests.map(item => item.data.level), ['jymaster', 'standard'])
})

test('player responses from a different song cannot provide a playback stream', async() => {
  const { provider, context } = fixture(request => ({ code: 200, data: [audio(request.data.level, { id: songId + 1 })] }))
  await assert.rejects(provider.musicUrl(context, track, '128k'), /没有返回/)
})

test('a single player response may omit its song ID', async() => {
  const { provider, context } = fixture(request => ({ code: 200, data: [audio(request.data.level, { id: undefined })] }))
  assert.equal((await provider.musicUrl(context, track, '128k')).quality, '128k')
})

test('an AV3A response cannot be reported as playable FLAC', async() => {
  for (const descriptor of [{ type: 'av3a' }, { encodeType: 'av3a' }, { type: 'flac', encodeType: 'av3a' }, { type: 'av3a', encodeType: 'flac' }, { level: 'vivid' }]) {
    const { provider, context, requests } = fixture(request => ({ code: 200, data: [audio(request.data.level, request.data.level === 'jyeffect' ? descriptor : {})] }))
    const stream = await provider.musicUrl(context, track, 'jyeffect')
    assert.equal(stream.quality, '128k')
    assert.equal(stream.type, '128k')
    assert.deepEqual(requests.map(item => item.data.level), ['jyeffect', 'standard'])
  }
})

test('stream sample rate and bit depth are retained when returned by the platform', async() => {
  const { provider, context } = fixture(() => ({ code: 200, data: [audio('hires', { sr: 96000, bitDepth: 24 })] }))
  const stream = await provider.musicUrl(context, track, 'flac24bit')
  assert.equal(stream.sampleRate, 96000)
  assert.equal(stream.bitDepth, 24)
})

test('quality labels preserve platform names and recognize the unsupported Audio Vivid metadata tier', () => {
  const { qualityLabels, getPlatformQualityLabel, legacyQuality, isPlatformQuality } = load('src/common/platformPlayback.ts')
  assert.match(getPlatformQualityLabel('jyeffect', 'wy'), /高清臻音/)
  assert.match(getPlatformQualityLabel('jyeffect', 'wy'), /Spatial Audio/)
  assert.equal(getPlatformQualityLabel('jyeffect', 'netease'), getPlatformQualityLabel('jyeffect', 'wy'))
  assert.equal(getPlatformQualityLabel('jyeffect', 'tx'), '高清环绕声')
  assert.equal(qualityLabels.jyeffect, '高清环绕声', 'NetEase branding must not rename the shared QQ quality')
  assert.equal(getPlatformQualityLabel('320k', 'tx'), qualityLabels['320k'])
  assert.equal(isPlatformQuality('vivid'), true)
  assert.equal(legacyQuality('vivid'), 'flac24bit')
})
