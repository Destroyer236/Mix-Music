/* Regression checks for normalized LX word timing and lyric seeking. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../src/renderer/ui/components/fullPlayerLyricTiming.ts')
const instance = new Module(filename, module)
instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { parseLyricWords, wordProgress, lyricSeekTime, parseTimedLyricText, composeLyricCopy } = instance.exports

const words = parseLyricWords('[offset:100]\n[00:10.250]<0,400>hello <400,800>world\r\n[01:02:03.1]<100,0>夜\n[00:04.50][00:05.500]<0,100>重唱\n[00:06.00]普通歌词')
assert.deepEqual(words.get(10250), [{ text: 'hello ', start: 0, duration: 400 }, { text: 'world', start: 400, duration: 800 }])
assert.equal(words.get(3723100)[0].text, '夜')
assert.equal(words.get(4500)[0].text, '重唱')
assert.equal(words.get(5500)[0].text, '重唱')
assert.equal(words.has(6000), false)
assert.equal(parseLyricWords(null).size, 0)
assert.equal(parseLyricWords('[offset:4]\nmalformed <0,500>ignored').size, 0)
assert.equal(parseLyricWords('[00:00.05]<0,100>轻').get(50)[0].text, '轻')
assert.equal(parseLyricWords('[5.2]<0,100>唱').get(5200)[0].text, '唱')

const word = words.get(10250)[1]
assert.equal(wordProgress(word, 0), 0)
assert.equal(wordProgress(word, 400), 0)
assert.equal(wordProgress(word, 800), 0.5)
assert.equal(wordProgress(word, 1200), 1)
assert.equal(wordProgress(word, 3000), 1)
assert.equal(wordProgress({ start: 100, duration: 0 }, 99), 0)
assert.equal(wordProgress({ start: 100, duration: 0 }, 100), 1)

assert.equal(lyricSeekTime(10000, 500, 180), 9.5)
assert.equal(lyricSeekTime(10000, -500, 180), 10.5)
assert.equal(lyricSeekTime(100, 500, 180), 0)
assert.equal(lyricSeekTime(190000, 0, 180), 180)
assert.equal(lyricSeekTime(10000, 0, 0), 10)
const translations = parseTimedLyricText('[00:01.20][00:02.200]翻译\n[00:02.200]第二行\n[offset:100]\n[00:03.000]//')
assert.equal(translations.get(1200), '翻译')
assert.equal(translations.get(2200), '翻译\n第二行')
assert.equal(translations.has(3000), false)
const lines = [{ text: 'Hello', translation: '你好', romanization: 'ni hao' }, { text: 'World', translation: '世界', romanization: '' }]
const copyOptions = { original: true, translation: true, romanization: true, songName: true, artist: true, emptyLine: false }
assert.equal(composeLyricCopy(lines, copyOptions, '测试歌曲', '歌手'), 'Hello\n你好\nni hao\nWorld\n世界\n—— 《测试歌曲》 - 歌手')
assert.equal(composeLyricCopy(lines, { ...copyOptions, original: false, romanization: false, artist: false, songName: false, emptyLine: true }, '', ''), '你好\n\n世界')
assert.equal(composeLyricCopy([], { ...copyOptions, songName: false, artist: false }, '', ''), '')
console.log('Full player lyric timing and copy: 27 assertions passed.')
