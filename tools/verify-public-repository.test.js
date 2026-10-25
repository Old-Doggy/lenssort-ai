import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)

test('公开仓库自检脚本可运行并通过当前仓库', async () => {
  const result = await execute(process.execPath, ['tools/verify-public-repository.js'], { windowsHide: true, maxBuffer: 2_000_000 })
  const report = JSON.parse(result.stdout)
  assert.equal(report.status, 'passed')
  assert.deepEqual(report.failures, [])
  assert.ok(report.inspectedFiles > 0)
})
