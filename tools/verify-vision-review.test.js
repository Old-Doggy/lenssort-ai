import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewPhotoDecision } from './vision-review.js'

const sample = overrides => ({ generated: true, categoryCandidate: '风景', subjectFocus: 'environment', realPersonPresent: false, personCount: 0, landscapePresent: true, statuePresent: false, animalPresent: false, uncertain: false, summary: '天空与城市。', explanation: '天空与城市形成层次。', ...overrides })
const base = { enableReview: true, bytes: Buffer.from('isolated-test'), classification: { category: '风景', confidence: 0.9, explanation: '基础说明' }, faces: { faceCount: 0 }, person: {}, scene: {} }

test('production defaults to one call until experimental review passes accuracy validation', async () => {
  let calls = 0
  const result = await reviewPhotoDecision({ ...base, enableReview: undefined, explain: async () => { calls++; return sample({ subjectFocus: 'animal', categoryCandidate: '动物', animalPresent: true }) } })
  assert.equal(calls, 1)
  assert.equal(result.vision.reviewEnabled, false)
  assert.equal(result.classification.category, '动物')
})

test('consistent scene uses exactly one visual call', async () => {
  const calls = []
  const result = await reviewPhotoDecision({ ...base, explain: async (...args) => { calls.push(args); return sample() } })
  assert.equal(calls.length, 1)
  assert.equal(result.classification.category, '风景')
  assert.equal(result.vision.reviewCalls, 1)
  assert.equal(result.classification.confidence, null)
})
test('category conflict runs one independent review and preserves both observations', async () => {
  const calls = []
  const vision = sample({ subjectFocus: 'animal', categoryCandidate: '动物', landscapePresent: false, animalPresent: true })
  const result = await reviewPhotoDecision({ ...base, explain: async (...args) => { calls.push(args); return vision } })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1][1], { review: true })
  assert.equal(result.classification.category, '动物')
  assert.equal(result.vision.reviewPassed, true)
  assert.equal(result.vision.firstReview, vision)
})
test('near-duplicate category conflicts run one blind independent review without passing the prior label', async () => {
  const calls = []
  const result = await reviewPhotoDecision({ ...base, similarityReview: { inspect: async () => ({ review: true, previousCategory: '单人', reason: '近似图类别冲突' }) }, explain: async (...args) => { calls.push(args); return sample() } })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1][1], { review: true })
  assert.equal(result.vision.reviewCalls, 2)
  assert.equal(result.vision.similarityReview.previousCategory, '单人')
})
test('disagreement abstains with no confident visual description and no infinite retry', async () => {
  let calls = 0
  const result = await reviewPhotoDecision({ ...base, explain: async () => ++calls === 1 ? sample({ subjectFocus: 'person', categoryCandidate: '单人', realPersonPresent: true, personCount: 1 }) : sample() })
  assert.equal(calls, 2)
  assert.equal(result.classification.category, '待确认')
  assert.match(result.classification.explanation, /不足|待确认/)
  assert.equal(result.classification.explanation, result.vision.explanation)
})
test('ordinary review request failure does not invent a stable result', async () => {
  let calls = 0
  const result = await reviewPhotoDecision({ ...base, explain: async () => {
    if (++calls === 2) throw new Error('timeout')
    return sample({ uncertain: true })
  } })
  assert.equal(calls, 2)
  assert.equal(result.classification.category, '待确认')
  assert.match(result.vision.reviewError, /timeout/)
})
test('forced model failure on review reaches the batch stopper', async () => {
  let calls = 0
  await assert.rejects(reviewPhotoDecision({ ...base, explain: async () => {
    if (++calls === 2) throw Object.assign(new Error('OOM'), { code: 'LENSSORT_FORCED_MODEL_FAILED' })
    return sample({ uncertain: true })
  } }), { code: 'LENSSORT_FORCED_MODEL_FAILED' })
  assert.equal(calls, 2)
})
test('initial model failure is propagated, never returned as generated content', async () => {
  await assert.rejects(reviewPhotoDecision({ ...base, explain: async () => { throw new Error('service offline') } }), /service offline/)
})
