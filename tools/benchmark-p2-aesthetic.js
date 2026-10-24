import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env, pipeline } from '@huggingface/transformers'

const root = process.cwd()
const samplesPath = path.join(root, 'artifacts', 'p1-failure-samples.json')
const weightsPath = path.join(root, 'artifacts', 'p2-laion-aesthetic-weights.json')
const outputPath = path.join(root, 'artifacts', 'p2-aesthetic-baseline.json')
const modelId = 'Xenova/clip-vit-base-patch32'
env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = path.join(root, 'public', 'models')

function normalize(data) {
  const vector = Array.from(data, Number)
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(norm) || norm === 0) throw new Error('CLIP 返回了无效 embedding')
  return vector.map(value => value / norm)
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  if (!sorted.length) return null
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function normalizeScore(value, minimum, maximum) {
  if (!Number.isFinite(value) || !Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return 50
  return Math.max(0, Math.min(100, ((value - minimum) / (maximum - minimum)) * 100))
}

function ranking(results, field) {
  return results.filter(item => Number.isFinite(item[field])).sort((left, right) => right[field] - left[field]).map((item, index) => ({ name: item.name, score: item[field], rank: index + 1 }))
}

const startedAt = performance.now()
const samples = JSON.parse(await readFile(samplesPath, 'utf8')).samples
const weights = JSON.parse(await readFile(weightsPath, 'utf8'))
if (weights.weightDimension !== 512 || weights.weight.length !== 512 || !Number.isFinite(weights.bias)) throw new Error('LAION 权重校验失败')
const loadStartedAt = performance.now()
const extractor = await pipeline('image-feature-extraction', modelId, { device: 'cpu', dtype: 'q8', local_files_only: true })
const loadDurationMs = Math.round(performance.now() - loadStartedAt)
const results = []
for (const sample of samples) {
  const itemStartedAt = performance.now()
  try {
    const output = await extractor(sample.source)
    const embedding = normalize(output.data)
    if (embedding.length !== weights.weightDimension) throw new Error(`embedding 维度为 ${embedding.length}，预期 ${weights.weightDimension}`)
    const aestheticScore = embedding.reduce((sum, value, index) => sum + value * weights.weight[index], weights.bias)
    results.push({ name: sample.name, source: sample.source, sha256: sample.sha256, expectedCategory: sample.expectedCategory, currentCategory: sample.currentCategory, currentQualityScore: sample.currentQualityScore, tags: sample.tags, embeddingDimension: embedding.length, aestheticScore, durationMs: Math.round(performance.now() - itemStartedAt) })
  } catch (error) {
    results.push({ name: sample.name, source: sample.source, sha256: sample.sha256, expectedCategory: sample.expectedCategory, currentCategory: sample.currentCategory, currentQualityScore: sample.currentQualityScore, tags: sample.tags, error: error instanceof Error ? error.message : String(error), durationMs: Math.round(performance.now() - itemStartedAt) })
  }
}
if (typeof extractor.dispose === 'function') await extractor.dispose()
const successful = results.filter(item => Number.isFinite(item.aestheticScore))
const aestheticValues = successful.map(item => item.aestheticScore)
const qualityValues = successful.map(item => Number(item.currentQualityScore)).filter(Number.isFinite)
const aestheticMinimum = percentile(aestheticValues, 0.05)
const aestheticMaximum = percentile(aestheticValues, 0.95)
const qualityMinimum = percentile(qualityValues, 0.05)
const qualityMaximum = percentile(qualityValues, 0.95)
for (const item of successful) {
  item.aestheticScoreNormalized = Math.round(normalizeScore(item.aestheticScore, aestheticMinimum, aestheticMaximum) * 100) / 100
  item.technicalQualityNormalized = Math.round(normalizeScore(Number(item.currentQualityScore), qualityMinimum, qualityMaximum) * 100) / 100
  item.combinedScore = Math.round((item.aestheticScoreNormalized * 0.65 + item.technicalQualityNormalized * 0.35) * 100) / 100
}

const report = {
  status: results.every(item => !item.error) ? 'completed-with-boundaries' : 'completed-with-errors',
  phase: 'P2.2',
  candidate: 'CLIP ViT-B/32 image embedding + LAION aesthetic predictor V1 linear head',
  modelId,
  device: 'cpu',
  dtype: 'q8',
  sampleCount: samples.length,
  processedCount: results.length,
  successCount: successful.length,
  errorCount: results.filter(item => item.error).length,
  loadDurationMs,
  totalDurationMs: Math.round(performance.now() - startedAt),
  averageDurationMs: results.length ? Math.round(results.reduce((sum, item) => sum + item.durationMs, 0) / results.length) : null,
  normalization: {
    aestheticP05: aestheticMinimum,
    aestheticP95: aestheticMaximum,
    technicalQualityP05: qualityMinimum,
    technicalQualityP95: qualityMaximum,
    combinedWeights: { aesthetic: 0.65, technicalQuality: 0.35 },
  },
  ranking: {
    aesthetic: ranking(results, 'aestheticScore'),
    technicalQuality: ranking(results, 'currentQualityScore'),
    combined: ranking(results, 'combinedScore'),
  },
  boundary: 'LAION 分数是公开审美候选模型输出，不等同于用户主观好看；组合分数仅用于固定样本排序实验，不写入生产链路。当前样本没有独立人工金标准，也不宣称审美准确率。',
  results,
}
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ status: report.status, candidate: report.candidate, sampleCount: report.sampleCount, successCount: report.successCount, errorCount: report.errorCount, loadDurationMs: report.loadDurationMs, averageDurationMs: report.averageDurationMs, output: 'artifacts/p2-aesthetic-baseline.json' }, null, 2))
