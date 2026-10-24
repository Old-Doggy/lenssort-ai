import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const directory = path.join(root, 'data', 'p2-candidates', 'yolox_tiny')
const modelUrl = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx'
const licenseUrl = 'https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/main/LICENSE'
const readmeUrl = 'https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/main/README.md'

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const model = await download(modelUrl)
const license = await download(licenseUrl)
const readme = await download(readmeUrl)
await mkdir(directory, { recursive: true })
await writeFile(path.join(directory, 'yolox_tiny.onnx'), model)
await writeFile(path.join(directory, 'LICENSE'), license)
await writeFile(path.join(directory, 'README.md'), readme)

const manifest = {
  status: 'downloaded',
  phase: 'P2.2',
  candidate: 'YOLOX Tiny ONNX',
  source: { modelUrl, licenseUrl, readmeUrl },
  model: { path: 'data/p2-candidates/yolox_tiny/yolox_tiny.onnx', bytes: model.length, sha256: createHash('sha256').update(model).digest('hex') },
  license: 'Apache-2.0 (source repository LICENSE retained beside model)',
  boundary: 'Candidate only; not connected to production recognition chain.',
  downloadedAt: new Date().toISOString(),
}
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
console.log(JSON.stringify(manifest, null, 2))
