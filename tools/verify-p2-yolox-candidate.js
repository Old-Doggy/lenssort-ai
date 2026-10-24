import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as ort from 'onnxruntime-node'

const root = process.cwd()
const modelPath = path.join(root, 'data', 'p2-candidates', 'yolox_tiny', 'yolox_tiny.onnx')
const manifestPath = path.join(root, 'data', 'p2-candidates', 'yolox_tiny', 'manifest.json')
const modelBytes = await readFile(modelPath)
const startedAt = performance.now()
const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], executionMode: 'sequential' })
const model = {
  path: 'data/p2-candidates/yolox_tiny/yolox_tiny.onnx',
  bytes: (await stat(modelPath)).size,
  sha256: createHash('sha256').update(modelBytes).digest('hex'),
  loadDurationMs: Math.round(performance.now() - startedAt),
  inputs: session.inputNames,
  outputs: session.outputNames,
  inputMetadata: session.inputMetadata,
  outputMetadata: session.outputMetadata,
}
await session.release()
const manifest = {
  status: 'verified-candidate',
  phase: 'P2.2',
  candidate: 'YOLOX Tiny ONNX',
  source: { modelUrl: 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx', licenseUrl: 'https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/main/LICENSE' },
  license: { status: 'verified-local-copy', name: 'Apache-2.0', path: 'data/p2-candidates/yolox_tiny/LICENSE' },
  companionFiles: { readme: { status: 'missing-after-download', path: 'data/p2-candidates/yolox_tiny/README.md' } },
  model,
  boundary: 'ONNX session load proves format compatibility only; no detection accuracy or person recall claim yet.',
  verifiedAt: new Date().toISOString(),
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
console.log(JSON.stringify({ status: manifest.status, model: model.path, bytes: model.bytes, sha256: model.sha256, loadDurationMs: model.loadDurationMs, inputs: model.inputs, outputs: model.outputs, readme: manifest.companionFiles.readme.status }, null, 2))
