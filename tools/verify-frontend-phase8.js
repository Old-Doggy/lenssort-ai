import assert from 'node:assert/strict'
import path from 'node:path'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { createControlServer } from './control-server.js'

const workspace = await mkdtemp(path.resolve('output/playwright/phase8-'))
const input = path.join(workspace, '中文照片来源')
const output = path.join(workspace, '中文分类结果')
await mkdir(input)
await mkdir(output)
const source = path.join(input, '验收用风景.jpg')
const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#85ae99' } }).jpeg().toBuffer()
await writeFile(source, bytes)
const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0,
  analyzerFactory: async () => ({ device: { name: '工程测试设备' }, analyze: async () => {
    await sleep(800)
    return { category: '风景', explanation: '用于交互验收的合成图片', faceCount: 0, qualityScore: 75 }
  }, close: async () => {} }),
})
let browser
const report = { passed: false, kind: 'isolated UI regression, not accuracy or aesthetics', checks: [], errors: [] }
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.route('**/api/models', route => route.fulfill({ json: {
    resources: { totalRamGiB: 16, freeRamGiB: 8, totalVramGiB: 0, freeVramGiB: 0 },
    options: [{ id: 'off', label: '基础分析', installed: true, minRamGiB: 0, minVramGiB: 0, advice: '工程验证模式' }],
    serviceMessage: 'Ollama 未连接', recommendation: { selected: 'off', fallback: false, reason: '工程验证' },
  } }))
  const picks = []
  await page.route('**/api/pick-folder', route => {
    const { kind } = route.request().postDataJSON()
    picks.push(kind)
    return route.fulfill({ json: { selected: kind === 'input' ? input : output } })
  })
  await page.goto(server.origin)
  await page.getByLabel('推理设备').selectOption('cpu')
  await page.getByRole('button', { name: '选择文件夹', exact: true }).first().click()
  await page.getByRole('button', { name: '选择文件夹', exact: true }).last().click()
  assert.deepEqual(picks, ['input', 'output'])
  assert.equal(await page.getByLabel('照片来源文件夹').inputValue(), input)
  assert.equal(await page.getByLabel('分类结果文件夹').inputValue(), output)
  report.checks.push('folder controls use the picker response and preserve Chinese paths; native picker remains manual')
  await page.getByRole('button', { name: /一键筛选/ }).click()
  await page.waitForFunction(() => document.querySelector('.quick-action.primary strong')?.textContent === '停止筛选')
  assert.equal(await page.locator('.quick-action.secondary').isDisabled(), true)
  await page.getByRole('heading', { name: '验收用风景.jpg', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.quick-status-title strong')?.textContent.includes('分类完成'))
  report.checks.push('finite batch exposes progress, locks recommendation while running, and reaches classification complete')
  let finishCuration
  const curationReleased = new Promise(resolve => { finishCuration = resolve })
  await page.route('**/api/curate', async route => {
    await curationReleased
    await route.fulfill({ json: { selected: [{ id: 'fixture' }], considered: 1, curation: { sources: ['engineering-fixture'] } } })
  })
  const request = page.waitForRequest('**/api/curate')
  await page.locator('.quick-action.secondary').click()
  await request
  try {
    await page.waitForFunction(() => document.querySelector('.quick-action.secondary').disabled)
    assert.equal(await page.locator('.quick-action.primary').isDisabled(), true)
  } finally { finishCuration() }
  await page.getByRole('status').filter({ hasText: '已生成辅助推荐' }).waitFor()
  await page.unroute('**/api/curate')
  const nav = page.getByRole('navigation', { name: '分类筛选' })
  await nav.getByRole('button', { name: /^全部/ }).click()
  const status = await (await fetch(server.origin + '/api/status')).json()
  const record = status.records[0]
  await page.route('**/api/status', route => route.fulfill({ json: { ...status, records: [{ ...record, curated: true }] } }))
  await page.reload()
  await nav.getByRole('button', { name: /^辅助推荐/ }).waitFor()
  assert.equal(await nav.getByRole('button', { name: /^辅助推荐/ }).locator('b').textContent(), '1')
  report.checks.push('recommendation count matches records and overlapping quick actions stay disabled')
  await page.unroute('**/api/status')
  await page.route('**/api/status', route => route.fulfill({ json: { ...status, curation: { phase: 'scoring', sources: [], warnings: [], considered: 1, selected: 0 } } }))
  await page.reload()
  await page.waitForFunction(() => document.querySelector('.quick-status-title strong')?.textContent === '正在生成辅助推荐')
  assert.equal(await page.locator('.quick-action.primary').isDisabled(), true)
  assert.equal(await page.locator('.quick-action.secondary').isDisabled(), true)
  report.checks.push('reported background scoring disables both quick actions even without a pending local request')
  await page.unroute('**/api/status')
  await page.reload()
  await page.getByRole('heading', { name: '验收用风景.jpg', exact: true }).waitFor()
  await page.screenshot({ path: path.join(workspace, 'results.png'), fullPage: true })
  await page.getByRole('button', { name: '查看详情', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.locator('.photo-modal-image img').evaluate(img => img.decode())
  await page.screenshot({ path: path.join(workspace, 'detail.png') })
  page.once('dialog', dialog => dialog.dismiss())
  await modal.getByRole('button', { name: '删除分类副本', exact: true }).click()
  await access(record.output)
  page.once('dialog', dialog => {
    assert.ok(dialog.message().includes('原图不会删除'))
    return dialog.accept()
  })
  await modal.getByRole('button', { name: '删除分类副本', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  await assert.rejects(access(record.output))
  assert.deepEqual(await readFile(source), bytes)
  await page.getByRole('button', { name: '刷新当前文件夹', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已按当前磁盘重新扫描' }).waitFor()
  assert.equal(await page.locator('.control-photo').count(), 0)
  report.checks.push('large image decodes; delete cancellation preserves output, confirmation removes only output, rescan removes stale card')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.screenshot({ path: path.join(workspace, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(workspace, 'mobile.png'), fullPage: true })
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  await browser?.close()
  await server.close()
  await writeFile(path.join(workspace, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ report: path.relative(process.cwd(), workspace), ...report }, null, 2))
}
