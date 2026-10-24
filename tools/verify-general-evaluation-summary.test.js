import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeGeneralEvaluation } from './general-evaluation-summary.js'

const row = (category, vision, extra = {}) => ({ model: 'candidate', slice: 'held-out-proxy', proxyLabel: '风景', result: { category, durationMs: 100, visionExplanation: vision }, ...extra })
test('fallback is reported separately and never counts as visual success', () => {
  const summary = summarizeGeneralEvaluation([row('风景', { generated: false }), row('风景', { generated: true, model: 'candidate' })])[0]
  assert.equal(summary.attempted, 2)
  assert.equal(summary.visualSuccess, 1)
  assert.equal(summary.fallback, 1)
  assert.equal(summary.proxyLabeled, 1)
  assert.equal(summary.proxyAgreement, 1)
  assert.equal(summary.independentAccuracy, null)
})
test('abstentions remain in proxy denominator and coverage is reported separately', () => {
  const summary = summarizeGeneralEvaluation([row('待确认', { generated: true, model: 'candidate', reviewCalls: 2 }), row('风景', { generated: true, model: 'candidate', reviewCalls: 1 })])[0]
  assert.equal(summary.abstained, 1)
  assert.equal(summary.autoCoverage, 0.5)
  assert.equal(summary.proxyAgreementRate, 0.5)
  assert.equal(summary.proxySelectiveAgreementRate, 1)
  assert.equal(summary.reviewed, 1)
  assert.equal(summary.slices['held-out-proxy'].attempted, 2)
})
test('model substitution is invalid; unlabelled samples cannot inflate proxy metrics', () => {
  const summary = summarizeGeneralEvaluation([row('风景', { generated: true, model: 'other' }), row('动物', { generated: true, model: 'candidate' }, { proxyLabel: undefined })])[0]
  assert.equal(summary.substituted, 1)
  assert.equal(summary.visualSuccess, 1)
  assert.equal(summary.proxyLabeled, 0)
  assert.equal(summary.proxyAgreementRate, null)
})
