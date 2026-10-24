import assert from 'node:assert/strict'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { ensureOllama } from './ollama-lifecycle.js'
import { inspectResources, ollamaRequest } from './model-resources.js'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'
import { summarizeGeneralEvaluation } from './general-evaluation-summary.js'

const baselineOnly = process.argv.includes('--gemma-baseline')
const reportFile = path.resolve(baselineOnly ? 'artifacts/g1-gemma-baseline-evaluation.json' : 'artifacts/g1-general-evaluation.json')
const report = { createdAt: new Date().toISOString(), completed: false, independentAccuracy: null, boundary: 'Local engineering and AI-assisted proxy comparison, not human accuracy or subjective aesthetic acceptance.', models: [], skipped: [], results: [], summaries: [] }
const historical = JSON.parse(await readFile('artifacts/precision-research/samples-refined.json', 'utf8'))
const samples = historical.map(sample => ({ ...sample, slice: 'historical', labelSource: sample.labelSource }))
samples.push({ file: 'F:\\测试\\测试\\_MG_7166 - 副本.JPG', slice: 'new-user-feedback', labelSource: 'User reported one real person with statue; category single-person and visible blur feedback', proxyLabel: '单人' })
for (const category of ['单人', '多人', '人物与风景', '风景', '其他', '待确认']) {
  const folder = path.resolve('data/eval/labeled', category)
  const entries = (await readdir(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error })).filter(name => /\.jpg$/i.test(name)).sort()
  const file = entries.map(name => path.join(folder, name)).find(file => !samples.some(sample => path.resolve(sample.file) === file))
  if (file) samples.push({ file, proxyLabel: category, slice: 'held-out-proxy', labelSource: 'Existing AI-assisted folder labels, not independent human truth' })
}
for (const sample of samples) {
  await access(sample.file)
  sample.sha256 = createHash('sha256').update(await readFile(sample.file)).digest('hex')
}
samples.push({ ...samples[0], slice: 'degraded', variant: 'blur-8-darken-0.65', proxyLabel: undefined, labelSource: 'Synthetic perturbation of historical source; robustness observation only' })
report.samples = samples
await writeFile('artifacts/g1-frozen-samples.json', JSON.stringify(samples, null, 2))
let service
let analyzer
try {
  service = await ensureOllama()
  report.service = { status: service.status, message: service.message }
  assert.equal(((await ollamaRequest('/api/ps')).models ?? []).length, 0, 'Existing user resident models must remain untouched')
  report.installed = (await ollamaRequest('/api/tags')).models ?? []
  report.before = await inspectResources()
  for (const model of baselineOnly ? ['gemma3:4b'] : ['qwen3.5:4b', 'qwen3.5:9b']) {
    const available = await inspectResources()
    if (!report.installed.some(item => item.name === model) || available.freeRamGiB < (model.endsWith('9b') ? 12 : 8) || available.freeVramGiB < (model.endsWith('9b') ? 9 : 6)) {
      report.skipped.push({ model, available, reason: 'Not installed or current safety headroom insufficient; no force loading or download during experiment' })
      continue
    }
    analyzer = await createPhotoAnalyzer(process.cwd(), 'cpu', model, { experimentalReview: true })
    assert.equal(analyzer.visionModelStatus.model, model, 'No model substitutions during comparison')
    report.models.push({ model, digest: report.installed.find(item => item.name === model)?.digest })
    await evaluate(model, analyzer)
    await analyzer.close()
    analyzer = null
  }
  assert.ok(report.results.length, 'At least one candidate must actually run')
  report.afterResident = (await ollamaRequest('/api/ps')).models ?? []
  assert.equal(report.afterResident.length, 0, 'Owned models must be released')
  report.completed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  if (analyzer) await analyzer.close()
  report.summaries = summarizeGeneralEvaluation(report.results)
  if (service) { await service.stop(); report.ownedServiceStopped = service.status === 'started' }
  await writeFile(reportFile, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ completed: report.completed, rows: report.results.length, skipped: report.skipped, error: report.error, reportFile }))
}

async function evaluate(model, engine) {
  for (const sample of samples) {
    let bytes = await readFile(sample.file)
    if (sample.variant) bytes = await sharp(bytes).blur(8).modulate({ brightness: 0.65 }).jpeg().toBuffer()
    const result = await engine.analyze(bytes)
    const row = { ...sample, inputSha256: createHash('sha256').update(bytes).digest('hex'), model, result }
    report.results.push(row)
    console.log(JSON.stringify({ model, file: path.basename(sample.file), variant: sample.variant, category: result.category, calls: result.visionExplanation?.reviewCalls, durationMs: result.durationMs }))
    report.summaries = summarizeGeneralEvaluation(report.results)
    await writeFile(reportFile, JSON.stringify(report, null, 2))
  }
}
