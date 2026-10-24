import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { createControlServer } from './control-server.js'
import { modelProfiles } from './model-resource-policy.js'

const workspace = await mkdtemp(path.resolve('artifacts/model-settings-browser-'))
const controlDir = path.join(workspace, 'control')
const input = path.join(workspace, '照片来源')
const output = path.join(workspace, '分类结果')
await mkdir(input)
await mkdir(output)
await sharp({ create: { width: 96, height: 96, channels: 3, background: '#99bbcc' } }).jpeg().toFile(path.join(input, '测试照片.jpg'))
let selectedModel
const server = await createControlServer({ root: process.cwd(), controlDir, port: 0, analyzerFactory: async (_root, _backend, model) => {
  selectedModel = model
  return { device: { name: '模拟基础设备' }, analyze: async () => { await sleep(500); return { category: '风景', explanation: '浏览器测试结果。' } }, close: async () => {} }
} })
let browser
const report = { passed: false, workspace, checks: [], errors: [] }
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  await page.route('**/api/models', route => route.fulfill({ json: {
    resources: { totalRamGiB: 16, freeRamGiB: 5, totalVramGiB: 8, freeVramGiB: 2, gpuProbe: 'verified' },
    options: modelProfiles().map(item => ({ ...item, installed: true })),
    recommendation: { selected: 'off', reason: '模拟资源不足', fallback: true }, serviceMessage: '隔离浏览器测试，不加载真实模型',
  } }))
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(server.origin)
  await page.getByRole('button', { name: /选择 Qwen 3.5 9B/ }).waitFor()
  const adviceButtons = page.locator('.model-advice-option > button')
  assert.ok(await adviceButtons.count() >= 1)
  await adviceButtons.first().hover()
  await assertTooltipVisible(page, adviceButtons.first())
  await adviceButtons.first().focus()
  await assertTooltipVisible(page, adviceButtons.first())
  const automatic = page.getByRole('button', { name: '选择 自动安全选择（推荐）', exact: true })
  assert.equal(await automatic.count(), 1)
  await automatic.focus()
  await assertTooltipVisible(page, automatic)
  report.checks.push('模型按钮支持鼠标悬停与键盘聚焦显示建议')
  const basic = page.getByRole('button', { name: /选择 基础分析/ })
  await basic.waitFor()
  await basic.click()
  await page.getByText('模型选择已保存；下一次筛选生效。', { exact: true }).waitFor()
  assert.equal(JSON.parse(await readFile(path.join(controlDir, 'config.json'), 'utf8')).model, 'off')
  await page.reload()
  await page.getByRole('button', { name: /选择 基础分析/ }).waitFor()
  await page.getByRole('button', { name: /选择 基础分析/ }).evaluate(button => { if (button.getAttribute('aria-pressed') !== 'true') throw new Error('基础分析按钮没有保留选中状态') })
  report.checks.push('网页使用按钮切换模型，刷新后保留选择且不再显示视觉模型下拉框')
  assert.equal(await page.locator('select[aria-label="视觉模型"]').count(), 0)
  await page.getByRole('button', { name: /选择 Qwen 3.5 9B/ }).click()
  await page.getByText('模型选择已保存；下一次筛选生效。', { exact: true }).waitFor()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: /强制使用当前模型/ }).click()
  assert.equal(JSON.parse(await readFile(path.join(controlDir, 'config.json'), 'utf8')).forceModel, false)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: /强制使用当前模型/ }).click()
  await page.getByRole('button', { name: /关闭强制使用/ }).waitFor()
  assert.equal(JSON.parse(await readFile(path.join(controlDir, 'config.json'), 'utf8')).forceModel, true)
  await page.reload()
  await page.getByRole('button', { name: /关闭强制使用/ }).waitFor()
  await page.getByRole('button', { name: /选择 基础分析/ }).click()
  await page.getByText('模型选择已保存；下一次筛选生效。', { exact: true }).waitFor()
  assert.equal(JSON.parse(await readFile(path.join(controlDir, 'config.json'), 'utf8')).forceModel, false)
  assert.equal(await page.getByRole('button', { name: /关闭强制使用/ }).count(), 0)
  report.checks.push('资源不足仍可选择9B；强制风险确认可取消/接受；刷新保留，切换模型清除强制')
  await page.locator('summary').first().click()
  await page.getByLabel('照片来源文件夹').fill(input)
  await page.getByLabel('分类结果文件夹').fill(output)
  await page.getByRole('button', { name: /一键筛选/ }).click()
  await page.waitForFunction(async () => {
    const status = await (await fetch('/api/status')).json()
    return status.phase === 'stopped' && status.progress.phase === 'finished'
  })
  assert.equal(selectedModel, 'off')
  report.checks.push('网页实际将基础模式传入分析器，有限批次自动停止')
  await page.screenshot({ path: path.join(workspace, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  for (const button of await adviceButtons.all()) {
    await button.focus()
    await assertTooltipVisible(page, button)
    const tooltip = await page.locator('[id="' + await button.getAttribute('aria-describedby') + '"]').boundingBox()
    assert.ok(tooltip && tooltip.x >= 0 && tooltip.x + tooltip.width <= 390)
  }
  report.checks.push('自动选择也有提示，手机上每个提示均不超出屏幕')
  await page.screenshot({ path: path.join(workspace, 'mobile.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(report.errors, [])
  report.checks.push('桌面/手机界面无横向溢出，无页面脚本错误')
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  if (browser) await browser.close()
  await server.close()
  await writeFile(path.join(workspace, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

async function assertTooltipVisible(page, button) {
  const tooltipId = await button.getAttribute('aria-describedby')
  assert.ok(tooltipId)
  await page.locator('[id="' + tooltipId + '"]').waitFor({ state: 'visible' })
  await page.waitForFunction(id => Number(getComputedStyle(document.getElementById(id)).opacity) >= 0.99, tooltipId)
}
