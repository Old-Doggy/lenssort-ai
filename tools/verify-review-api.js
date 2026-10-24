import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createControlServer } from './control-server.js'

const root = process.cwd()
const fixture = await mkdtemp(path.join(os.tmpdir(), 'lenssort-review-api-'))
const manifest = JSON.parse(await readFile(path.join(root, 'artifacts/open-images-download-manifest.json'), 'utf8'))
const record = manifest.records[0]
const fixtureSource = path.join(fixture, record.localPath)
await mkdir(path.dirname(fixtureSource), { recursive: true })
await copyFile(path.join(root, record.localPath), fixtureSource)
await mkdir(path.join(fixture, 'tools'), { recursive: true })
await copyFile(path.join(root, 'tools/dxgi-adapters.py'), path.join(fixture, 'tools/dxgi-adapters.py'))
await mkdir(path.join(fixture, 'artifacts'), { recursive: true })
await writeFile(path.join(fixture, 'artifacts/open-images-download-manifest.json'), JSON.stringify({ ...manifest, records: [{ ...record, localPath: record.localPath }] }))
const server = await createControlServer({ root: fixture, controlDir: path.join(fixture, 'control'), port: 0 })
const origin = server.origin
try {
  const status = await (await fetch(origin + '/api/status')).json()
  const review = await (await fetch(origin + '/api/review')).json()
  assert.equal(review.total, 1)
  assert.equal((await fetch(origin + '/api/review/thumbnail/' + record.imageId)).status, 200)
  const headers = { 'content-type': 'application/json', 'x-lenssort-token': status.token, origin }
  const invalid = await fetch(origin + '/api/review', { method: 'POST', headers, body: JSON.stringify({ imageId: record.imageId, label: 'invalid' }) })
  assert.equal(invalid.status, 400)
  const saved = await fetch(origin + '/api/review', { method: 'POST', headers, body: JSON.stringify({ imageId: record.imageId, label: '风景' }) })
  assert.equal(saved.status, 200)
  const next = await saved.json()
  assert.equal(next.reviewed, 1)
  await writeFile('artifacts/review-api-verification.json', JSON.stringify({ status: 'passed', createdAt: new Date().toISOString(), checks: ['review list', 'review thumbnail', 'invalid label rejected', 'label persisted through API'] }, null, 2))
  console.log(JSON.stringify({ status: 'passed', reviewed: next.reviewed }, null, 2))
} finally { await server.close() }
