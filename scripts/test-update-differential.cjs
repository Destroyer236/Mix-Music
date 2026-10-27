/* 增量更新：块索引解析、差分计划、区间合并与 Range 头。

   这些是纯函数，覆盖三类关键行为：
   1. 正常差分只下载变化的块，其余从旧安装包复用；
   2. 缺少旧块索引 / 版本号不一致 / 旧文件过短时，必须安全退回全量；
   3. 损坏或伪造的块索引必须被拒绝，而不是产出错误计划。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

function load(relative) {
  const file = path.join(root, relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => name.startsWith('@common/') ? load(`src/common/${name.slice(8)}.ts`) : nativeRequire(name)
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file)
  return instance.exports
}

const { parseBlockMap, planDifferential, groupRanges, rangeHeader, parseContentRange } = load('src/main/modules/appUpdate/differential.ts')
const { BLOCKMAP_SUFFIX } = load('src/common/appUpdate.ts')

const map = (sizes, checksums, version = '2') => ({ version, files: [{ name: 'file', offset: 0, checksums, sizes }] })

async function main() {
/* ---------- 解析 ---------- */

const valid = JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums: ['a', 'b'], sizes: [100, 200] }] })
assert.deepEqual(parseBlockMap(valid).files[0].sizes, [100, 200], '正常块索引应能解析')
assert.equal(parseBlockMap(valid).version, '2')

// 损坏输入必须抛错，不能当成空块索引（否则会算出「全部复制」的错误计划）。
for (const [label, input] of [
  ['非 JSON', 'not json'],
  ['缺 files', JSON.stringify({ version: '2' })],
  ['files 为空', JSON.stringify({ version: '2', files: [] })],
  ['校验值与块大小数量不符', JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums: ['a'], sizes: [1, 2] }] })],
  ['块大小非正', JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums: ['a'], sizes: [0] }] })],
  ['偏移为负', JSON.stringify({ version: '2', files: [{ name: 'file', offset: -1, checksums: ['a'], sizes: [1] }] })],
]) {
  assert.throws(() => parseBlockMap(input), undefined, `${label} 应被拒绝`)
}

/* ---------- 差分计划 ---------- */

// 未变化的块复制，变化的块下载。总计必须等于新文件大小。
{
  const oldMap = map([100, 100, 100], ['a', 'b', 'c'])
  const newMap = map([100, 100, 100], ['a', 'X', 'c'])
  const plan = planDifferential(oldMap, newMap, { oldFileSize: 300 })
  assert.equal(plan.reusable, true)
  assert.equal(plan.downloadBytes, 100, '只有变化块需要下载')
  assert.equal(plan.copyBytes, 200, '未变化块从旧文件复制')
  assert.equal(plan.downloadBytes + plan.copyBytes, 300, '计划总量等于新文件大小')
  const download = plan.operations.filter(operation => operation.kind === 'download')
  assert.deepEqual(download.map(operation => [operation.start, operation.end]), [[100, 200]], '下载区间应精确定位变化块')
}

// 相邻的变化块合并成一次请求；相邻的复制块也合并。
{
  const oldMap = map([100, 100, 100, 100], ['a', 'b', 'c', 'd'])
  const newMap = map([100, 100, 100, 100], ['a', 'X', 'Y', 'd'])
  const plan = planDifferential(oldMap, newMap, { oldFileSize: 400 })
  const downloads = plan.operations.filter(operation => operation.kind === 'download')
  assert.equal(downloads.length, 1, '相邻变化块应合并为单个区间')
  assert.deepEqual([downloads[0].start, downloads[0].end], [100, 300])
  const copies = plan.operations.filter(operation => operation.kind === 'copy')
  assert.equal(copies.length, 2, '变化块两侧的复制区间各自成段')
  // 复制区间必须指向旧文件中的正确偏移。
  assert.equal(copies[0].oldStart, 0, '第一段复制对应旧文件开头')
  assert.equal(copies[1].oldStart, 300, '第二段复制对应旧文件尾部')
}

// 没有旧块索引：全部下载，且明确不可复用。
{
  const plan = planDifferential(null, map([100, 100], ['a', 'b']), {})
  assert.equal(plan.reusable, false)
  assert.equal(plan.downloadBytes, 200)
  assert.equal(plan.copyBytes, 0)
  assert.equal(plan.operations.length, 1, '连续下载区间应合并')
}

// 块索引版本号不一致：不能跨格式复制。
{
  const plan = planDifferential(map([100], ['a'], '1'), map([100], ['a'], '2'), { oldFileSize: 100 })
  assert.equal(plan.reusable, false, '版本号不同应放弃差分')
  assert.equal(plan.downloadBytes, 100)
}

// 旧文件比复制区间短：不能复制超出文件末尾的数据。
{
  const plan = planDifferential(map([100, 100], ['a', 'b']), map([100, 100], ['a', 'b']), { oldFileSize: 100 })
  const copies = plan.operations.filter(operation => operation.kind === 'copy')
  assert.equal(copies.length, 1, '只有能完整覆盖的块才复制')
  assert.equal(plan.downloadBytes, 100, '超出旧文件长度的块改为下载')
}

// 校验值相同但大小不同：不能复用（同一校验值对应不同长度是危险的）。
{
  const plan = planDifferential(map([100], ['same']), map([200], ['same']), { oldFileSize: 100 })
  assert.equal(plan.copyBytes, 0, '大小不一致的块不能复制')
}

// 文件完全相同：应全部复制、下载 0 字节。
{
  const plan = planDifferential(map([100, 100], ['a', 'b']), map([100, 100], ['a', 'b']), { oldFileSize: 200 })
  assert.equal(plan.downloadBytes, 0)
  assert.equal(plan.copyBytes, 200)
}

// 块区域不从文件头开始时必须放弃差分：块索引之外的前置字节没有数据来源。
{
  const oldMap = { version: '2', files: [{ name: 'file', offset: 50, checksums: ['a'], sizes: [100] }] }
  const newMap = { version: '2', files: [{ name: 'file', offset: 50, checksums: ['a'], sizes: [100] }] }
  const plan = planDifferential(oldMap, newMap, { oldFileSize: 200 })
  assert.equal(plan.reusable, false, 'offset 非 0 时不能差分')
  assert.equal(plan.copyBytes, 0, '不能复制来路不明的偏移')
  assert.equal(plan.downloadBytes, 100, '应全部改为下载')
}

/* ---------- Range 合并与头部 ---------- */

// 相邻区间直接合并，小间隔也合并，大间隔保持独立。
{
  const operations = [
    { kind: 'download', start: 0, end: 100 },
    { kind: 'copy', start: 100, end: 200, oldStart: 0 },
    { kind: 'download', start: 200, end: 300 },
    { kind: 'download', start: 5000, end: 6000 },
  ]
  const ranges = groupRanges(operations)
  assert.equal(ranges.length, 2, '近邻下载区间应合并，远距离保持独立')
  assert.deepEqual(ranges[0], { start: 0, end: 300 })
  assert.deepEqual(ranges[1], { start: 5000, end: 6000 })
  // 只有 copy 时不应产生任何请求。
  assert.equal(groupRanges([{ kind: 'copy', start: 0, end: 10, oldStart: 0 }]).length, 0)
}

// 单次请求不超过上限，避免一次 Range 过大导致镜像拒绝。
{
  const operations = [
    { kind: 'download', start: 0, end: 6 * 1024 * 1024 },
    { kind: 'download', start: 6 * 1024 * 1024, end: 18 * 1024 * 1024 },
  ]
  const ranges = groupRanges(operations, { maxBytes: 8 * 1024 * 1024 })
  assert.ok(ranges.length >= 2, '超出上限的区间应被拆开')
  for (const range of ranges) assert.ok(range.end - range.start <= 8 * 1024 * 1024, '每个请求都在上限内')
  assert.equal(ranges.reduce((sum, range) => sum + (range.end - range.start), 0), 18 * 1024 * 1024, '拆分不丢字节')
}

// Range 头是闭区间（HTTP 语义）。
assert.equal(rangeHeader({ start: 0, end: 1024 }), 'bytes=0-1023')
assert.equal(rangeHeader({ start: 500, end: 501 }), 'bytes=500-500')

/* ---------- Content-Range 解析 ---------- */

assert.deepEqual(parseContentRange('bytes 0-1023/119682680'), { start: 0, end: 1023, total: 119682680 })
// 任何异常格式都返回 null，由调用方决定如何处理。
for (const value of [null, '', 'bytes */123', 'bytes 0-1023', 'items 0-1/2', 'bytes 5-4/10', 'bytes 0-10/5']) {
  assert.equal(parseContentRange(value), null, `无法解析的 Content-Range 应返回 null: ${String(value)}`)
}

/* ---------- 与真实 electron-builder 块索引互通 ---------- */

// 直接用 electron-builder 生成的块索引验证解析器，确保格式假设成立。
{
  const { buildBlockMap } = require(path.resolve(root, 'node_modules/app-builder-lib/out/targets/blockmap/blockmap.js'))
  const dir = path.join(root, 'artifacts', 'blockmap-fixture')
  fs.mkdirSync(dir, { recursive: true })
  const oldFile = path.join(dir, 'old.bin')
  const newFile = path.join(dir, 'new.bin')
  // 3 MB 内容，在中间改 64 KB，其余不变。
  const size = 3 * 1024 * 1024
  const base = Buffer.alloc(size, 0x5A)
  fs.writeFileSync(oldFile, base)
  const changed = Buffer.from(base)
  Buffer.alloc(64 * 1024, 0x11).copy(changed, 1024 * 1024)
  fs.writeFileSync(newFile, changed)
  const oldInfo = await buildBlockMap(oldFile, 'gzip', `${oldFile}.blockmap`)
  const newInfo = await buildBlockMap(newFile, 'gzip', `${newFile}.blockmap`)
  const oldMap = parseBlockMap(zlib.gunzipSync(fs.readFileSync(`${oldFile}.blockmap`)).toString())
  const newMap = parseBlockMap(zlib.gunzipSync(fs.readFileSync(`${newFile}.blockmap`)).toString())
  const plan = planDifferential(oldMap, newMap, { oldFileSize: oldInfo.size })
  assert.equal(plan.reusable, true, '真实块索引应可复用')
  assert.equal(plan.downloadBytes + plan.copyBytes, newInfo.size, '计划覆盖完整文件')
  assert.ok(plan.downloadBytes < newInfo.size * 0.2, `只改 64KB 时应只下载少量数据，实际 ${plan.downloadBytes}`)
  assert.ok(plan.copyBytes > 0, '应大量复用旧内容')
  // 验证复制区间确实能在旧文件中读取到与新文件一致的字节。
  const oldBuf = fs.readFileSync(oldFile)
  const newBuf = fs.readFileSync(newFile)
  for (const operation of plan.operations) {
    if (operation.kind !== 'copy') continue
    const length = operation.end - operation.start
    assert.ok(oldBuf.subarray(operation.oldStart, operation.oldStart + length).equals(newBuf.subarray(operation.start, operation.end)), '复制区间内容必须一致')
  }
  fs.rmSync(dir, { recursive: true, force: true })
}

assert.equal(BLOCKMAP_SUFFIX, '.blockmap')

console.log('update differential: OK')

}

main().catch(error => { console.error(error); process.exit(1) })
