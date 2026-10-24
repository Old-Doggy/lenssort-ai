import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'

const root = process.cwd()
const samplesPath = path.join(root, 'artifacts', 'p1-failure-samples.json')
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=')
  return [key, rest.join('=') || 'true']
}))
const modelPath = path.resolve(root, args.model ?? 'data/p2-candidates/yolox_tiny/yolox_tiny.onnx')
const candidate = args.candidate ?? path.basename(path.dirname(modelPath))
const outputPath = path.resolve(root, args.output ?? `artifacts/p2-${candidate}-baseline.json`)
const personClassIndex = 0

function tensorToRows(tensor) {
  const dims = tensor.dims ?? []
  const values = tensor.data
  if (dims.length !== 3 || dims[0] !== 1) throw new Error(`unexpected YOLOX output dims: ${JSON.stringify(dims)}`)
  if (dims[2] >= 6 && dims[2] <= 100) {
    const rowSize = dims[2]
    return { rows: dims[1], rowSize, get: (row, column) => values[row * rowSize + column], layout: 'rows-by-features' }
  }
  if (dims[1] >= 6 && dims[1] <= 100) {
    const rows = dims[2]
    return { rows, rowSize: dims[1], get: (row, column) => values[column * dims[2] + row], layout: 'features-by-rows' }
  }
  throw new Error(`unsupported YOLOX output dims: ${JSON.stringify(dims)}`)
}

async function makeInput(bytes, inputSize) {
  const image = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().metadata()
  const width = image.width ?? 1
  const height = image.height ?? 1
  const scale = Math.min(inputSize / width, inputSize / height)
  const resizedWidth = Math.max(1, Math.round(width * scale))
  const resizedHeight = Math.max(1, Math.round(height * scale))
  const left = 0
  const top = 0
  const rgb = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().resize(resizedWidth, resizedHeight, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer()
  const chw = new Float32Array(3 * inputSize * inputSize)
  chw.fill(114)
  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const source = (y * resizedWidth + x) * 3
      const target = (top + y) * inputSize + left + x
      chw[target] = rgb[source]
      chw[inputSize * inputSize + target] = rgb[source + 1]
      chw[2 * inputSize * inputSize + target] = rgb[source + 2]
    }
  }
  return { tensor: new ort.Tensor('float32', chw, [1, 3, inputSize, inputSize]), width, height, scale, left, top }
}

function decodePersonCandidates(output, transform, inputSize) {
  const table = tensorToRows(output)
  const candidates = []
  const grids = []
  for (const stride of [8, 16, 32]) {
    const side = inputSize / stride
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) grids.push({ x, y, stride })
  }
  if (grids.length !== table.rows) throw new Error(`YOLOX grid rows ${grids.length} do not match output rows ${table.rows}`)
  for (let row = 0; row < table.rows; row++) {
    const grid = grids[row]
    const objectness = table.get(row, 4)
    const classScore = table.get(row, 5 + personClassIndex)
    const score = objectness * classScore
    if (!Number.isFinite(score) || score < 0.15) continue
    const centerX = (table.get(row, 0) + grid.x) * grid.stride
    const centerY = (table.get(row, 1) + grid.y) * grid.stride
    const boxWidth = Math.exp(table.get(row, 2)) * grid.stride
    const boxHeight = Math.exp(table.get(row, 3)) * grid.stride
    const x = (centerX - boxWidth / 2 - transform.left) / transform.scale
    const y = (centerY - boxHeight / 2 - transform.top) / transform.scale
    const width = boxWidth / transform.scale
    const height = boxHeight / transform.scale
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue
    candidates.push({ score, x, y, width, height, objectness, classScore })
  }
  candidates.sort((left, right) => right.score - left.score)
  return { layout: table.layout, rowCount: table.rows, rowSize: table.rowSize, candidates: candidates.slice(0, 100) }
}

function intersectionOverUnion(left, right) {
  const x1 = Math.max(left.x, right.x)
  const y1 = Math.max(left.y, right.y)
  const x2 = Math.min(left.x + left.width, right.x + right.width)
  const y2 = Math.min(left.y + left.height, right.y + right.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

function nonMaximumSuppression(candidates, threshold = 0.45) {
  const remaining = [...candidates].sort((left, right) => right.score - left.score)
  const kept = []
  while (remaining.length > 0) {
    const current = remaining.shift()
    kept.push(current)
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (intersectionOverUnion(current, remaining[index]) >= threshold) remaining.splice(index, 1)
    }
  }
  return kept
}

const samples = JSON.parse(await readFile(samplesPath, 'utf8')).samples
const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], executionMode: 'sequential' })
const inputName = session.inputNames[0]
const outputName = session.outputNames[0]
const inputShape = session.inputMetadata?.[inputName]?.dimensions ?? session.inputMetadata?.[inputName]?.dims ?? [1, 3, 416, 416]
const inputSize = Number(args['input-size'] ?? inputShape[2])
if (!Number.isInteger(inputSize) || inputSize <= 0 || (args['input-size'] === undefined && inputShape[3] !== inputSize)) throw new Error(`unsupported YOLOX input shape: ${JSON.stringify(inputShape)}`)
const startedAt = performance.now()
const results = []
for (const sample of samples) {
  const itemStartedAt = performance.now()
  try {
    const bytes = await readFile(sample.source)
    const input = await makeInput(bytes, inputSize)
    const outputs = await session.run({ [inputName]: input.tensor })
    const decoded = decodePersonCandidates(outputs[outputName], input, inputSize)
    const nms = nonMaximumSuppression(decoded.candidates)
    const thresholds = Object.fromEntries([0.15, 0.25, 0.4].map(threshold => [String(threshold), nonMaximumSuppression(decoded.candidates.filter(candidate => candidate.score >= threshold)).length]))
    results.push({ name: sample.name, source: sample.source, expectedCategory: sample.expectedCategory, tags: sample.tags, currentFaceCount: sample.currentFaceCount, durationMs: Math.round(performance.now() - itemStartedAt), rawCandidateCount: decoded.candidates.length, nmsCandidateCount: nms.length, maxPersonScore: decoded.candidates[0]?.score ?? 0, thresholdCounts: thresholds, candidates: nms, outputLayout: decoded.layout, outputRows: decoded.rowCount, outputRowSize: decoded.rowSize })
  } catch (error) {
    results.push({ name: sample.name, source: sample.source, expectedCategory: sample.expectedCategory, tags: sample.tags, durationMs: Math.round(performance.now() - itemStartedAt), error: error instanceof Error ? error.message : String(error) })
  }
}
await session.release()
const detected = results.filter(item => item.nmsCandidateCount > 0)
const report = {
  status: results.length === samples.length && results.every(item => !item.error) ? 'completed-with-boundaries' : 'completed-with-errors',
  phase: 'P2.2',
  candidate,
  inputSize,
  sampleCount: samples.length,
  processedCount: results.length,
  errorCount: results.filter(item => item.error).length,
  personCandidateCount: detected.length,
  thresholdDetectionCounts: Object.fromEntries([0.15, 0.25, 0.4].map(threshold => [String(threshold), results.filter(item => Number(item.thresholdCounts?.[String(threshold)] ?? 0) > 0).length])),
  taggedPersonRiskCount: samples.filter(sample => sample.tags.includes('person-missed')).length,
  taggedSceneRiskCount: samples.filter(sample => sample.tags.includes('scene-missed')).length,
  totalDurationMs: Math.round(performance.now() - startedAt),
  averageDurationMs: results.length ? Math.round(results.reduce((sum, item) => sum + item.durationMs, 0) / results.length) : null,
  boundary: 'This is a candidate output and timing baseline, not an independently labeled accuracy or recall measurement. Results are not written to production cache.',
  results,
}
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ status: report.status, candidate: report.candidate, sampleCount: report.sampleCount, processedCount: report.processedCount, errorCount: report.errorCount, personCandidateCount: report.personCandidateCount, averageDurationMs: report.averageDurationMs, output: path.relative(root, outputPath).replaceAll('\\', '/') }, null, 2))
