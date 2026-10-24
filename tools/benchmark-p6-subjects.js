import assert from 'node:assert/strict'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { ensureOllama } from './ollama-lifecycle.js'
import { inspectResources, ollamaRequest } from './model-resources.js'
import { createVisionLanguageExplainer } from './vision-language-explainer.js'

const reportFile = path.resolve('artifacts/p6-subject-model-comparison.json')
const samples = ['_MG_7166 - 副本.JPG', '_MG_7157.JPG', '_MG_7129.JPG'].map(name => path.join('F:\\测试\\测试', name))
const models = ['qwen3.5:4b', 'qwen3.5:9b']
const report = { createdAt: new Date().toISOString(), passed: false, boundary: 'Single finite engineering comparison; no independent accuracy or aesthetic satisfaction claim; no downloads.', records: [] }
let service
let explainer
try {
  service = await ensureOllama()
  report.service = { status: service.status, message: service.message }
  const resident = (await ollamaRequest('/api/ps')).models ?? []
  assert.equal(resident.length, 0, 'Do not replace existing user models during experiment')
  const installed = (await ollamaRequest('/api/tags')).models ?? []
  report.models = installed.filter(item => models.includes(item.name))
  assert.equal(report.models.length, models.length, 'Both frozen candidates must already be installed')
  report.before = await inspectResources()
  assert.ok(report.before.freeRamGiB >= 12 && report.before.freeVramGiB >= 9, 'Experiment requires safe 9B resource headroom')
  for (const model of models) {
    explainer = await createVisionLanguageExplainer({ model })
    assert.equal(explainer.status.model, model, 'No silent model substitutions in experiment')
    for (const file of samples) {
      const bytes = await readFile(file)
      const started = performance.now()
      const result = await explainer.explain(bytes)
      const record = { model, file, sha256: createHash('sha256').update(bytes).digest('hex'), durationMs: Math.round(performance.now() - started), cold: file === samples[0], result, deviceStatus: { ...explainer.status }, resources: await inspectResources(), resident: (await ollamaRequest('/api/ps')).models ?? [] }
      report.records.push(record)
      console.log(JSON.stringify({ model, name: path.basename(file), durationMs: record.durationMs, category: result.categoryCandidate, personCount: result.personCount, qualityComment: result.qualityComment }))
      await writeFile(reportFile, JSON.stringify(report, null, 2))
    }
    await explainer.close()
    explainer = null
  }
  report.afterResident = (await ollamaRequest('/api/ps')).models ?? []
  assert.equal(report.afterResident.length, 0, 'Experiment-owned models must be released')
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  if (explainer) await explainer.close()
  if (service) { await service.stop(); report.ownedServiceStopped = service.status === 'started' }
  await writeFile(reportFile, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: report.passed, count: report.records.length, error: report.error, reportFile }))
}
