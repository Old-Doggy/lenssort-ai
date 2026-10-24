import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env, pipeline } from '@huggingface/transformers'

const root = process.cwd()
const samplesPath = path.join(root, 'artifacts', 'p1-failure-samples.json')
const outputPath = path.join(root, 'artifacts', 'p2-clip-scene-baseline.json')
const modelId = 'Xenova/clip-vit-base-patch32'
const modelRoot = path.join(root, 'public', 'models')
const labels = [
  'a natural landscape',
  'a cityscape',
  'a building or architectural scene',
  'a night scene',
  'a portrait of one person',
  'a group photo',
  'a person in an environment',
  'an indoor scene',
  'an ordinary object',
]

env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = modelRoot

const startedAt = performance.now()
const classifier = await pipeline('zero-shot-image-classification', modelId, { device: 'cpu', dtype: 'q8', local_files_only: true })
const loadDurationMs = Math.round(performance.now() - startedAt)
const samples = JSON.parse(await readFile(samplesPath, 'utf8')).samples
const results = []
for (const sample of samples) {
  const itemStartedAt = performance.now()
  try {
    const output = await classifier(sample.source, labels)
    const topK = output.slice(0, labels.length).map(item => ({ label: item.label, score: item.score }))
    results.push({ name: sample.name, source: sample.source, expectedCategory: sample.expectedCategory, tags: sample.tags, topK, topLabel: topK[0]?.label ?? null, topScore: topK[0]?.score ?? null, durationMs: Math.round(performance.now() - itemStartedAt) })
  } catch (error) {
    results.push({ name: sample.name, source: sample.source, expectedCategory: sample.expectedCategory, tags: sample.tags, error: error instanceof Error ? error.message : String(error), durationMs: Math.round(performance.now() - itemStartedAt) })
  }
}
if (typeof classifier.dispose === 'function') await classifier.dispose()
const report = {
  status: results.every(item => !item.error) ? 'completed-with-boundaries' : 'completed-with-errors',
  phase: 'P2.2',
  candidate: modelId,
  device: 'cpu',
  dtype: 'q8',
  labels,
  sampleCount: samples.length,
  processedCount: results.length,
  errorCount: results.filter(item => item.error).length,
  loadDurationMs,
  totalDurationMs: Math.round(performance.now() - startedAt),
  averageDurationMs: results.length ? Math.round(results.reduce((sum, item) => sum + item.durationMs, 0) / results.length) : null,
  boundary: 'Zero-shot scores are a candidate semantic baseline, not independent ground truth or final category accuracy. Results are not written to production cache.',
  results,
}
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ status: report.status, candidate: report.candidate, sampleCount: report.sampleCount, processedCount: report.processedCount, errorCount: report.errorCount, loadDurationMs: report.loadDurationMs, averageDurationMs: report.averageDurationMs, output: 'artifacts/p2-clip-scene-baseline.json' }, null, 2))
