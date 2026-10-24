import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'

const root = process.cwd()
const samples = JSON.parse(await readFile('artifacts/p1-failure-samples.json', 'utf8')).samples
const analyzer = await createPhotoAnalyzer(root, 'cpu')
const results = []
try {
  for (const sample of samples) {
    try {
      const result = await analyzer.analyze(await readFile(sample.source))
      results.push({
        name: sample.name,
        tags: sample.tags,
        previousCategory: sample.currentCategory,
        category: result.category,
        reason: result.reason,
        faceCount: result.faces?.faceCount ?? null,
        personStatus: result.personDetection?.status ?? null,
        personCandidateCount: result.personDetection?.candidateCount ?? null,
        maxPersonScore: result.personDetection?.maxScore ?? null,
        sceneStatus: result.sceneSemantics?.status ?? null,
        sceneLabel: result.sceneSemantics?.topLabel ?? null,
        sceneScore: result.sceneSemantics?.topScore ?? null,
        qualityScore: result.qualityScore,
        modelEvidenceVersion: result.modelEvidence?.version ?? null,
        durationMs: result.durationMs,
      })
    } catch (error) {
      results.push({ name: sample.name, tags: sample.tags, error: error instanceof Error ? error.message : String(error) })
    }
  }
} finally { await analyzer.close() }

const personMiss = results.filter(item => item.tags?.includes('person-missed'))
const sceneMiss = results.filter(item => item.tags?.includes('scene-missed'))
const errors = results.filter(item => item.error)
assert.equal(results.length, samples.length)
assert.equal(errors.length, 0)
assert.ok(personMiss.every(item => item.personStatus === 'succeeded' && (item.personCandidateCount ?? 0) > 0), 'person-missed samples should have YOLOX candidates')
assert.ok(personMiss.every(item => item.category === '待确认' || item.category === '人物与风景'), 'person-missed samples must not be silently classified as no-person categories')
assert.ok(results.every(item => item.modelEvidenceVersion === 1), 'all results should include model evidence v1')
const report = {
  status: 'passed-with-boundaries',
  phase: 'P3.1',
  sampleCount: results.length,
  errorCount: errors.length,
  personMissRiskCount: personMiss.length,
  sceneRiskCount: sceneMiss.length,
  personMissRecoveredByCandidate: personMiss.filter(item => (item.personCandidateCount ?? 0) > 0).length,
  categoryCounts: Object.fromEntries([...new Set(results.map(item => item.category))].map(category => [category, results.filter(item => item.category === category).length])),
  averageDurationMs: Math.round(results.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) / Math.max(1, results.length)),
  boundary: '41 张样本用于前后回归，不是独立人工真值；通过只证明辅助证据链和保守门控没有崩溃，不宣称真实准确率。',
  results,
}
await writeFile('artifacts/p3-failure-regression.json', JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ status: report.status, sampleCount: report.sampleCount, errorCount: report.errorCount, personMissRecoveredByCandidate: report.personMissRecoveredByCandidate, categoryCounts: report.categoryCounts, averageDurationMs: report.averageDurationMs, output: 'artifacts/p3-failure-regression.json' }, null, 2))
