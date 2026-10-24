import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeG2Evaluation } from './g2-evaluation-summary.js'

const row = (category, expected, extra = {}) => ({ model: 'candidate', split: 'development', expected, alternatives: [], ambiguous: false, result: { category, durationMs: 100, visionExplanation: { generated: true, model: 'candidate', reviewCalls: 1 } }, ...extra })

test('strict and ambiguous reference agreement stay separate', () => {
  const summary = summarizeG2Evaluation([row('单人', '单人'), row('多人', '单人', { alternatives: ['多人'], ambiguous: true })])[0]
  assert.equal(summary.strictLabeled, 1)
  assert.equal(summary.strictAgreementRate, 1)
  assert.equal(summary.referenceAgreementRate, 1)
  assert.equal(summary.ambiguous, 1)
})

test('fallback and model substitution cannot count as visual success', () => {
  const summary = summarizeG2Evaluation([row('单人', '单人', { result: { category: '单人', durationMs: 100, visionExplanation: { generated: false, model: null } } }), row('单人', '单人', { result: { category: '单人', durationMs: 100, visionExplanation: { generated: true, model: 'other' } } })])[0]
  assert.equal(summary.visualSuccess, 0)
  assert.equal(summary.fallback, 2)
  assert.equal(summary.independentAccuracy, null)
})

test('automatic coverage and false definite references are explicit', () => {
  const summary = summarizeG2Evaluation([row('待确认', '风景'), row('其他', '风景')])[0]
  assert.equal(summary.autoCoverage, 0.5)
  assert.equal(summary.falseDefiniteReference, 1)
})

test('per-class precision recall and macro F1 include abstentions as false negatives', () => {
  const summary = summarizeG2Evaluation([row('单人', '单人'), row('多人', '单人'), row('多人', '多人'), row('待确认', '动物')])[0]
  assert.equal(summary.perClass['单人'].precision, 1)
  assert.equal(summary.perClass['单人'].recall, 0.5)
  assert.equal(summary.perClass['多人'].precision, 0.5)
  assert.equal(summary.perClass['动物'].recall, 0)
  assert.equal(summary.strictMacroF1, 0.4444)
  assert.equal(summary.falseDefiniteReferenceRate, 0.25)
})
