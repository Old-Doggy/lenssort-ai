import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'
import { createFolderSorter } from './folder-sorter.js'

const root = process.cwd()
const checks = []
const samples = [
  { name: 'portrait.jpg', path: 'data/eval/photos/portrait.jpg', source: 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg' },
  { name: 'synthetic.png', path: 'data/eval/similarity_cases/case10_scene_a.png', source: 'existing synthetic fixture - not a landscape accuracy sample' },
]
const providers = []
for (const backend of ['cpu', 'dml']) {
  const analyzer = await createPhotoAnalyzer(root, backend)
  try {
    const bytes = await readFile(samples[0].path)
    const result = await analyzer.analyze(bytes)
    assert.equal(result.backend, backend)
    assert.ok(result.faces.faceCount >= 1)
    assert.equal(result.category, '单人')
    assert.equal(result.npuVerified, false)
    providers.push({ backend, result })
  } finally { await analyzer.close() }
}
checks.push('CPU and DirectML real model inference with positive face detection')
const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-real-'))
const input = path.join(workspace, 'inbox')
const output = path.join(workspace, 'sorted')
const stateDir = path.join(workspace, 'state')
const analyzer = await createPhotoAnalyzer(root)
let sorter
try {
  sorter = await createFolderSorter({ input, output, stateDir, pollMs: 80, stableMs: 300, analyze: bytes => analyzer.analyze(bytes) })
  sorter.start()
  for (const sample of samples) await writeFile(path.join(input, sample.name), await readFile(sample.path))
  await writeFile(path.join(input, 'invalid.jpg'), 'invalid image')
  const deadline = Date.now() + 60000
  let state
  while (Date.now() < deadline) {
    state = JSON.parse(await readFile(path.join(stateDir, 'records.json'), 'utf8'))
    if (Object.keys(state.sources).length === 3) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(Object.keys(state.sources).length, 3)
  assert.equal(Object.values(state.sources).filter(item => item.status === 'done').length, 2)
  assert.equal(Object.values(state.sources).filter(item => item.status === 'failed').length, 1)
  for (const sample of samples) {
    const original = await readFile(path.join(input, sample.name))
    const record = state.sources[path.join(input, sample.name)]
    assert.deepEqual(await readFile(record.output), original)
    sample.sha256 = createHash('sha256').update(original).digest('hex')
  }
  checks.push('files added after startup classified automatically, corrupt image isolated, originals/copies identical')
  await sorter.close()
  sorter = null
  const report = { status: 'passed', createdAt: new Date().toISOString(), checks, providers, samples, records: state.sources, workspace, npuVerified: false, limitations: ['two images do not establish classification accuracy', 'face count is not guaranteed person count', 'DirectML selected provider is not NPU or per-operator profiling proof'] }
  await writeFile('artifacts/folder-model-verification.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, checks, providers: providers.map(item => ({ backend: item.backend, category: item.result.category, faces: item.result.faces.faceCount, classificationMs: item.result.classificationMs })), npuVerified: false }, null, 2))
} finally { if (sorter) await sorter.close(); await analyzer.close() }
