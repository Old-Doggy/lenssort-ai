import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { curatePhotos } from './photo-curator.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-curate-'))
const output = path.join(workspace, 'sorted')
const manifestFile = path.join(output, '精选', 'selection.json')
await mkdir(output)
const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 120, g: 160, b: 180 } } }).jpeg().toBuffer()
const hash = createHash('sha256').update(bytes).digest('hex')
const source = path.join(output, 'sample.jpg')
await writeFile(source, bytes)
const base = { id: 'one', name: 'sample.jpg', status: 'done', category: '单人', faceCount: 1, faceAreaRatio: 0.2, output: source, hash, qualityScore: 90, clarityScore: 85, exposureStatus: '曝光均衡', qualityReasons: ['测试评分，不是准确率'] }
const run = records => curatePhotos({ records, output, manifestFile })
await assert.rejects(run([]), /没有可精选/)
await assert.rejects(curatePhotos({ records: [base], output, manifestFile: path.join(workspace, 'selection.json') }), /清单路径/)
const first = await run([base, { ...base, id: 'duplicate' }])
assert.equal(first.selected.length, 1)
assert.deepEqual(await readFile(first.selected[0].output), bytes)
assert.deepEqual(await readFile(source), bytes)
const second = await run([base])
assert.equal(second.folder, first.folder)
assert.equal(second.reused, true)
await writeFile(first.selected[0].output, 'unexpected-existing-content')
await assert.rejects(run([base]), /未覆盖/)
assert.equal(await readFile(first.selected[0].output, 'utf8'), 'unexpected-existing-content')
await writeFile(first.selected[0].output, bytes)
await assert.rejects(run([{ ...base, output: path.join(workspace, 'outside.jpg') }]), /来源路径/)
await writeFile(source, 'modified')
await assert.rejects(run([base]), /内容已变化/)
await writeFile(source, bytes)
const low = await run([{ ...base, qualityScore: 20, clarityScore: 10 }])
assert.equal(low.selected.length, 0)
const linkedOutput = path.join(workspace, 'linked-output')
await mkdir(linkedOutput)
await symlink(output, path.join(linkedOutput, '精选'), 'junction')
await assert.rejects(curatePhotos({ records: [{ ...base, qualityScore: 20 }], output: linkedOutput, manifestFile: path.join(linkedOutput, '精选', 'selection.json') }), /输出路径/)
await writeFile('artifacts/photo-curator-verification.json', JSON.stringify({ status: 'passed', checks: ['empty rejected', 'external manifest rejected', 'content deduplication', 'copy preserves bytes and original', 'idempotent rerun', 'conflicting destination preserved', 'outside source rejected', 'changed bytes rejected', 'no forced selection of poor photos', 'junction output rejected'], workspace }, null, 2))
console.log('10 photo curator checks passed; injected quality scores are not photo accuracy')
