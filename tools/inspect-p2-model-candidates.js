import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as ort from 'onnxruntime-node'

const root = process.cwd()
const modelsRoot = path.join(root, 'public', 'models')
const output = path.join(root, 'artifacts', 'p2-model-candidate-inventory.json')

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await walk(fullPath))
    else result.push(fullPath)
  }
  return result
}

async function describeFile(filePath) {
  const bytes = await readFile(filePath)
  return { path: path.relative(root, filePath).replaceAll('\\', '/'), bytes: (await stat(filePath)).size, sha256: createHash('sha256').update(bytes).digest('hex') }
}

async function loadOnnx(relativePath) {
  const startedAt = performance.now()
  try {
    const session = await ort.InferenceSession.create(path.join(root, relativePath), { executionProviders: ['cpu'], executionMode: 'sequential' })
    const result = { status: 'loadable', durationMs: Math.round(performance.now() - startedAt), inputs: session.inputNames, outputs: session.outputNames }
    await session.release()
    return result
  } catch (error) {
    return { status: 'failed', durationMs: Math.round(performance.now() - startedAt), error: error instanceof Error ? error.message : String(error) }
  }
}

function probe(executable, args) {
  try {
    const value = execFileSync(executable, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 'succeeded', value: JSON.parse(value) }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

const files = await Promise.all((await walk(modelsRoot)).map(describeFile))
const onnxChecks = {}
for (const file of files.filter(item => item.path.endsWith('.onnx'))) onnxChecks[file.path] = await loadOnnx(file.path)
const clipRoot = 'public/models/Xenova/clip-vit-base-patch32/'
const clipRequired = ['config.json', 'preprocessor_config.json', 'onnx/vision_model_quantized.onnx'].map(name => clipRoot + name)
const clipMissing = clipRequired.filter(name => !files.some(file => file.path === name))
const hasTokenizer = files.some(file => file.path === clipRoot + 'tokenizer.json')
const dxgi = probe('python', ['tools/dxgi-adapters.py'])
const winml = probe(path.join(root, '.venv-winml', 'Scripts', 'python.exe'), ['tools/winml-discover.py'])

const report = {
  status: 'completed-with-boundaries',
  phase: 'P2.1',
  generatedAt: new Date().toISOString(),
  scope: 'read-only local resource audit; production recognition chain unchanged',
  runtime: { node: process.version, onnxruntime: ort.version, providerProbe: 'session-level CPU load plus separate DXGI/WinML probes' },
  devices: { dxgi, winml },
  files: { count: files.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), entries: files, onnxChecks },
  clip: { required: clipRequired, missing: clipMissing, hasTokenizer, usableForZeroShot: clipMissing.length === 0 && hasTokenizer },
  candidates: [
    { role: '人物检测', status: 'missing-local-model', direction: 'YOLO/YOLOX/RT-DETR person-only ONNX', boundary: 'MobileNet 不是人物框检测模型；MediaPipe Short Range 不能覆盖全部远距离和全身人物。' },
    { role: '人脸辅助', status: 'local-browser-only', direction: '保留 MediaPipe，并对小脸、侧脸、口罩做 P2.2 实测', boundary: '文件存在不等于召回率提升，也不等于 onnxruntime-node 可加载。' },
    { role: '场景语义', status: hasTokenizer ? 'candidate' : 'incomplete-local-package', direction: 'CLIP zero-shot image classification', boundary: '缺少 tokenizer 或文本侧资源时不能宣称文本零样本分类可用。' },
    { role: '审美评分', status: 'missing-local-model', direction: 'NIMA/AVA 或 CLIP aesthetic predictor ONNX', boundary: '技术清晰度不能替代审美评分；P2 只选一个体积可控候选。' },
  ],
  nextStep: 'P2.2：仅对可运行候选在固定 41 张回归样本上做基线，再选定一套组合并停止并行试验。',
}

await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ status: report.status, output: path.relative(root, output), modelFiles: files.length, onnxFiles: Object.keys(onnxChecks).length, clipMissing, dxgi: dxgi.status, winml: winml.status }, null, 2))
