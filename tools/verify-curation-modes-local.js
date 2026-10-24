import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const baseUrl = process.env.LENSSORT_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Created TensorFlow Lite XNNPACK delegate for CPU.')) errors.push(message.text())
})
const report = {
  generatedAt: new Date().toISOString(),
  stage: 'T6.5-local',
  checks: {},
  publicInputImages: 8,
  feedbackAdjustment: { like: 8, dislike: -8 },
  scoreClamp: { min: 0, max: 100 },
}
const check = (name, passed, details = null) => {
  report.checks[name] = { passed: Boolean(passed), details }
  assert.ok(passed, `${name}: ${JSON.stringify(details)}`)
}
const files = [
  'similarity_cases/case01_exact_a.png', 'similarity_cases/case01_exact_b.png',
  'similarity_cases/case03_brightness_a.png', 'similarity_cases/case03_brightness_b.png',
  'similarity_cases_extra/case14_crop80_b.png', 'similarity_cases_extra/case16_zoom_b.png',
  'similarity_cases_extra/case19_alt_scene_a_a.png', 'similarity_cases_extra/case19_alt_scene_a_b.png',
]
const modeButton = label => page.getByRole('button', { name: new RegExp(label) })
const status = text => page.locator('.workspace-section > .curation-status').filter({ hasText: text }).waitFor()
const titles = () => page.locator('.photo-grid .photo-card h3').allTextContents()
const scores = () => page.locator('.photo-grid .score-badge').allTextContents()
const scoreMap = async () => {
  const photoTitles = await titles()
  const photoScores = await scores()
  return Object.fromEntries(photoTitles.map((title, index) => [title, Number(photoScores[index])]))
}
const group = () => page.locator('.similar-group-card').filter({ hasText: 'case01_exact_a.png' })
const downloadText = async (buttonName) => {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: buttonName, exact: true }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

try {
  await page.goto(baseUrl)
  await page.evaluate(() => { indexedDB.deleteDatabase('lenssort-ai'); localStorage.removeItem('lenssort-active-mode') })
  await page.reload()
  await page.getByRole('button', { name: '清除本次数据', exact: true }).click()
  await status('照片和本地选择已清除')
  await page.locator('input[type=file]').setInputFiles(files.map(file => path.join(root, 'data/eval', file)))
  await page.locator('.analysis-status').filter({ hasText: '8 张本地照片' }).waitFor()
  check('publicImagesImported', await page.locator('.photo-grid .photo-card').count() === 8)
  check('similarGroupsAvailable', await page.locator('.similar-group-card').count() === 3)
  await page.locator('.analysis-details').locator('summary').click()
  await page.getByRole('button', { name: '运行分析', exact: true }).click()
  await page.locator('.batch-analysis-actions').filter({ hasText: '8/8 已完成' }).waitFor({ timeout: 120000 })
  check('batchAnalysisCompleted', await page.locator('.batch-analysis-actions').filter({ hasText: '8/8 已完成' }).count() === 1)

  const travelTitles = await titles()
  const travelScores = await scores()
  const initialScoreMap = await scoreMap()
  check('travelLocalOrderVisible', travelTitles.length === 8 && travelScores.every(score => /^\d+$/.test(score)), { travelTitles, travelScores })
  check('cardExplanationVisible', await page.locator('.photo-grid .photo-card .recommendation-explanation').count() === 8)

  const firstCard = page.locator('.photo-grid .photo-card').first()
  const firstTitle = travelTitles[0]
  await firstCard.click()
  check('detailExplanationVisible', await page.locator('.detail-modal .recommendation-explanation').count() === 1)
  check('detailExplanationHasFactors', await page.locator('.detail-modal .recommendation-factor-group').count() >= 1 && await page.locator('.detail-modal .recommendation-breakdown').count() === 1)
  await page.locator('.detail-modal').getByRole('button', { name: '喜欢', exact: true }).click()
  await status('本地选择已保存')
  await page.locator('.modal-close').click()
  const likedScoreMap = await scoreMap()
  check('likeFeedbackAdjustsScore', likedScoreMap[firstTitle] === initialScoreMap[firstTitle] + 8, { before: initialScoreMap[firstTitle], after: likedScoreMap[firstTitle], adjustment: 8 })

  const lastCard = page.locator('.photo-grid .photo-card').last()
  const lastTitle = travelTitles.at(-1)
  await lastCard.click()
  await page.locator('.detail-modal').getByRole('button', { name: '不喜欢', exact: true }).click()
  await status('本地选择已保存')
  await page.locator('.modal-close').click()
  const dislikedScoreMap = await scoreMap()
  check('dislikeFeedbackAdjustsScore', dislikedScoreMap[lastTitle] === initialScoreMap[lastTitle] - 8, { before: initialScoreMap[lastTitle], after: dislikedScoreMap[lastTitle], adjustment: -8 })
  check('recommendationScoresStayWithinBounds', Object.values(dislikedScoreMap).every(score => score >= 0 && score <= 100), { min: 0, max: 100, scores: dislikedScoreMap })

  await modeButton('人物精选').click()
  await page.locator('.explain-strip').getByText('当前模式：人物精选').waitFor()
  const peopleTitles = await titles()
  const peopleScores = await scores()
  check('peopleLocalOrderChanges', JSON.stringify(peopleTitles) !== JSON.stringify(travelTitles) && JSON.stringify(peopleScores) !== JSON.stringify(travelScores), { peopleTitles, peopleScores })
  check('peopleGroupCandidateUsesModeScore', (await group().locator('.group-current').textContent()) !== null && (await group().locator('p').nth(2).textContent()).includes('人物精选'))

  await modeButton('风景精选').click()
  await page.locator('.explain-strip').getByText('当前模式：风景精选').waitFor()
  const landscapeTitles = await titles()
  const landscapeScores = await scores()
  check('landscapeLocalOrderChanges', JSON.stringify(landscapeTitles) !== JSON.stringify(peopleTitles) && JSON.stringify(landscapeScores) !== JSON.stringify(peopleScores), { landscapeTitles, landscapeScores })
  check('modeRefreshRestores', await page.evaluate(() => localStorage.getItem('lenssort-active-mode')) === 'landscape')
  await page.reload()
  await page.locator('.explain-strip').getByText('当前模式：风景精选').waitFor()
  check('landscapeOrderSurvivesRefresh', JSON.stringify(await titles()) === JSON.stringify(landscapeTitles))

  await group().getByRole('button', { name: /展开相似组/ }).click()
  const candidateBefore = await group().locator('.group-current').textContent()
  await group().getByRole('button', { name: '换一张', exact: true }).click()
  await status('本地选择已保存')
  const candidateAfter = await group().locator('.group-current').textContent()
  check('manualCandidateStillWorks', candidateBefore !== candidateAfter)
  await group().getByRole('button', { name: '保留这张', exact: true }).click()
  await status('本地选择已保存')

  const json = JSON.parse(await downloadText('导出 JSON'))
  check('localJsonExportHasModeAndExplanation', json.mode === 'landscape' && json.modeLabel === '风景精选' && json.count >= 1 && json.photos.some(photo => photo.title === candidateAfter.replace('当前候选：', '') && typeof photo.recommendationStatus === 'string' && typeof photo.recommendationSummary === 'string' && Array.isArray(photo.supportingFactors) && Array.isArray(photo.cautionFactors) && photo.scoreBreakdown && typeof photo.scoreBreakdown.quality === 'number'), json)
  const csv = await downloadText('导出 CSV')
  check('localCsvExportHasModeAndExplanation', csv.startsWith('\ufeffmode,modeLabel,') && csv.includes('recommendationStatus') && csv.includes('supportingFactors') && csv.includes('scoreBreakdown') && csv.includes('landscape') && csv.includes('风景精选'), csv.slice(0, 600))
  check('noBrowserApplicationErrors', errors.length === 0, errors)
  report.modeOrders = { travel: travelTitles, people: peopleTitles, landscape: landscapeTitles }
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.message
  console.error(error)
  process.exitCode = 1
} finally {
  report.browserConsoleApplicationErrors = errors
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  const reportText = `${JSON.stringify(report, null, 2)}\n`
  await mkdir(path.join(root, 'artifacts/t6.5-history'), { recursive: true })
  await writeFile(path.join(root, 'artifacts/t6.5-curation-modes-local-evaluation.json'), reportText)
  await writeFile(path.join(root, 'artifacts/t6.5-history', `${report.generatedAt.replaceAll(':', '-')}-browser.json`), reportText)
  await browser.close()
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, error: report.error }, null, 2))
}
