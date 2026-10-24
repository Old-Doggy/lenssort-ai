import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVision, semanticCategory, visionPrompt } from './vision-output.js'
const sample = overrides => ({ category_candidate: '风景', summary: '夜景建筑与滨水步道。', media_type: 'photograph', subject_focus: 'environment', real_person_present: true, person_count: 5, primary_person_count: 0, landscape_present: true, statue_present: false, animal_present: false, plant_present: false, composition_comment: '建筑与天空形成层次。', quality_comment: '夜色与灯光有对比。', uncertain: false, ...overrides })
test('minor tourists do not turn an environment photo into a portrait', () => {
  assert.equal(semanticCategory(normalizeVision(sample())), '风景')
})
test('a statue and a real person do not count as two people', () => {
  assert.equal(semanticCategory(normalizeVision(sample({ subject_focus: 'person', person_count: 1, primary_person_count: 1, real_person_present: true, statue_present: true }))), '单人')
})
test('artwork alone and animal-dominant photos follow subject focus', () => {
  assert.equal(semanticCategory(normalizeVision(sample({ subject_focus: 'artwork', person_count: 0, real_person_present: false }))), '其他')
  assert.equal(semanticCategory(normalizeVision(sample({ subject_focus: 'animal', animal_present: true }))), '动物')
})
test('missing or wrongly typed fields are rejected, not invented', () => {
  const missing = sample(); delete missing.subject_focus
  assert.throws(() => normalizeVision(missing), /字段无效/)
  assert.throws(() => normalizeVision(sample({ real_person_present: 'false' })), /字段无效/)
  assert.throws(() => normalizeVision(sample({ summary: '' })), /摘要为空/)
  assert.throws(() => normalizeVision('{truncated'), SyntaxError)
})
test('uncertain result remains pending and prompt excludes previous classification', () => {
  assert.equal(semanticCategory(normalizeVision(sample({ uncertain: true }))), '待确认')
  assert.doesNotMatch(visionPrompt, /快速分类：|人脸：|质量：/)
})

test('media type distinguishes depicted people from real foreground people', () => {
  const vision = normalizeVision(sample({ media_type: 'illustration', primary_person_count: 0, subject_focus: 'person', real_person_present: false, person_count: 0 }))
  assert.equal(semanticCategory(vision), '其他')
})

test('person-focused photos count recognizable background people as well as the lead', () => {
  const vision = normalizeVision(sample({ media_type: 'photograph', primary_person_count: 1, subject_focus: 'person', real_person_present: true, person_count: 4 }))
  assert.equal(semanticCategory(vision), '多人')
})

test('more primary people than visible people is rejected', () => {
  assert.throws(() => normalizeVision(sample({ media_type: 'photograph', primary_person_count: 3, person_count: 1 })), /主体人数/)
})
test('subject quality is separate from semantic uncertainty and unknown is not fabricated', () => {
  const blurred = normalizeVision(sample({ subject_focus: 'person', person_count: 1, primary_person_count: 1, subject_sharpness: 'blurred' }))
  assert.equal(blurred.subjectSharpness, 'blurred')
  assert.equal(semanticCategory(blurred), '单人')
  assert.equal(normalizeVision(sample()).subjectSharpness, 'unknown')
  assert.throws(() => normalizeVision(sample({ subject_sharpness: 'perfect' })), /清晰度/)
})
test('prompt keeps background tourists separate from the primary-person category', () => {
  assert.match(visionPrompt, /primary_person_count只计主要拍摄真人/)
  assert.match(visionPrompt, /无法数清背景路人不影响已明确的主体分类/)
})
test('prompt treats a masked face as a real-person clue when the body is visible', () => {
  assert.match(visionPrompt, /口罩/)
})
