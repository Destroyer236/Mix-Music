/* Synthetic LX source for isolated tests. It never requests third-party music. */
function createImportedScript(baseUrl, options = {}) {
  const parsed = new URL(baseUrl)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw Error('The test fixture requires a loopback HTTP URL')
  const config = { name: '本地导入测试源', sources: { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] } }, mode: 'success', ...options }
  return `/**
 * @name ${String(config.name).replace(/[\r\n]/g, '')}
 * @description 仅返回本地生成音频的隔离回归测试源
 * @author LinkLine tests
 * @version 1.0.0
 */
(() => {
  const config = ${JSON.stringify(config)};
  const base = ${JSON.stringify(parsed.origin)};
  lx.on(lx.EVENT_NAMES.request, async ({ source, action, info }) => {
    const params = new URLSearchParams({ source, action, type: String(info.type), song: String(info.musicInfo.songmid), name: config.name });
    await new Promise((resolve, reject) => {
      lx.request(base + '/called?' + params, { method: 'get' }, (error) => error ? reject(error) : resolve());
    });
    if (config.mode === 'failure') throw new Error('synthetic imported source failure');
    if (config.mode === 'pending') return new Promise(() => {});
    if (config.mode === 'invalid-url') return 'file:///synthetic.wav';
    return base + '/tone.wav?' + params;
  });
  if (config.mode !== 'init-pending') {
    if (config.initDelay) setTimeout(() => lx.send(lx.EVENT_NAMES.inited, { sources: config.sources }), config.initDelay);
    else lx.send(lx.EVENT_NAMES.inited, { sources: config.sources });
  }
})();
`
}

function createTone() {
  const sampleRate = 16000
  const frames = sampleRate / 2
  const audio = Buffer.alloc(44 + frames * 2)
  audio.write('RIFF', 0)
  audio.writeUInt32LE(audio.length - 8, 4)
  audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(sampleRate, 24)
  audio.writeUInt32LE(sampleRate * 2, 28)
  audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34)
  audio.write('data', 36)
  audio.writeUInt32LE(frames * 2, 40)
  for (let index = 0; index < frames; index++) audio.writeInt16LE(Math.round(Math.sin(index * Math.PI * 880 / sampleRate) * 1800), 44 + index * 2)
  return audio
}

module.exports = { createImportedScript, createTone }
