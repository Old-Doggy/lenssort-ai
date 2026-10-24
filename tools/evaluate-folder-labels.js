import path from 'node:path'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'

const categories = ['单人', '多人', '人物与风景', '风景', '其他', '待确认']
const categorySet = new Set(categories)
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif'])
const root = process.cwd()

function option(name, fallback) {
  const prefix = '--' + name + '='
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

async function collectImages(folder, label) {
  const entries = await readdir(folder, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const file = path.join(folder, entry.name)
    if (entry.isDirectory()) files.push(...await collectImages(file, label))
    else if (entry.isFile() && imageExtensions.has(path.extname(file).toLowerCase())) files.push({ file, actual: label })
  }
  return files
}

async function collectDataset(datasetRoot, limitPerClass) {
  const entries = await readdir(datasetRoot, { withFileTypes: true })
  const unknown = entries.filter(entry => entry.isDirectory() && !categorySet.has(entry.name)).map(entry => entry.name)
  if (unknown.length) throw new Error('Unknown label folders: ' + unknown.join(', '))
  const samples = []
  for (const category of categories) {
    const folder = path.join(datasetRoot, category)
    const exists = entries.some(entry => entry.isDirectory() && entry.name === category)
    if (!exists) continue
    const classSamples = await collectImages(folder, category)
    samples.push(...(limitPerClass > 0 ? classSamples.slice(0, limitPerClass) : classSamples))
  }
  return samples.sort((left, right) => left.file.localeCompare(right.file))
}

function createMatrix() {
  return Object.fromEntries(categories.map(actual => [actual, Object.fromEntries(categories.map(predicted => [predicted, 0]))]))
}

function metricsFor(matrix, label, support) {
  const truePositive = matrix[label][label]
  const falsePositive = categories.reduce((sum, actual) => sum + (actual === label ? 0 : matrix[actual][label]), 0)
  const falseNegative = categories.reduce((sum, predicted) => sum + (predicted === label ? 0 : matrix[label][predicted]), 0)
  const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0
  const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0
  return { support, truePositive, falsePositive, falseNegative, precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)), f1: Number(f1.toFixed(4)) }
}

function summarize(records) {
  const matrix = createMatrix()
  for (const record of records) {
    if (record.ok && categorySet.has(record.predicted)) matrix[record.actual][record.predicted]++
  }
  const supports = Object.fromEntries(categories.map(category => [category, records.filter(record => record.actual === category).length]))
  const perClass = Object.fromEntries(categories.map(category => [category, metricsFor(matrix, category, supports[category])] ))
  const evaluated = records.filter(record => record.ok)
  const correct = evaluated.filter(record => record.actual === record.predicted).length
  const macro = categories.reduce((sum, category) => sum + perClass[category].f1, 0) / categories.length
  const weighted = evaluated.length ? categories.reduce((sum, category) => sum + perClass[category].f1 * supports[category], 0) / evaluated.length : 0
  const errorSamples = records.filter(record => !record.ok || record.actual !== record.predicted).map(record => ({ file: record.file, actual: record.actual, predicted: record.predicted ?? null, error: record.error ?? null }))
  return {
    attempted: records.length,
    evaluated: evaluated.length,
    failed: records.length - evaluated.length,
    accuracy: evaluated.length ? Number((correct / evaluated.length).toFixed(4)) : null,
    macroF1: Number(macro.toFixed(4)),
    weightedF1: Number(weighted.toFixed(4)),
    confusionMatrix: matrix,
    perClass,
    errorSamples,
  }
}

const dataset = path.resolve(option('dataset', path.join(root, 'data/eval/labeled')))
const limitPerClass = Math.max(0, Number.parseInt(option('limit-per-class', '0'), 10) || 0)
const minPerClass = Math.max(1, Number.parseInt(option('min-per-class', '1'), 10) || 1)
const backends = option('backends', 'cpu,igpu,dgpu,npu').split(',').map(item => item.trim()).filter(Boolean)
const reviewEvidencePath = path.join(root, 'artifacts', 'f5-assisted-review.json')
const reviewEvidence = await readFile(reviewEvidencePath, 'utf8').then(JSON.parse).catch(() => null)
const labelSource = reviewEvidence?.reviewMethod === 'ai-assisted-visual-review' ? 'ai-assisted-visual-review' : 'unknown'
const independentHumanGroundTruth = reviewEvidence?.independentHumanGroundTruth === true
const samples = await collectDataset(dataset, limitPerClass)
if (!samples.length) throw new Error('No labeled images found. Create folders named ' + categories.join(', '))
const sampleCounts = Object.fromEntries(categories.map(category => [category, samples.filter(sample => sample.actual === category).length]))
const missingCategories = categories.filter(category => sampleCounts[category] < minPerClass)

const report = {
  status: missingCategories.length ? 'partial' : (independentHumanGroundTruth ? 'passed' : 'proxy-passed'),
  createdAt: new Date().toISOString(),
  dataset,
  evaluationKind: independentHumanGroundTruth ? 'human-ground-truth-evaluation' : 'ai-assisted-proxy-evaluation',
  labelSource,
  independentHumanGroundTruth,
  sampleCount: samples.length,
  sampleCounts,
  minPerClass,
  missingCategories,
  limitPerClass,
  backends,
  measurements: [],
  limitations: [
    independentHumanGroundTruth
      ? 'Accuracy is valid only for samples with reliable human-provided folder labels.'
      : 'Labels were produced by AI-assisted visual review and are proxy labels, not independent human ground truth.',
    'Face count is a detector signal and is not guaranteed to equal the real number of people.',
    'A small or imbalanced dataset should not be used as a general photo-album accuracy claim.',
  ],
}
if (missingCategories.length) report.limitations.push('Evaluation is partial until every category has at least ' + minPerClass + ' labeled image(s).')

for (const backend of backends) {
  const measurement = { backend, device: null, summary: null, records: [], errors: [] }
  let analyzer
  try {
    analyzer = await createPhotoAnalyzer(root, backend)
    measurement.device = analyzer.device
    for (const sample of samples) {
      try {
        const result = await analyzer.analyze(await readFile(sample.file))
        measurement.records.push({ file: path.relative(dataset, sample.file), actual: sample.actual, predicted: result.category, confidence: result.confidence, faceCount: result.faces?.faceCount ?? null, ok: true, device: result.device?.id ?? null, npuVerified: result.npuVerified === true })
      } catch (error) {
        measurement.records.push({ file: path.relative(dataset, sample.file), actual: sample.actual, ok: false, error: error.message })
        measurement.errors.push({ file: path.relative(dataset, sample.file), error: error.message })
      }
    }
    measurement.summary = summarize(measurement.records)
    measurement.npuVerified = measurement.records.some(record => record.npuVerified)
    if (backend === 'npu' && !measurement.npuVerified) measurement.errors.push({ error: 'NPU evaluation did not produce verified VitisAI photo inference evidence' })
  } catch (error) {
    measurement.errors.push({ phase: 'initialization', error: error.message })
  } finally {
    if (analyzer) await analyzer.close()
  }
  if (measurement.errors.length) report.status = 'partial'
  report.measurements.push(measurement)
}

await mkdir(path.join(root, 'artifacts'), { recursive: true })
await writeFile(path.join(root, 'artifacts/folder-label-evaluation.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  status: report.status,
  dataset: report.dataset,
  sampleCount: report.sampleCount,
  sampleCounts: report.sampleCounts,
  missingCategories: report.missingCategories,
  measurements: report.measurements.map(item => ({ backend: item.backend, device: item.device?.name ?? null, summary: item.summary, npuVerified: item.npuVerified, errors: item.errors.length })),
}, null, 2))
if (!['passed', 'proxy-passed'].includes(report.status)) process.exitCode = 1
