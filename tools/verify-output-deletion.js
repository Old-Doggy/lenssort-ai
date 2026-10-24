import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createFolderSorter } from './folder-sorter.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-output-delete-'))
const input = path.join(workspace, 'input')
const output = path.join(workspace, 'output')
const stateDir = path.join(workspace, 'state')
const source = path.join(input, 'manual-delete.jpg')
const duplicateSource = path.join(input, 'manual-delete-duplicate.jpg')
const original = Buffer.from('original-photo-fixture')
let analysisCalls = 0
const analyze = async () => {
  analysisCalls++
  return { category: '单人', reason: 'TEST DOUBLE - not photo accuracy', confidence: 1 }
}
const options = { input, output, stateDir, analysisVersion: 4, analyze, pollMs: 30, stableMs: 100 }
const readSources = async () => JSON.parse(await readFile(path.join(stateDir, 'records.json'), 'utf8')).sources
const waitFor = async predicate => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('Timeout waiting for output deletion fixture')
}
const checks = []
let sorter
try {
  await Promise.all([input, output, stateDir].map(folder => mkdir(folder, { recursive: true })))
  await writeFile(source, original)
  await writeFile(duplicateSource, original)
  sorter = await createFolderSorter(options)
  sorter.start()
  await waitFor(async () => (await readSources())[source]?.status === 'done' && (await readSources())[duplicateSource]?.status === 'done')
  const first = (await readSources())[source]
  const duplicate = (await readSources())[duplicateSource]
  assert.equal(duplicate.output, first.output)
  await access(first.output)
  assert.deepEqual(await readFile(source), original)
  checks.push('classified output exists and input bytes are preserved')

  await sorter.deleteOutput(source)
  await assert.rejects(access(first.output))
  assert.deepEqual(await readFile(source), original)
  const deleted = (await readSources())[source]
  assert.equal(deleted.status, 'output-deleted')
  assert.equal(deleted.manualAction, 'deleted-output')
  assert.equal(deleted.output, null)
  assert.equal((await readSources())[duplicateSource].status, 'output-deleted')
  checks.push('manual deletion removes only the output copy and persists suppression state')

  await new Promise(resolve => setTimeout(resolve, 350))
  await assert.rejects(access(path.join(output, '单人', path.basename(first.output))))
  assert.equal(analysisCalls, 1)
  checks.push('running scan does not restore a manually deleted output')

  await sorter.close()
  sorter = await createFolderSorter(options)
  sorter.start()
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal((await readSources())[source].status, 'output-deleted')
  assert.equal((await readSources())[duplicateSource].status, 'output-deleted')
  assert.equal(analysisCalls, 1)
  checks.push('restart keeps manual deletion state without reanalysis')
} finally {
  if (sorter) await sorter.close()
}
const report = { status: 'passed', createdAt: new Date().toISOString(), kind: 'output-copy deletion safety with injected analyzer - not AI accuracy', checks, workspace, analysisCalls }
await writeFile('artifacts/p4-3-output-delete.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
