import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import vm from 'node:vm'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const sourceText = await readFile(path.join(root, 'src/App.tsx'), 'utf8')
const source = ts.createSourceFile('App.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = new Set(['clampScore', 'getQualitySignal', 'getPersonSignal', 'getLandscapeSignal', 'getEyeSignal', 'getModeFitSignal', 'getFeedbackAdjustment', 'calculateRecommendationScore', 'getExportEligibility', 'getRecommendationExplanation', 'toCsvCell'])
const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)).map(statement => statement.getText(source)).join('\n')
assert.equal(source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)).length, names.size)
const constants = "const FEEDBACK_SCORE_ADJUSTMENT = 8; const modeLabels = {travel:'旅行记录',people:'人物精选',landscape:'风景精选'}; const exposureStatusLabels = {balanced:'曝光均衡',underexposed:'整体偏暗',overexposed:'整体偏亮',mixed:'明暗反差大'};"
const runtime = vm.createContext({})
vm.runInContext(ts.transpileModule(constants + functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, runtime)
const report = { generatedAt: new Date().toISOString(), stage: 'T6.5-rules', evidenceType: 'synthetic-rule-boundaries-not-model-accuracy', checks: {} }
const check = (name, operation) => {
  operation()
  report.checks[name] = { passed: true }
}
const base = { id: 'boundary', title: '合成边界样本', label: 'person', score: 95, clarityScore: 95, exposureStatus: 'balanced', modelStatus: 'succeeded', faceDetectionStatus: 'succeeded', faceCount: 1, isImported: true }
const explain = (changes = {}, feedback = {}, mode = 'people', sentiment = {}, demo = false) => runtime.getRecommendationExplanation({ ...base, ...changes }, mode, sentiment, feedback, demo)
try {
  check('pendingHighScoreIsNotRecommended', () => assert.notEqual(explain({ modelStatus: 'not-run' }).status, 'recommended'))
  check('failedModelIsExplicit', () => assert.match(explain({ modelStatus: 'failed' }).reason, /模型分析失败/))
  check('similarUnconfirmedIsBlocked', () => assert.equal(explain({ isNearDuplicate: true }).exportEligible, false))
  check('qualityRiskIsBlocked', () => assert.equal(explain({ lowQuality: true, qualityReasons: ['整体偏暗'] }).exportEligible, false))
  check('manualKeepOverridesButPreservesRisk', () => {
    const result = explain({ lowQuality: true, clarityScore: 10, modelStatus: 'failed' }, { boundary: 'keep' })
    assert.equal(result.exportEligible, true)
    assert.equal(result.exportState, 'manual-keep')
    assert.match(result.summary, /手动保留/)
    assert.match(result.reason, /质量风险/)
    assert.doesNotMatch(result.summary, /满足自动导出/)
  })
  check('skipWinsEvenInDemo', () => {
    const result = explain({}, { boundary: 'skip' }, 'travel', {}, true)
    assert.equal(result.status, 'skipped')
    assert.equal(result.exportEligible, false)
    assert.match(result.summary, /不会导出/)
  })
  check('demoDoesNotInventClarity', () => {
    const result = explain({ isImported: false, clarityScore: undefined, exposureStatus: undefined, modelStatus: undefined, faceDetectionStatus: undefined }, {}, 'travel', {}, true)
    assert.match(result.reason, /演示/)
    assert.doesNotMatch(result.reason, /清晰度 95|暂无额外风险/)
  })
  check('unknownStatesExplicit', () => {
    const result = explain({ clarityScore: undefined, exposureStatus: undefined, faceDetectionStatus: 'failed', faceLandmarkerStatus: 'failed', closedEyeStatus: 'not-run' })
    assert.match(result.reason, /清晰度.*未知/)
    assert.match(result.reason, /曝光.*未知/)
    assert.match(result.reason, /人脸检测失败/)
    assert.match(result.reason, /闭眼.*失败/)
  })
  check('lowConfidenceExplicit', () => assert.match(explain({ productLabel: 'review' }).reason, /标签.*待确认/))
  check('eyeStatesExplicit', () => {
    for (const state of ['not-run', 'insufficient-data', 'no-face', 'review']) assert.match(explain({ closedEyeStatus: state }).reason, /闭眼|眼部/)
  })
  check('threeModesAndFeedbackKeepFormula', () => {
    for (const mode of ['travel', 'people', 'landscape']) {
      for (const value of [undefined, 'like', 'dislike']) {
        const sentiment = value ? { boundary: value } : {}
        const result = explain({}, {}, mode, sentiment)
        const adjustment = value === 'like' ? 8 : value === 'dislike' ? -8 : 0
        assert.equal(result.scoreBreakdown.feedback, adjustment)
        assert.equal(result.scoreBreakdown.total, runtime.calculateRecommendationScore(base, mode, sentiment))
        assert.equal(new Set(result.strengths).size, result.strengths.length)
        assert.doesNotMatch(result.summary, /排序靠前/)
      }
    }
  })
  check('eligibilityExactlyMatchesPreviousRule', () => {
    for (const demo of [false, true]) for (const modelStatus of ['not-run', 'failed', 'succeeded']) for (const duplicate of [false, true]) for (const lowQuality of [false, true]) for (const selection of [undefined, 'keep', 'skip']) {
      const photo = { ...base, modelStatus, isNearDuplicate: duplicate, lowQuality }
      const feedback = selection ? { boundary: selection } : {}
      const previous = selection !== 'skip' && (demo || selection === 'keep' || (!duplicate && !lowQuality && modelStatus === 'succeeded'))
      assert.equal(runtime.getExportEligibility(photo, feedback, demo).eligible, previous)
      assert.equal(runtime.getRecommendationExplanation(photo, 'travel', {}, feedback, demo).exportEligible, previous)
    }
  })
  check('csvEscapesComplexCells', () => {
    const values = ['含逗号,引号"与换行\n的标题', ['支持一', '支持二'], { quality: 78, feedback: 8 }, null, 79]
    for (const value of values) {
      const cell = runtime.toCsvCell(value)
      assert.ok(cell.startsWith('"') && cell.endsWith('"'))
      const decoded = cell.slice(1, -1).replaceAll('""', '"')
      assert.equal(decoded, value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value))
    }
  })
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.stack
  process.exitCode = 1
} finally {
  const directory = path.join(root, 'artifacts/t6.5-history')
  await mkdir(directory, { recursive: true })
  const text = `${JSON.stringify(report, null, 2)}\n`
  await writeFile(path.join(directory, `${report.generatedAt.replaceAll(':', '-')}-rules.json`), text)
  await writeFile(path.join(root, 'artifacts/t6.5-recommendation-rules-evaluation.json'), text)
  console.log(text)
}
