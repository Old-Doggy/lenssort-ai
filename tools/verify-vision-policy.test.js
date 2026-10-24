import test from 'node:test'
import assert from 'node:assert/strict'
import { getVisionLanguageTrigger, applyVisionLanguageCategory, getVisionConflict, mergeVisionReviews } from './vision-language-policy.js'
const original = { category: '多人', confidence: 0.9, reason: '检测器候选' }
const review = overrides => ({ generated: true, categoryCandidate: '人物与风景', confidence: 0.01, mediaType: 'photograph', subjectFocus: 'environment_portrait', realPersonPresent: true, personCount: 1, primaryPersonCount: 1, landscapePresent: true, statuePresent: false, animalPresent: false, uncertain: false, ...overrides })

test('precision mode reviews all photos by default without trusting ImageNet confidence', () => {
  const previous = process.env.LENSSORT_VLM_MODE
  delete process.env.LENSSORT_VLM_MODE
  try { assert.equal(getVisionLanguageTrigger({ classification: { category: '风景' }, candidates: [{ score: 0.99 }] }).run, true) }
  finally { if (previous === undefined) delete process.env.LENSSORT_VLM_MODE; else process.env.LENSSORT_VLM_MODE = previous }
})
test('real person and statue may coexist', () => {
  const result = applyVisionLanguageCategory(original, review({ statuePresent: true }), { faces: { faceCount: 1 } })
  assert.equal(result.applied, true)
  assert.equal(result.classification.category, '人物与风景')
  assert.equal(result.classification.confidence, null)
})
test('environment portrait needs both real person and environment', () => {
  const result = applyVisionLanguageCategory(original, review({ landscapePresent: false }), { person: { status: 'succeeded', candidateCount: 1, maxScore: 0.9 } })
  assert.equal(result.applied, true)
  assert.equal(result.classification.category, '待确认')
})
test('illustrated humans are not classified as real people', () => {
  const result = applyVisionLanguageCategory(original, review({ categoryCandidate: '多人', mediaType: 'illustration', realPersonPresent: false, personCount: 0, primaryPersonCount: 0 }))
  assert.equal(result.applied, true)
  assert.equal(result.classification.category, '其他')
})
test('failed outputs preserve fallback while uncertain outputs abstain', () => {
  assert.equal(applyVisionLanguageCategory(original, review({ generated: false })).applied, false)
  assert.equal(applyVisionLanguageCategory(original, review({ uncertain: true })).classification.category, '待确认')
})

test('structured subject focus may correct a detector false positive', () => {
  const vision = review({ categoryCandidate: '其他', subjectFocus: 'artwork', personCount: 0, realPersonPresent: false, statuePresent: true })
  assert.equal(applyVisionLanguageCategory(original, vision, { faces: { faceCount: 1 } }).classification.category, '其他')
})
test('one real person with a statue is corrected to single person even if category candidate says group', () => {
  const vision = review({ categoryCandidate: '多人', subjectFocus: 'person', personCount: 1, statuePresent: true })
  const result = applyVisionLanguageCategory({ category: '多人', confidence: 0.9, reason: '检测器候选' }, vision, { faces: { faceCount: 2 } })
  assert.equal(result.applied, true)
  assert.equal(result.classification.category, '单人')
})

test('visual single-person output cannot override two independent body boxes', () => {
  const vision = review({ categoryCandidate: '单人', subjectFocus: 'person', personCount: 1, primaryPersonCount: 1 })
  const person = {
    status: 'succeeded',
    maxScore: 0.91,
    candidateCount: 2,
    imageWidth: 1200,
    imageHeight: 800,
    boxes: [
      { score: 0.91, x: 80, y: 120, width: 180, height: 420, areaRatio: 0.07875 },
      { score: 0.88, x: 760, y: 140, width: 190, height: 400, areaRatio: 0.07917 },
    ],
  }
  const result = applyVisionLanguageCategory({ category: '多人', confidence: 0.9, reason: '多个独立人体框' }, vision, { person })
  assert.equal(result.classification.category, '多人')
  assert.equal(result.applied, false)
})

test('tiny tourists can coexist with a landscape subject', () => {
  const vision = review({ categoryCandidate: '风景', subjectFocus: 'environment', personCount: 4 })
  assert.equal(applyVisionLanguageCategory(original, vision, { faces: { faceCount: 4 } }).classification.category, '风景')
})

test('uncertain semantics cannot preserve a confident old category', () => {
  const result = applyVisionLanguageCategory(original, review({ uncertain: true }))
  assert.equal(result.classification.category, '待确认')
  assert.equal(result.classification.confidence, null)
})
test('uncertain visual output retains existing person classification with face evidence', () => {
  const result = applyVisionLanguageCategory(original, review({ uncertain: true }), { faces: { faceCount: 2 } })
  assert.equal(result.classification.category, '多人')
  assert.equal(result.classification.confidence, null)
  assert.equal(result.applied, false)
})
test('uncertain visual output retains strong body evidence without requiring a face', () => {
  const classification = { category: '单人', reason: '人物候选' }
  const result = applyVisionLanguageCategory(classification, review({ uncertain: true }), { person: { status: 'succeeded', candidateCount: 1, maxScore: 0.85 } })
  assert.equal(result.classification.category, '单人')
  assert.equal(result.applied, false)
})
test('weak or failed body evidence does not bypass uncertain visual abstention', () => {
  for (const person of [
    { status: 'succeeded', candidateCount: 1, maxScore: 0.849 },
    { status: 'failed', candidateCount: 1, maxScore: 0.99 },
    { status: 'succeeded', candidateCount: 0, maxScore: 0.99 },
  ]) {
    const result = applyVisionLanguageCategory(original, review({ uncertain: true }), { person })
    assert.equal(result.classification.category, '待确认')
  }
})
test('invalid person semantics trigger review instead of a guessed count', () => {
  const vision = review({ subjectFocus: 'person', personCount: 0 })
  assert.ok(getVisionConflict({ classification: { category: '单人' }, vision }))
  assert.equal(applyVisionLanguageCategory(original, vision).classification.category, '待确认')
})

test('incomplete environment portrait semantics trigger independent review', () => {
  const vision = review({ categoryCandidate: '人物与风景', subjectFocus: 'environment_portrait', realPersonPresent: true, personCount: 1, landscapePresent: false })
  assert.ok(getVisionConflict({ classification: { category: '人物与风景' }, vision }))
  assert.equal(applyVisionLanguageCategory(original, vision).classification.category, '待确认')
})
test('raw category contradictions survive semantic normalization for review', () => {
  const vision = review({ subjectFocus: 'person', personCount: 1, categoryCandidate: '单人', rawCategoryCandidate: '多人' })
  assert.ok(getVisionConflict({ classification: { category: '单人' }, vision }))
})
test('one-count disagreements need review for people subjects', () => {
  const vision = review({ subjectFocus: 'person', personCount: 1, categoryCandidate: '单人' })
  assert.ok(getVisionConflict({ classification: { category: '单人' }, vision, faces: { faceCount: 2 } }))
})
test('tiny tourists do not create a count conflict for environment subjects', () => {
  const vision = review({ subjectFocus: 'environment', personCount: 4, categoryCandidate: '风景' })
  assert.equal(getVisionConflict({ classification: { category: '风景' }, vision, faces: { faceCount: 1 } }), null)
})
test('secondary details do not veto consistent subject and category decisions', () => {
  const first = review({ subjectFocus: 'person', personCount: 1, categoryCandidate: '单人', landscapePresent: false, statuePresent: false })
  const merged = mergeVisionReviews(first, { ...first, landscapePresent: true, statuePresent: true })
  assert.equal(merged.reviewPassed, true)
  assert.equal(merged.uncertain, false)
})
test('two-pass agreement is evidence status, never calibrated confidence', () => {
  const first = review({ subjectFocus: 'animal', personCount: 0, categoryCandidate: '动物', animalPresent: true, realPersonPresent: false })
  const merged = mergeVisionReviews(first, first)
  assert.equal(merged.reviewPassed, true)
  assert.equal(merged.confidence, null)
})
test('conflicting reviews result in pending category with a cautious explanation', () => {
  const first = review({ subjectFocus: 'person', personCount: 1, categoryCandidate: '单人' })
  const merged = mergeVisionReviews(first, { ...first, personCount: 3, categoryCandidate: '多人' })
  assert.equal(merged.uncertain, true)
  assert.match(merged.explanation, /待确认|人工确认/)
  assert.equal(applyVisionLanguageCategory(original, merged).classification.category, '待确认')
})
test('uncertain second review cannot confirm a first review', () => {
  const first = review({ subjectFocus: 'person', personCount: 1, categoryCandidate: '单人' })
  const merged = mergeVisionReviews(first, { ...first, uncertain: true })
  assert.notEqual(merged.reviewPassed, true)
  assert.equal(applyVisionLanguageCategory(original, merged).classification.category, '待确认')
})
