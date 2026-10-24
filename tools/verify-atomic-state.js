import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { writeAtomicJson } from './atomic-state.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-atomic-state-'))
const destination = path.join(workspace, 'records.json')
await writeFile(destination, JSON.stringify({ version: 'old' }))
let attempts = 0
await writeAtomicJson(destination, { version: 'new' }, {
  replace: async (source, target) => {
    attempts++
    if (attempts < 3) throw Object.assign(new Error('Injected Windows sharing conflict'), { code: 'EPERM' })
    await rename(source, target)
  },
})
assert.equal(attempts, 3)
assert.equal(JSON.parse(await readFile(destination, 'utf8')).version, 'new')
attempts = 0
await assert.rejects(writeAtomicJson(destination, { version: 'invalid' }, {
  replace: async () => { attempts++; throw Object.assign(new Error('Persistent sharing conflict'), { code: 'EBUSY' }) },
}), /Persistent sharing conflict/)
assert.equal(attempts, 7)
assert.equal(JSON.parse(await readFile(destination, 'utf8')).version, 'new')
assert.deepEqual(await readdir(workspace), ['records.json'])
attempts = 0
await assert.rejects(writeAtomicJson(destination, { version: 'invalid' }, {
  replace: async () => { attempts++; throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }) },
}), /Disk full/)
assert.equal(attempts, 1)
assert.deepEqual(await readdir(workspace), ['records.json'])
await writeFile('artifacts/atomic-state-verification.json', JSON.stringify({ status: 'passed', workspace, checks: ['transient sharing conflict retries and persists', 'persistent conflict bounded to seven attempts', 'previous JSON retained on failure', 'temporary files cleaned', 'non-transient errors not retried'], kind: 'injected filesystem errors, not model evaluation' }, null, 2))
console.log('5 atomic state checks passed')
