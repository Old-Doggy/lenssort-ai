import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createFolderSorter } from './folder-sorter.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-rescan-'))
const input = path.join(workspace, '中文来源')
const output = path.join(workspace, '中文结果')
const stateDir = path.join(workspace, 'state')
const source = path.join(input, 'source.jpg')
const original = Buffer.from('rescan-source-fixture')
const options = { input, output, stateDir, analysisVersion: 4, pollMs: 30, stableMs: 100, analyze: async () => ({ category: '单人', sceneLabel: 'TEST DOUBLE' }) }
const readSources = async () => JSON.parse(await readFile(path.join(stateDir, 'records.json'), 'utf8')).sources
const waitFor = async predicate => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('Timeout waiting for rescan fixture')
}
const checks = []
let sorter
try {
  await Promise.all([input, output, stateDir].map(folder => mkdir(folder, { recursive: true })))
  await writeFile(source, original)
  sorter = await createFolderSorter(options)
  sorter.start()
  await waitFor(async () => (await readSources())[source]?.status === 'done')
  await sorter.updateCategory(source, '风景')
  const outputPath = (await readSources())[source].output
  await rm(source)
  const removed = await sorter.rescan()
  assert.equal(removed.sourceMissing, 1)
  assert.equal((await readSources())[source].status, 'source-missing')
  assert.equal((await readSources())[source].manualCategory, '风景')
  checks.push('source removal is persisted and manual category remains')

  await writeFile(source, original)
  const restored = await sorter.rescan()
  assert.equal(restored.restoredSources, 1)
  assert.equal((await readSources())[source].status, 'done')
  checks.push('returning source restores the prior valid output without reanalysis')

  await rm(outputPath)
  const missing = await sorter.rescan()
  assert.equal(missing.outputMissing, 1)
  assert.equal((await readSources())[source].status, 'output-missing')
  assert.equal((await readSources())[source].manualCategory, '风景')
  checks.push('external output deletion is distinct from manual deletion and preserves manual category')

  await writeFile(outputPath, original)
  await sorter.rescan()
  assert.equal((await readSources())[source].status, 'done')
  await sorter.deleteOutput(source)
  const deleted = await sorter.rescan()
  assert.equal(deleted.outputDeleted, 1)
  assert.equal((await readSources())[source].status, 'output-deleted')
  checks.push('manual output deletion remains suppressed after rescan')

  await writeFile(path.join(input, 'new.jpg'), Buffer.from('new-rescan-fixture'))
  const added = await sorter.rescan()
  assert.equal(added.newFiles, 1)
  checks.push('new source files are reported by rescan')
} finally {
  if (sorter) await sorter.close()
}
const report = { status: 'passed', createdAt: new Date().toISOString(), kind: 'filesystem rescan with injected analyzer - not AI accuracy', checks, workspace }
await writeFile('artifacts/p5-3-rescan-verification.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
