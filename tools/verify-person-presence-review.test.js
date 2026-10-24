import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { reviewPersonPresence } from './person-presence-review.js'
const bytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'white' } }).jpeg().toBuffer()
const vision = { generated: true, uncertain: false, realPersonPresent: false, personCount: 0, primaryPersonCount: 0, subjectFocus: 'object', categoryCandidate: '其他', summary: '一辆车。' }
const person = { status: 'succeeded', boxes: [{ score: 0.8, areaRatio: 0.1, x: 10, y: 10, width: 30, height: 40 }] }
test('局部真人复核不改主体类别、不从裁剪图伪造全图人数', async () => {
  let calls = 0
  const result = await reviewPersonPresence({ bytes, vision, person, explain: async () => { calls++; return { generated: true, uncertain: false, realPersonPresent: true, mediaType: 'photograph', personCount: 1 } } })
  assert.equal(calls, 1)
  assert.equal(result.categoryCandidate, '其他')
  assert.equal(result.realPersonPresent, true)
  assert.equal(result.personCount, null)
  assert.equal(result.personCountLowerBound, 1)
})
test('雕像、手部和弱检测不得直接确认为真人', async () => {
  for (const review of [{ generated: true, realPersonPresent: false }, { generated: true, realPersonPresent: true, bodyPartOnly: true, mediaType: 'photograph' }]) {
    const result = await reviewPersonPresence({ bytes, vision, person, explain: async () => review })
    assert.equal(result.realPersonPresent, false)
  }
  let calls = 0
  await reviewPersonPresence({ bytes, vision, person: {}, explain: async () => { calls++ } })
  assert.equal(calls, 0)
})
