/* Public Qishui stream-resolution regressions. No account credentials or live network. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const loaded = new Map()
function load(file) {
  file = path.resolve(file)
  if (loaded.has(file)) return loaded.get(file).exports
  const instance = new Module(file, module)
  loaded.set(file, instance)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => name.startsWith('./qishui') ? load(path.resolve(path.dirname(file), `${name}.ts`))
    : name.startsWith('@common/') ? load(path.join(root, 'src/common', `${name.slice(8)}.ts`)) : nativeRequire(name)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  instance._compile(code, file)
  return instance.exports
}
const api = load(path.join(root, 'src/main/modules/platformAccounts/providers/qishuiApi.ts'))
const id = '7683404377687656489'
const track = { id, name: '呜 挽留也终告失败', artists: [{ id: '123', name: '鹤' }], duration: 180000, share_status: 0, media_type: 'track' }
const cdn = name => `https://v5.example.douyinvod.com/token/ffffffff/${name}?mime_type=audio_mp4`
const playerInfoUrl = 'https://vod-luna.douyin.com/?Action=GetPlayInfo&Version=2018-01-01&X-Expires=fixture&X-Signature=fixture-private-signature'
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(20)])
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const share = (option = {}) => `<script>window._ROUTER_DATA = ${JSON.stringify({ loaderData: { track_page: { audioWithLyricsOption: { status_code: 0, track_id: id, trackInfo: track, hasCopyright: true, encrypt: false, previewStart: 0, previewEnd: 0, url: cdn('ssr'), ...option } } } })};</script>`
const missingShare = '<script>window._ROUTER_DATA = {"loaderData":{}};</script>'
const playerData = ({ model = { video_duration: 180, video_list: [{ main_url: cdn('fresh'), video_meta: { quality: 'higher' } }] }, player = {}, info = {} } = {}) => ({
  status_code: 0,
  seo_track: { track: { ...track, ...info } },
  track_player: { video_model: model, ...player },
})
const playInfo = (entries, data = {}) => ({ Result: { Data: { Status: 10, Duration: 180, PlayInfoList: entries, ...data } } })
const clearEntry = (url, extra = {}) => ({ MainPlayUrl: url, Duration: 180, Definition: 'higher', Format: 'm4a', ...extra })

function fixture({ html = share(), seo = playerData(), h5 = seo, info = playInfo([]), audio = () => new Response(mp4, { status: 206 }) } = {}) {
  const metadata = []
  const probes = []
  let active = 0
  let maximum = 0
  const client = {
    cookies: async() => { throw Error('Public stream resolution must not read account cookies') },
    session: { async fetch(input, options = {}) {
      const url = new URL(input)
      metadata.push(url)
      assert.equal(options.credentials, 'omit', 'Public metadata must omit account credentials')
      assert.equal(options.cache, 'no-store', 'Signed audio information must be refreshed over the network')
      assert.equal(new Headers(options.headers).has('cookie'), false)
      if (url.hostname === 'www.qishui.com') return new Response(html)
      if (url.pathname === '/luna/h5/seo_track') {
        assert.equal(url.hostname, 'beta-luna.douyin.com')
        assert.equal(url.searchParams.get('track_id'), id)
        return json(seo)
      }
      if (url.hostname === 'vod-luna.douyin.com') {
        assert.equal(options.redirect, 'error', 'Signed player-info requests must not redirect to an arbitrary host')
        return json(info)
      }
      if (url.pathname === '/luna/h5/track_v2') {
        assert.equal(url.hostname, 'api.qishui.com')
        assert.equal(url.searchParams.get('track_id'), id)
        assert.equal(url.searchParams.get('media_type'), 'track', 'Ordinary tracks must not be guessed to be original sounds')
        return json(h5)
      }
      throw Error('Unexpected public metadata endpoint')
    } },
    playbackSession: { async fetch(url, options) {
      probes.push(url)
      assert.equal(options.credentials, 'omit')
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers.Range, 'bytes=0-1023')
      assert.equal(new Headers(options.headers).has('cookie'), false)
      active++
      maximum = Math.max(maximum, active)
      try { return await audio(url, options) } finally { active-- }
    } },
  }
  return { client, metadata, probes, maximum: () => maximum }
}

async function main() {
  // A valid SSR object can contain a dead cached URL even without enable_ssr_cache.
  const refreshed = fixture({ audio: url => {
    if (url === cdn('ssr')) throw Error(`net::ERR_CONNECTION_RESET at ${url}&token=fixture-private-token`)
    assert.equal(url, cdn('fresh'))
    return new Response(mp4, { status: 206 })
  } })
  assert.equal((await api.resolveAudio(refreshed.client, id)).url, cdn('fresh'))
  assert.ok(refreshed.metadata.some(url => url.pathname === '/luna/h5/seo_track'))
  assert.deepEqual(refreshed.probes, [cdn('ssr'), cdn('fresh')])

  // A CDN may return HTML with HTTP 200; that must also refresh the resolver.
  const invalidHead = fixture({ audio: url => new Response(url === cdn('ssr') ? '<html>invalid audio</html>' : mp4, { status: 200, headers: { 'Content-Type': 'audio/mp4' } }) })
  assert.equal((await api.resolveAudio(invalidHead.client, id)).url, cdn('fresh'))

  // Main and backup URLs on the same host are distinct signed resources.
  const backup = fixture({ html: missingShare, seo: playerData({ model: { video_duration: 180, video_list: [{ main_url: cdn('main-bad'), backup_url: cdn('backup-good'), video_meta: { quality: 'higher' } }] } }), audio: url => {
    if (url === cdn('main-bad')) return new Response('denied', { status: 403 })
    assert.equal(url, cdn('backup-good'))
    return new Response(mp4, { status: 206 })
  } })
  assert.equal((await api.resolveAudio(backup.client, id)).url, cdn('backup-good'))
  assert.deepEqual(new Set(backup.probes), new Set([cdn('main-bad'), cdn('backup-good')]))

  for (const model of [{}, { video_duration: 30, video_list: [{ main_url: cdn('preview'), video_meta: { quality: 'higher' } }] }]) {
    const f = fixture({ html: missingShare, seo: playerData({ model, player: { url_player_info: playerInfoUrl } }), info: playInfo([clearEntry(cdn('player-info-full'))]) })
    assert.equal((await api.resolveAudio(f.client, id)).url, cdn('player-info-full'), 'An absent or short video model must fall back to the official full-length player info')
    assert.equal(f.probes.includes(cdn('preview')), false, 'An identified preview must not reach audio playback')
    assert.equal(f.metadata.filter(url => url.hostname === 'vod-luna.douyin.com').length, 1)
  }
  const infoBackup = fixture({ html: missingShare, seo: playerData({ model: {}, player: { url_player_info: playerInfoUrl } }), info: playInfo([
    clearEntry(cdn('info-protected'), { PlayAuth: 'fixture-protected-auth' }),
    clearEntry(cdn('info-main-bad'), { BackupPlayUrl: cdn('info-backup-good'), Definition: 'medium' }),
  ]), audio: url => new Response(url === cdn('info-backup-good') ? mp4 : 'denied', { status: url === cdn('info-backup-good') ? 206 : 403 }) })
  assert.equal((await api.resolveAudio(infoBackup.client, id)).url, cdn('info-backup-good'))
  assert.deepEqual(new Set(infoBackup.probes), new Set([cdn('info-main-bad'), cdn('info-backup-good')]), 'Player-info candidates need the same protection isolation and main/backup fallback as video models')

  const clearSibling = fixture({ html: missingShare, seo: playerData({ model: { video_duration: 180, video_list: [
    { main_url: cdn('protected-higher'), video_meta: { quality: 'higher' }, encrypt_info: { kid: 'fixture-protection-id' } },
    { main_url: cdn('clear-medium'), video_meta: { quality: 'medium' } },
  ] } }) })
  assert.equal((await api.resolveAudio(clearSibling.client, id)).url, cdn('clear-medium'))
  assert.deepEqual(clearSibling.probes, [cdn('clear-medium')], 'Protection of one sibling must not taint another or permit protected audio probing')

  const qualityOrder = fixture({ html: missingShare, seo: playerData({ model: { video_duration: 180, video_list: [
    { main_url: cdn('quick-medium'), video_meta: { quality: 'medium' } },
    { main_url: cdn('slow-higher'), video_meta: { quality: 'higher' } },
  ] } }), audio: async url => {
    if (url === cdn('slow-higher')) await new Promise(resolve => setTimeout(resolve, 15))
    return new Response(mp4, { status: 206 })
  } })
  assert.equal((await api.resolveAudio(qualityOrder.client, id)).url, cdn('slow-higher'), 'An available higher stream must retain priority over a faster medium stream')
  assert.equal(qualityOrder.probes.includes(cdn('quick-medium')), false, 'Different quality levels must not race each other')

  // Object models, nested quality maps, PascalCase URLs and stringified JSON occur in official responses.
  for (const encode of [value => value, value => JSON.stringify(value), value => JSON.stringify(JSON.stringify(value)), value => JSON.stringify(JSON.stringify(JSON.stringify(value)))]) {
    const f = fixture({ html: missingShare, seo: playerData({ model: encode({ Duration: 180, quality: {
      higher: { Duration: 30, MainPlayUrl: cdn('short-higher') },
      medium: { MainPlayUrl: cdn('nested-medium') },
    } }) }) })
    assert.equal((await api.resolveAudio(f.client, id)).url, cdn('nested-medium'), 'A child duration must not overwrite its sibling inherited duration')
    assert.deepEqual(f.probes, [cdn('nested-medium')])
  }
  for (const duration of [0, '', 'not-a-number']) {
    const f = fixture({ html: missingShare, seo: playerData({ model: { video_duration: 180, video_list: [
      { main_url: cdn('inherited-duration'), duration, video_meta: { quality: 'higher' } },
    ] } }) })
    assert.equal((await api.resolveAudio(f.client, id)).url, cdn('inherited-duration'), 'A missing or invalid child duration must retain the valid parent duration')
    assert.deepEqual(f.probes, [cdn('inherited-duration')])
  }

  const skippedUrls = fixture({ html: missingShare, seo: playerData({ model: { video_duration: 180, video_list: [
    { main_url: 'https://unrelated.example/audio', backup_url: 'https://v5.example.douyinvod.com/token/00000001/expired', video_meta: { quality: 'higher' } },
    { main_url: cdn('valid-medium'), video_meta: { quality: 'medium' } },
  ] } }) })
  assert.equal((await api.resolveAudio(skippedUrls.client, id)).url, cdn('valid-medium'))
  assert.deepEqual(skippedUrls.probes, [cdn('valid-medium')], 'Invalid and expired candidates must be excluded before probing')

  const h5 = fixture({ html: missingShare, seo: playerData({ model: {} }), h5: { status_code: 0, track, track_player: { video_model: { Duration: 180, MainPlayUrl: cdn('h5-full') } } } })
  assert.equal((await api.resolveAudio(h5.client, id)).url, cdn('h5-full'))
  assert.ok(h5.metadata.some(url => url.pathname === '/luna/h5/track_v2'))
  const h5TrackInfo = fixture({ html: missingShare, seo: playerData({ model: {} }), h5: { status_code: 0, track: {}, track_info: track, track_player: { video_model: { Duration: 180, MainPlayUrl: cdn('h5-track-info') } } } })
  assert.equal((await api.resolveAudio(h5TrackInfo.client, id)).url, cdn('h5-track-info'), 'An empty track object must not hide valid H5 track_info metadata')

  const deferredCandidate = cdn('fifth-not-yet-probed')
  const limitedSource = fixture({ html: missingShare, seo: playerData({ model: { video_duration: 180, video_list: [
    ...Array.from({ length: 4 }, (_, index) => ({ main_url: cdn(`first-source-failure-${index}`), video_meta: { quality: 'higher' } })),
    { main_url: deferredCandidate, video_meta: { quality: 'higher' } },
  ] }, player: { url_player_info: playerInfoUrl } }), info: playInfo([clearEntry(deferredCandidate)]), audio: url => new Response(url === deferredCandidate ? mp4 : 'denied', { status: url === deferredCandidate ? 206 : 403 }) })
  assert.equal((await api.resolveAudio(limitedSource.client, id)).url, deferredCandidate, 'An unprobed candidate deferred by the source budget must remain eligible in player info')
  assert.deepEqual(limitedSource.probes, [...Array.from({ length: 4 }, (_, index) => cdn(`first-source-failure-${index}`)), deferredCandidate])
  assert.equal(limitedSource.metadata.filter(url => url.hostname === 'vod-luna.douyin.com').length, 1)

  // Account-required, protected, preview and digital-album flags must survive every fallback.
  for (const settings of [
    { model: { video_duration: 30, video_list: [{ main_url: cdn('preview-only') }] } },
    { model: { video_duration: 180, play_auth: 'fixture-protected-auth', video_list: [{ main_url: cdn('protected-only') }] } },
    { info: { label_info: { only_vip_playable: true } } },
    { info: { digital_track_info: { sale_period: 1 } } },
    { player: { video_model_type: 2 } },
    { player: { play_auth: 'fixture-player-protected-auth' } },
    { player: { kid: 'fixture-player-protected-id' } },
    { info: { share_status: 1 } },
  ]) {
    const data = playerData(settings)
    const f = fixture({ html: missingShare, seo: data, h5: data })
    await assert.rejects(api.resolveAudio(f.client, id), /试听|完整|受保护|数字专辑|版权/)
    assert.equal(f.probes.length, 0, 'Ineligible streams must never reach the audio network')
  }
  for (const entry of [clearEntry(cdn('protected-player-info'), { PlayAuth: 'fixture-protected-auth' }), clearEntry(cdn('preview-player-info'), { Duration: 30 })]) {
    const data = playerData({ model: {}, player: { url_player_info: playerInfoUrl } })
    const f = fixture({ html: missingShare, seo: data, info: playInfo([entry]) })
    await assert.rejects(api.resolveAudio(f.client, id), /试听|完整|受保护/)
    assert.equal(f.probes.length, 0)
  }
  for (const settings of [{ info: { label_info: { only_vip_playable: true } } }, { info: { digital_track_info: { sale_period: 1 } } }, { info: { share_status: 1 } }]) {
    const data = playerData({ ...settings, model: {}, player: { url_player_info: playerInfoUrl } })
    const f = fixture({ html: missingShare, seo: data, h5: data, info: playInfo([clearEntry(cdn('otherwise-clear-player-info'))]) })
    await assert.rejects(api.resolveAudio(f.client, id), /试听|完整|数字专辑|版权/)
    assert.equal(f.probes.length, 0, 'A clear player-info URL must not discard track-level permission restrictions')
  }
  for (const protection of [{ play_auth: 'fixture-player-protected-auth' }, { kid: 'fixture-player-protected-id' }]) {
    const data = playerData({ model: {}, player: { ...protection, url_player_info: playerInfoUrl } })
    const f = fixture({ html: missingShare, seo: data, h5: data, info: playInfo([clearEntry(cdn('player-protection-must-survive'))]) })
    await assert.rejects(api.resolveAudio(f.client, id), /受保护/)
    assert.equal(f.probes.length, 0, 'Player-info candidates must inherit protection attached to track_player')
  }

  // A mismatch is a hard identity error, rather than a reason to try another resource.
  for (const source of ['ssr', 'seo']) {
    const f = fixture(source === 'ssr' ? { html: share({ trackInfo: { ...track, id: '111' } }) } : { html: missingShare, seo: playerData({ info: { id: '111' } }) })
    await assert.rejects(api.resolveAudio(f.client, id), /编号不一致/)
    assert.equal(f.probes.length, 0)
    assert.equal(f.metadata.some(url => url.pathname === '/luna/h5/track_v2' || url.hostname === 'vod-luna.douyin.com'), false)
    if (source === 'ssr') assert.equal(f.metadata.length, 1)
  }

  for (const url of ['http://vod-luna.douyin.com/?Action=GetPlayInfo', 'https://vod-luna.douyin.com.evil.example/?Action=GetPlayInfo', 'https://vod-luna.douyin.com:444/?Action=GetPlayInfo', 'https://vod-luna.douyin.com/?Action=DeleteInfo']) {
    const data = playerData({ model: {}, player: { url_player_info: url } })
    const f = fixture({ html: missingShare, seo: data, h5: data })
    await assert.rejects(api.resolveAudio(f.client, id))
    assert.equal(f.metadata.some(item => item.hostname === 'vod-luna.douyin.com'), false, 'Unexpected player-info URLs must never be requested')
  }

  const unverified = fixture({ audio: () => { throw Error('Quality discovery must not probe the CDN') } })
  assert.equal((await api.resolveAudio(unverified.client, id, undefined, false)).url, cdn('ssr'))
  assert.equal(unverified.probes.length, 0)

  const failed = fixture({ audio: url => { throw Error(`net::ERR_CONNECTION_RESET ${url}&token=fixture-private-token account=fixture-private-account`) } })
  await assert.rejects(api.resolveAudio(failed.client, id), error => {
    assert.doesNotMatch(error.message, /https:|douyinvod|token=|fixture-private|account=|X-Signature=/, 'Errors exposed to the renderer must omit signed URLs and private values')
    return true
  })

  const many = fixture({ html: missingShare, seo: playerData({ model: { video_duration: 180, video_list: Array.from({ length: 24 }, (_, index) => ({ main_url: cdn(`unreachable-${index}`), video_meta: { quality: 'higher' } })) } }), audio: async() => {
    await new Promise(resolve => setTimeout(resolve, 2))
    throw Error('net::ERR_CONNECTION_RESET')
  } })
  await assert.rejects(api.resolveAudio(many.client, id))
  assert.ok(many.probes.length <= 12, 'One resolution must not probe an unbounded set of signed URLs')
  assert.equal(new Set(many.probes).size, many.probes.length, 'Identical signed URLs must not be retried across metadata sources')
  assert.ok(many.maximum() <= 2, 'Audio probing must keep a bounded concurrency')
  console.log('Qishui stream resolution regressions passed (refresh, main/backup, player info, identity, permissions and bounded probes).')
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
