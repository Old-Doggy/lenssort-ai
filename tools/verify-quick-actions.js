import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { createControlServer } from './control-server.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-quick-actions-'))
const input = path.join(workspace, 'input')
const output = path.join(workspace, 'output')
const source = path.join(input, 'quick-action-portrait.jpg')
const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0 })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const errors = []
const checks = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.origin)
  await page.locator('summary').click()
  await page.getByRole('button', { name: '选择文件夹' }).nth(0).waitFor()
  await page.getByRole('button', { name: '选择文件夹' }).nth(1).waitFor()
  assert.ok(await page.getByRole('option', { name: '自动选择（推荐）' }).count())
  checks.push('settings card exposes two native folder-picker actions and automatic device selection')
  await page.getByLabel('照片来源文件夹').fill(input)
  await page.getByLabel('分类结果文件夹').fill(output)
  await page.getByLabel('推理设备').selectOption('cpu')
  await page.getByRole('button', { name: /选择 基础分析/ }).click()
  await page.getByText('模型选择已保存；下一次筛选生效。', { exact: true }).waitFor()
  await page.locator('summary').click()
  await mkdir(input, { recursive: true })
  const bytes = await sharp(await readFile('data/eval/photos/portrait.jpg')).modulate({ brightness: 1.4 }).jpeg().toBuffer()
  await writeFile(source, bytes)
  await writeFile(path.join(input, 'quick-action-duplicate.jpg'), bytes)
  await page.getByRole('button', { name: /一键筛选/ }).click()
  await page.waitForFunction(async () => {
    const response = await fetch('/api/status', { cache: 'no-store' })
    const next = await response.json()
    return next.phase === 'starting' || next.phase === 'running' || next.progress?.phase === 'finished'
  }, null, { timeout: 30000 })
  checks.push('finite batch starts or already finishes; fast completion is not a missing stop-button failure')
  await page.getByRole('heading', { name: 'quick-action-portrait.jpg', exact: true }).waitFor({ timeout: 30000 })
  await page.getByRole('heading', { name: 'quick-action-duplicate.jpg', exact: true }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: /查看详情/ }).first().click()
  await page.getByRole('dialog', { name: /照片详情/ }).waitFor()
  await page.getByRole('dialog').getByText(/查看技术依据/).waitFor()
  await page.getByRole('button', { name: '关闭 ×' }).click()
  assert.equal(await page.getByRole('dialog').count(), 0)
  checks.push('photo card opens bounded large preview and analysis detail modal')
  await page.waitForFunction(async () => {
    const status = await (await fetch('/api/status')).json()
    return status.phase === 'stopped' && status.progress.phase === 'finished'
  })
  await page.getByRole('button', { name: /一键筛选/ }).waitFor()
  checks.push('一键筛选 processes existing photos and automatically stops with progress retained')
  const before = await (await fetch(server.origin + '/api/status')).json()
  const record = before.records.find(item => item.name === 'quick-action-portrait.jpg')
  assert.equal(record.category, '单人')
  assert.equal(record.curated, false)
  await page.locator('button.quick-action').filter({ hasText: '辅助推荐' }).click()
  await page.getByRole('status').filter({ hasText: /已挑出/ }).waitFor({ timeout: 30000 })
  const firstStatus = await (await fetch(server.origin + '/api/status')).json()
  assert.equal(firstStatus.records.filter(item => item.curated).length, 1)
  const manifest = JSON.parse(await readFile(path.join(output, '精选', 'selection.json'), 'utf8'))
  assert.equal(manifest.selected.length, 1)
  assert.equal(await page.getByText('为什么这些照片入选？', { exact: true }).count(), 0)
  await page.getByRole('button', { name: /查看详情/ }).first().click()
  await page.getByRole('dialog').getByText('为什么推荐这张照片', { exact: true }).waitFor()
  checks.push('精选依据只在打开精选照片详情后显示')
  await page.getByRole('button', { name: '关闭 ×' }).click()
  await access(manifest.selected[0].output)
  assert.deepEqual(await readFile(manifest.selected[0].output), bytes)
  assert.deepEqual(await readFile(source), bytes)
  checks.push('辅助推荐 creates one deduplicated 精选 copy and preserves original bytes')
  await page.locator('button.quick-action').filter({ hasText: '辅助推荐' }).click()
  await page.getByRole('status').filter({ hasText: /已挑出/ }).waitFor({ timeout: 30000 })
  await page.waitForFunction(async () => (await (await fetch('/api/status')).json()).phase === 'stopped' && !document.querySelector('.quick-action.secondary').disabled)
  const secondResponse = await fetch(server.origin + '/api/curate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lenssort-token': firstStatus.token }, body: '{}' })
  assert.equal(secondResponse.status, 200)
  const second = await secondResponse.json()
  assert.equal(second.reused, true)
  checks.push('repeated 辅助推荐 is idempotent')
  await page.getByRole('button', { name: /一键筛选/ }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  assert.deepEqual(errors, [])
  await page.screenshot({ path: 'artifacts/quick-actions-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: 'artifacts/quick-actions-desktop.png', fullPage: true })
  checks.push('mobile layout has no horizontal overflow and no page errors')
  const report = { status: 'passed', createdAt: new Date().toISOString(), checks, errors, workspace, fixture: 'Public portrait with local brightness adjustment; engineering flow verification only, not accuracy or aesthetics evaluation', originalSha256: createHash('sha256').update(bytes).digest('hex'), selected: manifest.selected }
  await writeFile('artifacts/quick-actions-verification.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, checks, errors }, null, 2))
} catch (error) {
  await writeFile('artifacts/quick-actions-failure.json', JSON.stringify({ status: 'failed', createdAt: new Date().toISOString(), checks, workspace, error: error.stack, errors }, null, 2))
  throw error
} finally { await browser.close(); await server.close() }
