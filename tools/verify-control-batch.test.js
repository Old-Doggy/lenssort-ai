import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { createControlServer } from './control-server.js'

test('HTTP batch auto stops, releases analyzer and preserves progress', async () => {
  const root = process.cwd()
  const workspace = await mkdtemp(path.resolve('artifacts/control-batch-'))
  const input = path.join(workspace, '输入')
  const output = path.join(workspace, '输出')
  const controlDir = path.join(workspace, 'control')
  await mkdir(input)
  await writeFile(path.join(input, 'photo.jpg'), 'test bytes')
  let closed = 0
  let analyzed = 0
  const server = await createControlServer({ root, controlDir, port: 0, analyzerFactory: async () => ({
    device: { name: 'test CPU' }, npuVerified: false,
    analyze: async () => { analyzed++; return { category: '风景' } },
    close: async () => { closed++ },
  }) })
  const get = async () => fetch(server.origin + '/api/status').then(response => response.json())
  const token = (await get()).token
  const post = async (route, body = {}) => {
    const response = await fetch(server.origin + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lenssort-token': token }, body: JSON.stringify(body) })
    assert.equal(response.status, 200, await response.text())
  }
  const waitStopped = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const status = await get()
      if (status.phase === 'stopped') return status
      await sleep(50)
    }
    throw new Error('HTTP batch did not auto stop')
  }
  try {
    await post('/api/config', { input, output, backend: 'cpu' })
    await post('/api/start')
    const status = await waitStopped()
    assert.equal(status.progress.phase, 'finished')
    assert.equal(status.progress.completed, 1)
    assert.equal(status.progress.total, 1)
    assert.equal(closed, 1)
    assert.equal(status.device.name, 'test CPU')
    const state = createHash('sha256').update(input + '\n' + output).digest('hex').slice(0, 24)
    await assert.rejects(access(path.join(controlDir, state, 'service.lock')), { code: 'ENOENT' })
    await writeFile(path.join(input, 'new.jpg'), 'new bytes')
    await sleep(600)
    assert.equal(analyzed, 1)
    await post('/api/start')
    assert.equal((await waitStopped()).progress.total, 2)
    assert.equal(analyzed, 2)
    assert.equal(closed, 2)
  } finally { await server.close() }
})
