import assert from 'node:assert/strict'
import { buildModelEvidence } from './model-evidence.js'

const evidence = buildModelEvidence({
  classification: { category: '待确认', confidence: 0.42, reason: '测试边界' },
  candidates: [{ label: 'valley, vale', score: 0.8 }, { label: 'invalid', score: NaN }],
  faces: { faceCount: 0, maxConfidence: 0, faceAreaRatio: 0, durationMs: 12 },
  quality: { qualityScore: 81, clarityScore: 77, exposureStatus: '曝光均衡', qualityReasons: ['测试'] },
  backend: 'cpu',
  device: { id: 'cpu', name: 'CPU' },
  npuVerified: false,
  npuEvidence: null,
})

const npuEvidence = buildModelEvidence({
  classification: { category: '风景', confidence: 0.8, reason: 'NPU证据' },
  candidates: [], faces: null, quality: {}, backend: 'vitisai', device: { id: 'npu', name: 'NPU' },
  npuVerified: true,
  npuEvidence: { providers: ['CPUExecutionProvider', 'VitisAIExecutionProvider'], npuKernelCount: 4, npuKernelMs: 3.2, cpuKernelCount: 2, cpuKernelMs: 0.4, mixedCpuAuxiliary: true },
})

assert.equal(evidence.version, 1)
assert.equal(evidence.classification.category, '待确认')
assert.equal(evidence.person.status, 'not-run')
assert.equal(evidence.person.source, 'YOLOX Tiny')
assert.equal(evidence.face.status, 'succeeded')
assert.equal(evidence.face.count, 0)
assert.equal(evidence.scene.topLabel, 'valley, vale')
assert.equal(evidence.scene.candidates.length, 2)
assert.equal(evidence.scene.candidates[1].score, null)
assert.equal(evidence.aesthetic.status, 'not-run')
assert.equal(evidence.technical.qualityScore, 81)
assert.equal(evidence.duplicate.status, 'not-run')
assert.equal(evidence.device.backend, 'cpu')
assert.equal(evidence.device.npuVerified, false)
assert.equal(npuEvidence.device.npuKernelCount, 4)
assert.equal(npuEvidence.device.npuKernelMs, 3.2)
assert.equal(npuEvidence.device.mixedCpuAuxiliary, true)
console.log(JSON.stringify({ status: 'passed', checks: 14, scope: 'unified model evidence contract only; production model selection unchanged' }, null, 2))
