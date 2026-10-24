import test from 'node:test'
import assert from 'node:assert/strict'
import { createSimilarityReviewPolicy } from './similarity-review.js'

const descriptor = overrides => ({ aspect: 1.5, mean: 120, deviation: 40, pixels: Array.from({ length: 1024 }, (_, index) => index % 2 ? 160 : 80), ...overrides })
const vision = categoryCandidate => ({ generated: true, categoryCandidate, uncertain: categoryCandidate === '待确认' })

test('near-identical conflicting results request an independent review, never copy labels', async () => {
  const policy = createSimilarityReviewPolicy({ describe: async () => descriptor() })
  assert.equal((await policy.inspect(Buffer.from('one'), vision('单人'))).review, false)
  const next = await policy.inspect(Buffer.from('two'), vision('待确认'))
  assert.equal(next.review, true)
  assert.equal(next.previousCategory, '单人')
  assert.equal(next.category, undefined)
})
test('different scenes, constant images and failed visual output do not trigger semantic propagation', async () => {
  const policy = createSimilarityReviewPolicy({ describe: async bytes => descriptor(JSON.parse(bytes.toString())) })
  await policy.inspect(Buffer.from('{}'), vision('单人'))
  assert.equal((await policy.inspect(Buffer.from('{"aspect":0.7}'), vision('动物'))).review, false)
  assert.equal((await policy.inspect(Buffer.from('{"deviation":1}'), vision('动物'))).review, false)
  assert.equal((await policy.inspect(Buffer.from('{}'), { generated: false })).review, false)
})
test('review budget and descriptor history are bounded and explicit', async () => {
  const policy = createSimilarityReviewPolicy({ describe: async () => descriptor(), maxReviews: 1, maxHistory: 2 })
  await policy.inspect(Buffer.from('one'), vision('单人'))
  assert.equal((await policy.inspect(Buffer.from('two'), vision('风景'))).review, true)
  const limited = await policy.inspect(Buffer.from('three'), vision('动物'))
  assert.equal(limited.review, false)
  assert.equal(limited.budgetLimited, true)
  assert.ok(policy.stats.history <= 2)
  assert.equal(policy.stats.reviews, 1)
})
