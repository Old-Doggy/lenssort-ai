import test from 'node:test'
import assert from 'node:assert/strict'
import { groupCurationCandidates } from './curation-groups.js'

const fingerprint = Array.from({ length: 576 }, (_, index) => index % 3 ? 1 : 0)
const photo = (id, score, overrides = {}) => ({ record: { id }, hash: id, score, fingerprint, color: [100, 130, 160], aspect: 1.5, deviation: 40, ...overrides })
test('先按分排序，近似组只选最高分；输入顺序不决定代表', () => {
  const groups = groupCurationCandidates([photo('low', 30), photo('best', 90)])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].record.id, 'best')
  assert.deepEqual(groups[0].similarityMembers.sort(), ['best', 'low'])
})
test('相似组分数接近时优先清晰版本，避免模糊主体成为代表', () => {
  const groups = groupCurationCandidates([photo('blur', 90, { clarityScore: 25 }), photo('sharp', 88, { clarityScore: 85 })])
  assert.equal(groups[0].record.id, 'sharp')
})
test('不同内容不能因清晰度比较颠倒审美排名', () => {
  const groups = groupCurationCandidates([photo('best', 90, { clarityScore: 60 }), photo('different', 88, { clarityScore: 95, color: [200, 20, 30] })])
  assert.deepEqual(groups.map(group => group.record.id), ['best', 'different'])
})
test('相似组清晰度比较以最高分为界且不随输入顺序改变', () => {
  const best = photo('best', 90, { clarityScore: 50 })
  const sharp = photo('sharp', 86, { clarityScore: 80 })
  const outside = photo('outside', 82, { clarityScore: 99 })
  for (const candidates of [[best, sharp, outside], [outside, sharp, best], [sharp, best, outside]]) {
    const groups = groupCurationCandidates(candidates)
    assert.equal(groups.length, 1)
    assert.equal(groups[0].record.id, 'sharp')
    assert.deepEqual([...groups[0].similarityMembers].sort(), ['best', 'outside', 'sharp'])
  }
})
test('相同灰度指纹但颜色或画幅不同，不当成同照片', () => {
  const groups = groupCurationCandidates([photo('a', 90), photo('b', 80, { color: [200, 20, 30] }), photo('c', 70, { aspect: 0.67 })])
  assert.equal(groups.length, 3)
})
test('纯色/低信息图不进行感知合并，内容哈希仍可去重', () => {
  const groups = groupCurationCandidates([photo('a', 90, { deviation: 0 }), photo('b', 80, { deviation: 0 }), photo('copy', 70, { hash: 'a' })])
  assert.equal(groups.length, 2)
})
