import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { createFolderSorter } from './folder-sorter.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-'))
const input = path.join(workspace, 'input')
const output = path.join(workspace, 'output')
const stateDir = path.join(workspace, 'state')
let calls = 0
const analyze = async bytes => {
  calls++
  if (bytes.toString() === 'bad') throw new Error('Invalid photo fixture')
  return { category: '单人', reason: 'TEST DOUBLE - not photo accuracy', confidence: 1 }
}
const options = { input, output, stateDir, analyze, pollMs: 40, stableMs: 160 }
const waitFor = async predicate => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('Timeout waiting for automatic output')
}
const records = async () => JSON.parse(await readFile(path.join(stateDir, 'records.json'), 'utf8')).sources
const checks = []
let sorter
try {
  await assert.rejects(createFolderSorter({ ...options, output: path.join(input, 'nested') }), /overlap/i)
  checks.push('overlapping directories rejected')
  sorter = await createFolderSorter(options)
  sorter.start()
  await assert.rejects(createFolderSorter(options), /running|lock/i)
  checks.push('concurrent service rejected')
  await writeFile(path.join(input, 'first.jpg'), 'first')
  await waitFor(async () => Object.values(await records()).some(item => item.status === 'done'))
  assert.equal(await readFile(path.join(input, 'first.jpg'), 'utf8'), 'first')
  const first = Object.values(await records())[0]
  assert.equal(await readFile(first.output, 'utf8'), 'first')
  checks.push('new file classified automatically and original preserved')
  const analysisCallsBeforeRecovery = calls
  await rm(first.output)
  await new Promise(resolve => setTimeout(resolve, 420))
  await waitFor(async () => {
    try { return (await readFile(first.output, 'utf8')) === 'first' }
    catch (error) { if (error.code === 'ENOENT') return false; throw error }
  })
  assert.equal(calls, analysisCallsBeforeRecovery)
  checks.push('deleted output restored without repeated analysis')
  await mkdir(path.join(input, 'nested'))
  await writeFile(path.join(input, 'nested', 'first.jpg'), 'different')
  await writeFile(path.join(input, 'duplicate.jpg'), 'first')
  await writeFile(path.join(input, 'bad.jpg'), 'bad')
  await writeFile(path.join(input, 'good.png'), 'good')
  await waitFor(async () => Object.keys(await records()).length === 5)
  assert.equal((await readdir(path.join(output, '单人'))).filter(name => !name.endsWith('.tmp')).length, 3)
  assert.equal(Object.values(await records()).filter(item => item.status === 'failed').length, 1)
  checks.push('same names safe, content dedup, bad image does not block good image')
  const beforeRestart = calls
  await sorter.close()
  sorter = await createFolderSorter(options)
  sorter.start()
  await new Promise(resolve => setTimeout(resolve, 420))
  assert.equal(calls, beforeRestart)
  checks.push('restart does not reprocess successes or hot-loop failures')
  await writeFile(path.join(input, 'bad.jpg'), 'repaired')
  await waitFor(async () => (await records())[path.join(input, 'bad.jpg')].status === 'done')
  checks.push('changed failed image retries')
  await writeFile(path.join(input, 'partial.jpg'), 'part')
  await new Promise(resolve => setTimeout(resolve, 65))
  await writeFile(path.join(input, 'partial.jpg'), 'complete')
  await waitFor(async () => (await records())[path.join(input, 'partial.jpg')]?.status === 'done')
  assert.equal(await readFile((await records())[path.join(input, 'partial.jpg')].output, 'utf8'), 'complete')
  checks.push('partial writes settle before processing')
  const hashBefore = (await records())[path.join(input, 'first.jpg')].hash
  await writeFile(path.join(input, 'first.jpg'), 'replacement')
  await waitFor(async () => (await records())[path.join(input, 'first.jpg')].hash !== hashBefore)
  checks.push('changed successful image reclassified')
} finally { if (sorter) await sorter.close() }
const report = { status: 'passed', createdAt: new Date().toISOString(), kind: 'filesystem integration with injected analyzer - not AI accuracy', checks, workspace, calls }
await writeFile('artifacts/folder-sorter-verification.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
