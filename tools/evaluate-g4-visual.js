import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { ensureOllama } from './ollama-lifecycle.js'
import { createVisionLanguageExplainer } from './vision-language-explainer.js'
import { inspectResources, ollamaRequest } from './model-resources.js'
import { semanticCategory } from './vision-output.js'
import { analyzeSubjectQuality } from './subject-quality.js'

const model = process.argv.find(value => value.startsWith('--model='))?.slice(8) ?? 'qwen3.5:4b'
assert.ok(['qwen3.5:4b', 'qwen3.5:9b'].includes(model))
const reference = JSON.parse(await readFile('artifacts/g2-reserve-reference-labels.json', 'utf8'))
const report = { createdAt: new Date().toISOString(), model, complete: false, labelBoundary: reference.labelStatus, independentAccuracy: null, results: [], initial: await inspectResources() }
let service
let explainer
const output = `artifacts/g4-visual-${model.replace(':', '-')}.json`
try {
  service = await ensureOllama()
  assert.ok(['started', 'reused'].includes(service.status), service.message)
  assert.equal(((await ollamaRequest('/api/ps')).models ?? []).length, 0, 'Do not replace user resident models')
  explainer = await createVisionLanguageExplainer({ model })
  assert.equal(explainer.status.model, model, 'No model substitutions in evaluation')
  for (const sample of reference.records) {
    const original = await readFile(sample.file)
    assert.equal(createHash('sha256').update(original).digest('hex'), sample.sha256)
    const inputs = [{ name: 'original', bytes: original }]
    if ([2, 6, 13, 14].includes(sample.id)) inputs.push({ name: 'compressed', bytes: await sharp(original).rotate().resize(900, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer() })
    for (const input of inputs) {
      const start = performance.now()
      const vision = await explainer.explain(input.bytes)
      const ms = Math.round(performance.now() - start)
      const quality = await analyzeSubjectQuality(input.bytes, { category: semanticCategory(vision), vision })
      report.results.push({ id: sample.id, variant: input.name, expected: sample.expected, ambiguous: sample.ambiguous, category: semanticCategory(vision), vision, subjectQuality: quality, ms, rss: process.memoryUsage().rss, resources: await inspectResources(), runtime: { ...explainer.status } })
      await writeFile(output, JSON.stringify(report, null, 2))
      console.log(JSON.stringify({ id: sample.id, variant: input.name, expected: sample.expected, category: semanticCategory(vision), ms, subject: quality.clarityScore }))
      assert.equal(vision.model, model, 'Evaluation cannot count substituted models')
    }
  }
  report.complete = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  if (explainer) await explainer.close()
  if (service && ['started', 'reused'].includes(service.status)) report.afterResident = (await ollamaRequest('/api/ps')).models ?? []
  if (service) await service.stop()
  report.after = await inspectResources()
  const originals = report.results.filter(row => row.variant === 'original' && !row.ambiguous)
  report.summary = { total: report.results.length, nonAmbiguous: originals.length, referenceAgreement: originals.filter(row => row.expected === row.category).length, pending: report.results.filter(row => row.category === '待确认').length, medianMs: [...report.results].sort((left, right) => left.ms - right.ms)[Math.floor(report.results.length / 2)]?.ms ?? null }
  await writeFile(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ complete: report.complete, summary: report.summary, error: report.error, output }))
}
