import test from 'node:test'
import assert from 'node:assert/strict'
import { rankCurationRecords } from './curation-ranking.js'

const photo = (id, overrides = {}) => ({ id, hash: id, name: id + '.jpg', status: 'done', output: id + '.jpg', qualityScore: 90, clarityScore: 85, exposureStatus: '曝光均衡', ...overrides })
test('审美模型主导；漂亮夜景和分类待确认也能参与', () => {
  const ranked = rankCurationRecords([photo('day', { aestheticScore: 4 }), photo('night', { aestheticScore: 7, qualityScore: 55, exposureStatus: '整体偏暗', category: '待确认' })])
  assert.equal(ranked[0].record.id, 'night')
  assert.equal(ranked[0].basis, 'aesthetic')
})
test('脸大和类别不额外加分，相同模型分保持并列', () => {
  const ranked = rankCurationRecords([photo('a', { aestheticScore: 5, category: '其他', faceCount: 0 }), photo('b', { aestheticScore: 5, category: '单人', faceCount: 8, faceAreaRatio: 0.9 })])
  assert.equal(ranked[0].score, ranked[1].score)
  assert.equal(ranked[0].aestheticRank, 50)
})
test('复制照片和极值不拉伸原有分数；使用并列友好的分位排名', () => {
  const items = [photo('a', { aestheticScore: 4 }), photo('b', { aestheticScore: 5 }), photo('c', { aestheticScore: 6 })]
  const ranked = rankCurationRecords([...items, photo('copy', { hash: 'b', aestheticScore: 5 })])
  assert.equal(ranked.find(item => item.record.id === 'b').aestheticRank, 50)
  assert.equal(ranked.find(item => item.record.id === 'copy').aestheticRank, 50)
})
test('MUSIQ可辅助但不靠技术曝光或类别先验决定美感', () => {
  const ranked = rankCurationRecords([photo('a', { aestheticScore: 7, musiqScore: 4 }), photo('b', { aestheticScore: 4, musiqScore: 7 })])
  assert.equal(ranked[0].record.id, 'a')
  assert.ok(ranked[0].reasons.some(reason => reason.includes('MUSIQ')))
})
test('模型不可用时明确标记技术回退，不冒充审美评分', () => {
  const ranked = rankCurationRecords([photo('a'), photo('bad', { qualityScore: 20, clarityScore: 10 })])
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].basis, 'technical-fallback')
  assert.ok(ranked[0].reasons.some(reason => reason.includes('不代表审美')))
})
test('模型部分失败不以默认50分伪装成功，失败照片留待人工', () => {
  const ranked = rankCurationRecords([photo('ok', { aestheticScore: 4 }), photo('failed')])
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].record.id, 'ok')
})
test('低清晰度照片不能仅凭审美模型高分进入精选', () => {
  const ranked = rankCurationRecords([photo('sharp', { aestheticScore: 5, clarityScore: 85 }), photo('blur', { aestheticScore: 9, clarityScore: 25, qualityScore: 55 })])
  assert.equal(ranked.some(item => item.record.id === 'blur'), false)
})
test('主体明显模糊时背景锐度和审美高分不能掩盖风险', () => {
  const records = [photo('clear', { aestheticScore: 5, subjectQuality: { status: 'measured', clarityScore: 85, blurRisk: 'not-detected' } }), photo('subject-blur', { aestheticScore: 9, clarityScore: 90, subjectQuality: { status: 'measured', clarityScore: 22, blurRisk: 'high' } })]
  assert.deepEqual(rankCurationRecords(records).map(item => item.record.id), ['clear'])
})
test('清晰主体虚化背景仍可入选；未知主体质量不能冒充失败', () => {
  const records = [photo('bokeh', { clarityScore: 30, subjectQuality: { status: 'measured', clarityScore: 90, blurRisk: 'not-detected' } }), photo('unknown', { subjectQuality: { status: 'unavailable', clarityScore: null, blurRisk: 'unknown' } })]
  assert.equal(rankCurationRecords(records).length, 2)
})
