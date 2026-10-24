import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const candidates = [
  { name: 'yolox_tiny', report: 'artifacts/p2-yolox-baseline.json', model: 'data/p2-candidates/yolox_tiny/yolox_tiny.onnx', bytes: 20219662 },
  { name: 'yolox_nano', report: 'artifacts/p2-yolox-nano-baseline.json', model: 'data/p2-candidates/yolox_nano/yolox_nano.onnx', bytes: 3659407 },
  { name: 'yolox_s', report: 'artifacts/p2-yolox-s-baseline.json', model: 'data/p2-candidates/yolox_s/yolox_s.onnx', bytes: 35858002 },
]
const rows = []
for (const candidate of candidates) {
  const report = JSON.parse(await readFile(path.join(root, candidate.report), 'utf8'))
  const riskNames = new Set(report.results.filter(item => item.tags.includes('person-missed')).map(item => item.name))
  const sceneNames = new Set(report.results.filter(item => item.tags.includes('scene-missed')).map(item => item.name))
  const stats = { highConfidenceRisk: 0, mediumConfidenceRisk: 0, lowConfidenceSceneFalsePositive: 0 }
  for (const item of report.results) {
    const score = item.maxPersonScore ?? 0
    if (riskNames.has(item.name) && score >= 0.4) stats.highConfidenceRisk++
    if (riskNames.has(item.name) && score >= 0.25) stats.mediumConfidenceRisk++
    if (sceneNames.has(item.name) && score >= 0.15) stats.lowConfidenceSceneFalsePositive++
  }
  rows.push({ name: candidate.name, model: candidate.model, bytes: candidate.bytes, sampleCount: report.sampleCount, errorCount: report.errorCount, averageDurationMs: report.averageDurationMs, thresholdDetectionCounts: report.thresholdDetectionCounts, taggedPersonRiskCount: report.taggedPersonRiskCount, taggedSceneRiskCount: report.taggedSceneRiskCount, highConfidencePersonRiskDetected: stats.highConfidenceRisk, mediumConfidencePersonRiskDetected: stats.mediumConfidenceRisk, taggedSceneRiskWithAnyCandidate: stats.lowConfidenceSceneFalsePositive, boundary: 'Risk counts use screenshot-based tags, not independent labels.' })
}
const recommendation = rows.find(row => row.name === 'yolox_tiny')
const report = { status: 'completed-with-boundaries', phase: 'P2.2', createdAt: new Date().toISOString(), candidates: rows, recommendation: { selectedForNextStep: recommendation.name, reason: 'Tiny detects more candidate person cases than Nano on the same 41-sample set; its average cost is modestly higher. Use confidence gating and scene evidence before category assignment.', notYetProven: ['independent person recall', 'false-positive rate on a representative labeled set', 'DirectML/NPU performance for this candidate', 'production suitability without P3 integration tests'] }, nextStep: 'Evaluate scene semantics and aesthetic scoring candidates before P2 final selection.' }
await writeFile(path.join(root, 'artifacts', 'p2-person-candidate-comparison.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
