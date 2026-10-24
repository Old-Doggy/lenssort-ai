import { fork } from 'node:child_process'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-entry-'))
const stateDir = path.join(workspace, 'state')
const input = path.join(workspace, 'input')
const output = path.join(workspace, 'output')
const child = fork('tools/run-folder-sorter.js', [], { silent: true, env: { ...process.env, LENSSORT_INPUT: input, LENSSORT_OUTPUT: output, LENSSORT_STATE: stateDir, LENSSORT_BACKEND: 'cpu' } })
const events = []
let buffer = ''
let stderr = ''
child.stdout.on('data', bytes => {
  buffer += bytes.toString()
  const lines = buffer.split('\n')
  buffer = lines.pop()
  for (const line of lines) { try { events.push(JSON.parse(line)) } catch {} }
})
child.stderr.on('data', bytes => { stderr += bytes.toString() })
const completion = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
const waitFor = async predicate => {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    if (predicate()) return
    if (child.exitCode !== null) throw new Error('CLI exited before verification: ' + stderr)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('CLI timeout: ' + stderr)
}
try {
  await waitFor(() => events.some(event => event.type === 'started'))
  await writeFile(path.join(input, 'portrait.jpg'), await readFile('data/eval/photos/portrait.jpg'))
  await waitFor(() => events.some(event => event.type === 'classified'))
  assert.equal(events.find(event => event.type === 'classified').category, '单人')
  child.send('shutdown')
  const exited = await completion
  assert.equal(exited.code, 0)
  await assert.rejects(access(path.join(stateDir, 'service.lock')), { code: 'ENOENT' })
  const report = { status: 'passed', createdAt: new Date().toISOString(), workspace, events, exited, checks: ['actual CLI startup', 'photo added after startup automatically classified', 'shutdown releases lock and browser/model resources'] }
  await writeFile('artifacts/folder-entry-verification.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { if (child.exitCode === null && child.connected) { child.send('shutdown'); await completion } }
