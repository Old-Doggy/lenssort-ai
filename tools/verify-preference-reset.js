import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const report = { generatedAt: new Date().toISOString(), stage: 'T6.6', checks: {}, publicInputImages: 4 }
const errors = []
page.on('pageerror', error => errors.push(error.message))
const check = (name, passed, details) => {
  report.checks[name] = { passed: Boolean(passed), details }
  assert.ok(passed, name)
}
const reset = () => page.getByRole('button', { name: '恢复默认偏好', exact: true })
const saved = () => page.locator('.workspace-section > .curation-status').filter({ hasText: '本地选择已保存' }).waitFor()
const card = title => page.locator('.photo-grid .photo-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const ranking = () => page.locator('.photo-grid .photo-card').evaluateAll(cards => cards.map(item => ({ title: item.querySelector('h3').textContent, score: Number(item.querySelector('.score-badge').textContent) })))
const snapshot = () => page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('lenssort-ai')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(['photos', 'curation', 'feedbackEvents'], 'readonly')
      const photos = transaction.objectStore('photos').getAll()
      const curation = transaction.objectStore('curation').get('current')
      const events = transaction.objectStore('feedbackEvents').getAll()
      transaction.oncomplete = () => resolve({
        photos: photos.result.map(photo => ({ ...photo, thumbnail: { size: photo.thumbnail.size, type: photo.thumbnail.type } })).sort((left, right) => left.id.localeCompare(right.id)),
        curation: curation.result ?? { feedback: {}, sentiment: {}, groupChoices: {} },
        events: events.result.sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence),
      })
      transaction.onerror = () => reject(transaction.error)
    })
  } finally { database.close() }
})
const downloadJson = async () => {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  const stream = await (await pending).createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
const confirmReset = async accepted => {
  page.once('dialog', async dialog => {
    report.confirmationText = dialog.message()
    if (accepted) await dialog.accept()
    else await dialog.dismiss()
  })
  await reset().click()
}
try {
  await page.goto(process.env.LENSSORT_URL ?? 'http://127.0.0.1:5173')
  await page.locator('.curation-status').filter({ hasText: '本地选择已恢复' }).first().waitFor()
  check('resetEntryExists', await reset().count() === 1)
  check('noPreferenceResetDisabled', await reset().isDisabled())
  await page.getByRole('button', { name: '清除本次数据', exact: true }).click()
  await page.locator('.curation-status').filter({ hasText: '照片和本地选择已清除' }).waitFor()
  const files = ['case01_exact_a.png', 'case01_exact_b.png', 'case03_brightness_a.png', 'case03_brightness_b.png']
  await page.locator('input[type=file]').setInputFiles(files.map(file => path.join(root, 'data/eval/similarity_cases', file)))
  await page.locator('.analysis-status').filter({ hasText: '4 张本地照片' }).waitFor()
  await page.locator('.analysis-details').locator('summary').click()
  await page.getByRole('button', { name: '运行分析', exact: true }).click()
  await page.locator('.batch-analysis-actions').filter({ hasText: '4/4 已完成' }).waitFor({ timeout: 120000 })
  await page.getByRole('button', { name: /风景精选/ }).click()
  const baseline = await ranking()
  const group = page.locator('.similar-group-card').first()
  await group.getByRole('button', { name: '换一张', exact: true }).click()
  await saved()
  const candidate = await group.locator('.group-current').textContent()
  await card('case01_exact_a.png').click()
  await page.getByRole('dialog').getByRole('button', { name: '保留这张', exact: true }).click()
  await saved()
  await page.getByRole('dialog').getByRole('button', { name: '喜欢', exact: true }).click()
  await saved()
  await page.locator('.modal-close').click()
  await card('case03_brightness_b.png').click()
  await page.getByRole('dialog').getByRole('button', { name: '跳过', exact: true }).click()
  await saved()
  await page.getByRole('dialog').getByRole('button', { name: '不喜欢', exact: true }).click()
  await saved()
  await page.locator('.modal-close').click()
  const before = await snapshot()
  const personalized = await ranking()
  check('preferencesAndChoicesSeeded', Object.keys(before.curation.sentiment).length === 2 && Object.keys(before.curation.feedback).length === 2 && Object.keys(before.curation.groupChoices).length > 0)
  check('preferencesActuallyAffectScores', JSON.stringify(personalized) !== JSON.stringify(baseline))
  await confirmReset(false)
  check('cancelPreservesEverything', JSON.stringify(await snapshot()) === JSON.stringify(before) && JSON.stringify(await ranking()) === JSON.stringify(personalized))
  await confirmReset(true)
  await saved()
  const directReset = await snapshot()
  check('directResetClearsOnlySentiment', Object.keys(directReset.curation.sentiment).length === 0 && JSON.stringify(directReset.curation.feedback) === JSON.stringify(before.curation.feedback) && JSON.stringify(directReset.curation.groupChoices) === JSON.stringify(before.curation.groupChoices))
  check('directResetWritesOneHistoryEvent', directReset.events.length === before.events.length + 1 && directReset.events.at(-1).type === 'reset-preferences' && directReset.events.at(-1).affectedPhotoIds.length === 2)
  check('directResetReturnsDefaultOrder', JSON.stringify(await ranking()) === JSON.stringify(baseline))
  await card('case01_exact_a.png').click()
  await page.getByRole('dialog').getByRole('button', { name: '喜欢', exact: true }).click()
  await saved()
  await page.locator('.modal-close').click()
  await card('case03_brightness_b.png').click()
  await page.getByRole('dialog').getByRole('button', { name: '不喜欢', exact: true }).click()
  await saved()
  await page.locator('.modal-close').click()
  const beforeFailure = await snapshot()
  await page.evaluate(() => {
    window.originalEventAdd = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function(...args) {
      if (this.name === 'feedbackEvents' && args[0].type === 'reset-preferences') throw new DOMException('Injected reset write failure', 'QuotaExceededError')
      return window.originalEventAdd.apply(this, args)
    }
  })
  await confirmReset(true)
  await page.getByRole('alert').filter({ hasText: '本地选择保存失败' }).waitFor()
  check('failureRollsBackStorageAndHistory', JSON.stringify(await snapshot()) === JSON.stringify(beforeFailure))
  check('failedResetExplicitlyUnsaved', (await page.locator('.workspace-section > .curation-status').textContent()).includes('暂未保存'))
  await page.evaluate(() => { IDBObjectStore.prototype.add = window.originalEventAdd })
  await page.getByRole('button', { name: '重试保存选择', exact: true }).click()
  await saved()
  const after = await snapshot()
  check('retryClearsOnlySentiment', Object.keys(after.curation.sentiment).length === 0 && JSON.stringify(after.curation.feedback) === JSON.stringify(beforeFailure.curation.feedback) && JSON.stringify(after.curation.groupChoices) === JSON.stringify(beforeFailure.curation.groupChoices))
  check('photosAndAnalysisUnchanged', JSON.stringify(after.photos) === JSON.stringify(beforeFailure.photos))
  check('historyRetainedAndExactlyOneReset', after.events.length === beforeFailure.events.length + 1 && JSON.stringify(after.events.slice(0, -1)) === JSON.stringify(beforeFailure.events) && after.events.at(-1).type === 'reset-preferences' && after.events.at(-1).affectedPhotoIds.length === 2)
  check('scoresAndOrderReturnToDefault', JSON.stringify(await ranking()) === JSON.stringify(baseline))
  check('manualCandidateAndModePreserved', (await group.locator('.group-current').textContent()) === candidate && await page.evaluate(() => localStorage.getItem('lenssort-active-mode')) === 'landscape')
  check('noDuplicateResetAllowed', await reset().isDisabled())
  const exported = await downloadJson()
  check('exportUsesDefaultWeightsKeepsManualChoices', exported.photos.some(photo => photo.title === 'case01_exact_a.png') && !exported.photos.some(photo => photo.title === 'case03_brightness_b.png') && exported.photos.every(photo => photo.scoreBreakdown.feedback === 0))
  await page.reload()
  await page.locator('.analysis-status').filter({ hasText: '4 张本地照片' }).waitFor()
  await page.locator('.workspace-section > .curation-status').filter({ hasText: '本地选择已恢复' }).waitFor()
  check('resetSurvivesRefresh', JSON.stringify(await snapshot()) === JSON.stringify(after) && JSON.stringify(await ranking()) === JSON.stringify(baseline) && await reset().isDisabled())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.preference-reset-panel').scrollIntoViewIfNeeded()
  check('mobileResetPanelNoOverflow', await page.locator('.preference-reset-panel').evaluate(panel => panel.getBoundingClientRect().right <= innerWidth && panel.scrollWidth <= panel.clientWidth))
  await mkdir(path.join(root, 'artifacts/t6.6'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'artifacts/t6.6/mobile-reset.png') })
  await page.getByRole('button', { name: '清除本次数据', exact: true }).click()
  await page.locator('.workspace-section > .curation-status').filter({ hasText: '照片和本地选择已清除' }).waitFor()
  await page.locator('.photo-grid .photo-card').first().click()
  await page.getByRole('dialog').getByRole('button', { name: '喜欢', exact: true }).click()
  await page.locator('.modal-close').click()
  const demoBefore = await snapshot()
  await confirmReset(true)
  check('demoResetDoesNotWriteRealStorage', await reset().isDisabled() && JSON.stringify(await snapshot()) === JSON.stringify(demoBefore))
  check('confirmationExplainsNonDestructiveScope', /喜欢|不喜欢/.test(report.confirmationText) && /保留|跳过/.test(report.confirmationText) && /照片/.test(report.confirmationText))
  check('noApplicationErrors', errors.length === 0, errors)
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.stack
  process.exitCode = 1
} finally {
  const directory = path.join(root, 'artifacts/t6.6-history')
  await mkdir(directory, { recursive: true })
  const text = `${JSON.stringify(report, null, 2)}\n`
  await writeFile(path.join(directory, `${report.generatedAt.replaceAll(':', '-')}-browser.json`), text)
  await writeFile(path.join(root, 'artifacts/t6.6-preference-reset-evaluation.json'), text)
  await browser.close()
  console.log(text)
}
