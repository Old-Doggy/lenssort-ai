import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { ensureOllama } from './ollama-lifecycle.js'
import { inspectResources, ollamaRequest } from './model-resources.js'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'
import { summarizeG2Evaluation } from './g2-evaluation-summary.js'

const model = process.argv.find(item => item.startsWith('--model='))?.slice(8) || 'qwen3.5:4b'
const split = process.argv.find(item => item.startsWith('--split='))?.slice(8) || 'development'
const phase = process.argv.find(item => item.startsWith('--phase='))?.slice(8) || 'baseline'
const referencePath = process.argv.find(item => item.startsWith('--reference='))?.slice(12) || 'artifacts/g2-reference-labels.json'
assert.ok(['qwen3.5:4b', 'qwen3.5:9b', 'gemma3:4b'].includes(model))
assert.ok(['development', 'acceptance'].includes(split))
assert.match(phase, /^[a-z0-9-]+$/)
assert.match(referencePath.replaceAll('\\', '/'), /^artifacts\//)
const file = `artifacts/g2-${phase}-${model.replace(':', '-')}-${split}.json`
const frozen = JSON.parse(await readFile(referencePath, 'utf8'))
const report = { createdAt: new Date().toISOString(), model, split, phase, complete: false, independentAccuracy: null, labelBoundary: frozen.labelStatus, results: [], resourceSamples: [] }
let service
let analyzer
try {
  service = await ensureOllama()
  assert.ok(['started', 'reused'].includes(service.status), service.message)
  report.service = service.status
  report.before = await inspectResources()
  report.initialResident = (await ollamaRequest('/api/ps')).models ?? []
  assert.equal(report.initialResident.length, 0, 'Do not replace user resident models')
  analyzer = await createPhotoAnalyzer(process.cwd(), 'cpu', model)
  assert.equal(analyzer.visionModelStatus.model, model, 'Do not count substitutions')
  for (const sample of frozen.records.filter(row => row.split === split)) {
    const bytes = await readFile(sample.file)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sample.sha256)
    const before = await inspectResources()
    const result = await analyzer.analyze(bytes)
    const after = await inspectResources()
    report.results.push({ ...sample, model, result })
    report.resourceSamples.push({ id: sample.id, before, after })
    report.summaries = summarizeG2Evaluation(report.results)
    await writeFile(file, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ id: sample.id, category: result.category, ms: result.durationMs, visual: result.visionExplanation?.generated }))
    assert.equal(result.visionExplanation?.generated, true, 'Stop comparison on visual fallback')
    assert.equal(result.visionExplanation?.model, model, 'Stop comparison when the selected model changes')
    assert.equal(result.visionModelStatus?.requestedModel, model, 'Requested model changed during comparison')
  }
  report.complete = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  if (analyzer) await analyzer.close()
  if (service && ['started', 'reused'].includes(service.status)) report.afterResident = (await ollamaRequest('/api/ps')).models ?? []
  if (service) { await service.stop(); report.ownedServiceStopped = service.status === 'started' }
  report.summaries = summarizeG2Evaluation(report.results)
  await writeFile(file, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ complete: report.complete, summary: report.summaries, error: report.error, file }))
}
