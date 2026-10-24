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
const report = { generatedAt: new Date().toISOString(), stage: 'T6.3', checks: {} }
const check = (name, passed, details = null) => {
  report.checks[name] = { passed: Boolean(passed), details }
  assert.ok(passed, `${name}: ${JSON.stringify(details)}`)
}
const modeButton = label => page.getByRole('button', { name: new RegExp(label) })
const modeStatus = label => page.locator('.explain-strip').getByText(`当前模式：${label}`)
const cardTitles = () => page.locator('.photo-grid .photo-card h3').allTextContents()
const modeStorage = () => page.evaluate(() => localStorage.getItem('lenssort-active-mode'))

try {
  await page.goto(baseUrl)
  await page.evaluate(() => {
    indexedDB.deleteDatabase('lenssort-ai')
    localStorage.removeItem('lenssort-active-mode')
  })
  await page.reload()
  await page.locator('.demo-tag').filter({ hasText: '演示数据' }).waitFor()

  const travelTitles = await cardTitles()
  check('travelModeVisible', await modeStatus('旅行记录').count() === 1)
  check('travelModeHasOrderedCards', travelTitles.length === 6 && travelTitles[0] === '山谷日落', travelTitles)
  check('travelModeReasonVisible', await page.locator('.explain-strip').getByText('当前模式会改变排序权重').count() === 1)

  await modeButton('人物精选').click()
  await modeStatus('人物精选').waitFor()
  const peopleTitles = await cardTitles()
  check('peopleModeChangesOrder', peopleTitles.length === 6 && peopleTitles[0] === '湖边人像' && JSON.stringify(peopleTitles) !== JSON.stringify(travelTitles), peopleTitles)
  check('peopleModeReasonVisible', await page.locator('.mode-card.active').getByText('人物精选').count() === 1)
  check('peopleModePersisted', await modeStorage() === 'people')

  await modeButton('风景精选').click()
  await modeStatus('风景精选').waitFor()
  const landscapeTitles = await cardTitles()
  check('landscapeModeChangesOrder', landscapeTitles.length === 6 && landscapeTitles[0] === '山谷日落' && JSON.stringify(landscapeTitles) !== JSON.stringify(peopleTitles), landscapeTitles)
  check('landscapeModePersisted', await modeStorage() === 'landscape')

  await page.reload()
  await modeStatus('风景精选').waitFor()
  check('modeSurvivesRefresh', await modeStorage() === 'landscape' && JSON.stringify(await cardTitles()) === JSON.stringify(landscapeTitles))

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  check('jsonExportContainsMode', exported.mode === 'landscape' && exported.modeLabel === '风景精选' && exported.count === 6 && exported.photos.length === 6, exported)

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
  await writeFile(path.join(root, 'artifacts/t6.3-curation-modes-evaluation.json'), `${JSON.stringify(report, null, 2)}\n`)
  await browser.close()
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, error: report.error }, null, 2))
}
