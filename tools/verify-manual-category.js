import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createFolderSorter } from './folder-sorter.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-manual-category-'))
const input = path.join(workspace, '中文照片来源')
const output = path.join(workspace, '中文分类结果')
const stateDir = path.join(workspace, 'state')
const source = path.join(input, '人物与风景-测试.jpg')
const original = Buffer.from('manual-category-photo-fixture')
let sorter
const options = { input, output, stateDir, analysisVersion: 4, pollMs: 30, stableMs: 100, analyze: async () => ({ category: '人物与风景', sceneLabel: 'TEST DOUBLE' }) }
const readSources = async () => JSON.parse(await readFile(path.join(stateDir, 'records.json'), 'utf8')).sources
const waitFor = async predicate => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('Timeout waiting for manual category fixture')
}
const checks = []
try {
  await Promise.all([input, output, stateDir].map(folder => mkdir(folder, { recursive: true })))
  await writeFile(source, original)
  sorter = await createFolderSorter(options)
  sorter.start()
  await waitFor(async () => (await readSources())[source]?.status === 'done')
  const before = (await readSources())[source]
  const originalHash = before.hash
  const oldOutput = before.output
  await access(oldOutput)
  const moved = await sorter.updateCategory(source, '风景')
  assert.equal(moved.manualCategory, '风景')
  assert.equal(moved.manualAction, 'category-corrected')
  assert.equal(moved.result.category, '风景')
  assert.notEqual(moved.output, oldOutput)
  await assert.rejects(access(oldOutput))
  await access(moved.output)
  assert.deepEqual(await readFile(source), original)
  assert.equal((await readSources())[source].hash, originalHash)
  checks.push('manual category moves only the output copy and preserves source bytes')

  await sorter.close()
  sorter = await createFolderSorter(options)
  sorter.start()
  await new Promise(resolve => setTimeout(resolve, 350))
  const restarted = (await readSources())[source]
  assert.equal(restarted.manualCategory, '风景')
  assert.equal(restarted.result.category, '风景')
  assert.equal(restarted.output, moved.output)
  checks.push('manual category persists across sorter restart without reanalysis')

  await assert.rejects(sorter.updateCategory(source, '非法类别'), /无效分类/)
  checks.push('invalid categories are rejected')
  const repeated = await sorter.updateCategory(source, '风景')
  assert.equal(repeated.output, moved.output)
  assert.equal(repeated.manualCategory, '风景')
  checks.push('repeated correction is idempotent after the output was moved')
} finally {
  if (sorter) await sorter.close()
}
const report = { status: 'passed', createdAt: new Date().toISOString(), kind: 'manual category output-copy move with injected analyzer - not AI accuracy', checks, workspace }
await writeFile('artifacts/p5-2-manual-category-verification.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
