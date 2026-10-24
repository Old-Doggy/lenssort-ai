import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'

const script = 'tools/benchmark-folder-devices.js'
const fixture = await mkdtemp(path.join(process.cwd(), 'artifacts/benchmark-options-'))
try {
  for (const value of ['1', '2']) {
    const result = spawnSync(process.execPath, [script, '--input=' + fixture, '--concurrency=' + value], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /No benchmark images found/)
  }
  for (const value of ['0', '3', '-1', '2x', '12']) {
    const result = spawnSync(process.execPath, [script, '--input=' + fixture, '--concurrency=' + value], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /concurrency must be 1 or 2/)
  }
} finally {
  await rm(fixture, { recursive: true, force: true })
}
console.log(JSON.stringify({ status: 'passed', checks: ['concurrency 1 and 2 accepted', 'zero, negative, non-integer and out-of-range values rejected'] }, null, 2))
