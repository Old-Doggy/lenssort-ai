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
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
const report = { generatedAt: new Date().toISOString(), stage: 'T6.2', checks: {}, publicInputImages: 6 }
const check = (name, passed, details = null) => {
  report.checks[name] = { passed: Boolean(passed), details }
  assert.ok(passed, `${name}: ${JSON.stringify(details)}`)
}
const storage = () => page.evaluate(async () => {
  const module = await import('/src/storage.ts')
  const request = indexedDB.open('lenssort-ai')
  const database = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const stored = await new Promise((resolve, reject) => {
    const transaction = database.transaction(['photos', 'curation', 'feedbackEvents'], 'readonly')
    const photos = transaction.objectStore('photos').count()
    const state = transaction.objectStore('curation').get('current')
    transaction.oncomplete = () => resolve({ version: database.version, photoCount: photos.result, state: state.result ?? null })
    transaction.onabort = () => reject(transaction.error)
  })
  database.close()
  return { ...stored, events: await module.loadFeedbackEvents() }
})
const status = text => page.locator('.workspace-section > .curation-status').filter({ hasText: text }).waitFor()
const saved = () => status('本地选择已保存')
let trackedGroupLabel = null
const firstGroup = () => trackedGroupLabel
  ? page.locator(`.similar-group-card[aria-label="${trackedGroupLabel}"]`)
  : page.locator('.similar-group-card').first()
const sentiment = group => group.locator('.photo-sentiment').first()
const memberSentiment = group => group.locator('.group-member').nth(1).locator('.photo-sentiment')
const clickSave = async (locator, name) => {
  await locator.getByRole('button', { name, exact: true }).click()
  await saved()
}

try {
  await context.route(`${baseUrl}/feedback-test-bootstrap`, route => route.fulfill({ contentType: 'text/html', body: '<title>Isolated test</title>' }))
  await page.goto(`${baseUrl}/feedback-test-bootstrap`)
  await page.evaluate(async () => {
    const request = indexedDB.open('lenssort-ai', 2)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('photos', { keyPath: 'id' })
      request.result.createObjectStore('curation')
    }
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('curation', 'readwrite')
      transaction.objectStore('curation').put({ feedback: { legacy: 'keep' }, groupChoices: { old: 'legacy' } }, 'current')
      transaction.oncomplete = resolve
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  })
  await page.goto(baseUrl)
  await status('本地选择已恢复')
  const migrated = await storage()
  check('v2UpgradePreservesState', migrated.version === 3 && migrated.state.feedback.legacy === 'keep' && migrated.state.groupChoices.old === 'legacy')
  check('legacySentimentDefaultsEmpty', await page.evaluate(async () => Object.keys((await (await import('/src/storage.ts')).loadCurationState()).sentiment).length === 0))
  await page.getByRole('button', { name: '清除本次数据', exact: true }).click()
  await status('照片和本地选择已清除')
  const files = [
    'similarity_cases/case01_exact_a.png', 'similarity_cases/case01_exact_b.png',
    'similarity_cases/case03_brightness_a.png', 'similarity_cases/case03_brightness_b.png',
    'similarity_cases_extra/case19_alt_scene_a_a.png', 'similarity_cases_extra/case19_alt_scene_a_b.png',
  ]
  await page.locator('input[type=file]').setInputFiles(files.map(file => path.join(root, 'data/eval', file)))
  await page.locator('.analysis-status').filter({ hasText: '6 张本地照片' }).waitFor()
  check('sixPublicImagesImported', (await storage()).photoCount === 6)
  trackedGroupLabel = await firstGroup().getAttribute('aria-label')
  check('trackedGroupLocated', Boolean(trackedGroupLabel), trackedGroupLabel)
  await clickSave(sentiment(firstGroup()), '喜欢')
  await clickSave(firstGroup(), '保留这张')
  await firstGroup().getByRole('button', { name: /展开相似组/ }).click()
  await clickSave(memberSentiment(firstGroup()), '不喜欢')
  const feedbackSnapshot = await storage()
  const count = (record, value) => Object.values(record).filter(item => item === value).length
  check('t61IndependentSnapshot', count(feedbackSnapshot.state.sentiment, 'like') === 1 && count(feedbackSnapshot.state.sentiment, 'dislike') === 1 && count(feedbackSnapshot.state.feedback, 'keep') === 1 && count(feedbackSnapshot.state.feedback, 'skip') === 0)
  await page.reload()
  await status('本地选择已恢复')
  await firstGroup().getByRole('status').filter({ hasText: '已保留当前照片' }).waitFor()
  check('t61SnapshotAndEventsRestore', JSON.stringify(feedbackSnapshot) === JSON.stringify(await storage()))
  const t61 = {
    generatedAt: new Date().toISOString(), stage: 'T6.1', publicInputImages: 6,
    likes: 1, dislikes: 1, kept: 1, skipped: 0,
    refreshRestoration: 'passed', sentimentAndSelectionIndependent: 'passed',
    browserConsoleApplicationErrors: errors.length,
    verification: 'Fresh isolated Chrome browser verification; not copied from the previous handoff.',
    limitations: ['T6.1 recorded the independent preference snapshot; T6.4 now applies a separate bounded score adjustment.'],
  }
  await writeFile(path.join(root, 'artifacts/t6.1-feedback-evaluation.json'), `${JSON.stringify(t61, null, 2)}\n`)
  await clickSave(sentiment(firstGroup()), '喜欢')
  await clickSave(sentiment(firstGroup()), '不喜欢')
  await firstGroup().getByRole('button', { name: /展开相似组/ }).click()
  const title = (await firstGroup().locator('.group-current').textContent()).replace('当前候选：', '')
  const member = firstGroup().locator('.group-member').filter({ hasText: title })
  await clickSave(member, '跳过')
  await clickSave(member, '撤销选择')
  await clickSave(firstGroup(), '换一张')
  await clickSave(firstGroup(), '恢复系统推荐')
  const allTypes = await storage()
  check('allEightEventTypesRecorded', new Set(allTypes.events.map(event => event.type)).size === 8, allTypes.events.map(event => event.type))
  const expected = ['like', 'keep', 'dislike', 'clear-sentiment', 'dislike', 'skip', 'clear-feedback', 'choose-candidate', 'reset-candidate']
  check('operationOrderMatches', JSON.stringify(allTypes.events.map(event => event.type)) === JSON.stringify(expected))
  check('valuesAndTargetsCaptured', allTypes.events[3].previousValue === 'like' && allTypes.events[5].type === 'skip' && allTypes.events[5].nextValue === 'skip' && allTypes.events[6].previousValue === 'skip' && allTypes.events[7].groupId && allTypes.events[7].type === 'choose-candidate' && allTypes.events[8].type === 'reset-candidate' && allTypes.events.every(event => (event.photoId && event.photoTitle || event.groupId) && Number.isFinite(event.createdAt)), allTypes.events)
  const beforeFailure = await storage()
  await page.evaluate(() => {
    window.__originalEventPut = IDBObjectStore.prototype.put
    window.__originalEventAdd = IDBObjectStore.prototype.add
    for (const method of ['put', 'add']) {
      const original = IDBObjectStore.prototype[method]
      IDBObjectStore.prototype[method] = function(...args) {
        if (this.name === 'feedbackEvents') throw new DOMException('Injected event write failure', 'QuotaExceededError')
        return original.apply(this, args)
      }
    }
  })
  await sentiment(firstGroup()).getByRole('button', { name: '喜欢', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '本地选择保存失败' }).waitFor()
  const failedStorage = await storage()
  check('failureRollsBackSnapshotAndEvents', JSON.stringify(beforeFailure) === JSON.stringify(failedStorage))
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__originalEventPut
    IDBObjectStore.prototype.add = window.__originalEventAdd
  })
  await page.getByRole('button', { name: '重试保存选择', exact: true }).click()
  await saved()
  const recovered = await storage()
  check('retryPreservesExactlyOneEvent', recovered.events.length === beforeFailure.events.length + 1 && recovered.events.at(-1).type === 'like')
  const burstBefore = recovered.events.length
  await sentiment(firstGroup()).evaluate(fieldset => {
    const originalNow = Date.now
    const fixedNow = originalNow()
    Date.now = () => fixedNow
    try {
      for (let index = 0; index < 14; index += 1) {
        Array.from(fieldset.querySelectorAll('button')).find(button => button.textContent === (index % 2 === 0 ? '不喜欢' : '喜欢')).click()
      }
    } finally { Date.now = originalNow }
  })
  await saved()
  const burst = await storage()
  const burstEvents = burst.events.slice(burstBefore)
  check('sameMillisecondBurstOrdered', burstEvents.length === 14 && new Set(burstEvents.map(event => event.createdAt)).size === 1 && burstEvents.every((event, index) => event.type === (index % 2 === 0 ? 'dislike' : 'like')), burstEvents.map(event => ({ type: event.type, sequence: event.sequence })))
  check('uniqueIds', new Set(burst.events.map(event => event.id)).size === burst.events.length)
  await page.reload()
  await status('本地选择已恢复')
  check('allEventsSurviveRefresh', JSON.stringify(burst) === JSON.stringify(await storage()))
  await page.screenshot({ path: path.join(root, 'artifacts/t6.2-feedback.png'), fullPage: true })
  report.eventsBeforeClear = burst.events
  await page.getByRole('button', { name: '清除本次数据', exact: true }).click()
  await status('照片和本地选择已清除')
  const cleared = await storage()
  check('clearAllThreeStores', cleared.photoCount === 0 && cleared.state === null && cleared.events.length === 0)
  await page.reload()
  await status('本地选择已恢复')
  check('clearSurvivesRefresh', JSON.stringify(cleared) === JSON.stringify(await storage()))
  check('noBrowserApplicationErrors', errors.length === 0, errors)
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.message
  console.error(error)
  process.exitCode = 1
} finally {
  report.browserConsoleApplicationErrors = errors
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  await writeFile(path.join(root, 'artifacts/t6.2-feedback-event-evaluation.json'), `${JSON.stringify(report, null, 2)}\n`)
  await browser.close()
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, error: report.error }, null, 2))
}
