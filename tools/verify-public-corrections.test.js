import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVision, semanticCategory, visionPrompt, visionSchema } from './vision-output.js'
import { applyVisionLanguageCategory } from './vision-language-policy.js'
import { classifyFolderCategory } from './folder-classification.js'

const sample = changes => ({ category_candidate: '其他', summary: '画面中的主要主体。', media_type: 'photograph', subject_focus: 'object', real_person_present: false, person_count: 0, primary_person_count: 0, landscape_present: false, statue_present: false, animal_present: false, plant_present: false, composition_comment: '主体居中。', quality_comment: '自然光。', uncertain: false, ...changes })

test('植物主体从视觉语义到最终分类可独立输出，不并入风景', () => {
  const vision = { ...normalizeVision(sample({ category_candidate: '植物', subject_focus: 'plant', plant_present: true })), generated: true }
  assert.equal(semanticCategory(vision), '植物')
  assert.equal(applyVisionLanguageCategory({ category: '风景' }, vision).classification.category, '植物')
  assert.equal(classifyFolderCategory([], { faceCount: 0 }, { sceneCandidates: [{ label: 'a close-up photo of flowers or plants', score: 0.8 }, { label: 'a natural landscape', score: 0.1 }] }).category, '植物')
})
test('只露手部不能生成单人或多人语义', () => {
  assert.throws(() => normalizeVision(sample({ subject_focus: 'person', real_person_present: true, person_count: 1, primary_person_count: 1, body_part_only: true })), /局部人体/)
  assert.match(visionPrompt, /手部|局部人体/)
})
test('雕像与人偶不借检测框升级为真人', () => {
  const vision = { ...normalizeVision(sample({ subject_focus: 'artwork', statue_present: true })), generated: true }
  assert.equal(applyVisionLanguageCategory({ category: '单人' }, vision, { faces: { faceCount: 1 } }).classification.category, '其他')
})
test('车旁一人只计一人，画面背景不自动升级为环境合影', () => {
  const vision = normalizeVision(sample({ category_candidate: '单人', subject_focus: 'person', real_person_present: true, person_count: 1, primary_person_count: 1, landscape_present: true }))
  assert.equal(semanticCategory(vision), '单人')
})
test('植物证据必须被包含在模型强制输出字段中', () => {
  assert.ok(visionSchema.required.includes('plant_present'))
  const missing = sample({ subject_focus: 'plant' })
  delete missing.plant_present
  assert.throws(() => normalizeVision(missing), /字段无效/)
})
test('人物照片按已确认可辨识真人总数区分单人和多人，不只数主角', () => {
  const vision = normalizeVision(sample({ subject_focus: 'person', real_person_present: true, person_count: 3, primary_person_count: 1 }))
  assert.equal(semanticCategory(vision), '多人')
  const landscape = { ...vision, subjectFocus: 'environment', landscapePresent: true }
  assert.equal(semanticCategory(landscape), '风景')
})
test('物件主体与真人存在是独立维度，汽车旁有人不等于人物照或无人照', () => {
  const vision = normalizeVision(sample({ subject_focus: 'object', real_person_present: true, person_count: 1, primary_person_count: 0 }))
  assert.equal(semanticCategory(vision), '其他')
  assert.equal(vision.realPersonPresent, true)
})
