import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createControlServer } from './control-server.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-manual-category-web-'))
const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0 })
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'] })
const checks = []
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.origin)
  await page.locator('summary').click()
  await page.getByLabel('照片来源文件夹').fill(path.join(workspace, 'input'))
  await page.getByLabel('分类结果文件夹').fill(path.join(workspace, 'output'))
  await page.getByLabel('推理设备').selectOption('cpu')
  const filename = '人工修改分类-测试.jpg'
  await mkdir(path.join(workspace, 'input'), { recursive: true })
  await mkdir(path.join(workspace, 'output'), { recursive: true })
  await writeFile(path.join(workspace, 'input', filename), await readFile('data/eval/photos/portrait.jpg'))
  await page.getByRole('button', { name: '开始自动分类', exact: true }).click()
  await page.getByRole('heading', { name: filename, exact: true }).waitFor({ timeout: 30000 })
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: filename, exact: true }) })
  await card.getByRole('button', { name: '查看详情', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.getByRole('dialog').locator('.control-category').first().textContent(), '单人')
  checks.push('details modal opens from a classified photo card')

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('dialog').getByLabel('修改照片分类').selectOption('风景')
  await page.getByRole('dialog').getByText('人工修正', { exact: true }).waitFor({ timeout: 10000 })
  assert.equal(await page.getByRole('dialog').getByLabel('修改照片分类').inputValue(), '风景')
  checks.push('category selector confirms a manual correction and shows the badge')

  const status = await (await fetch(server.origin + '/api/status')).json()
  const record = status.records.find(item => item.name === filename)
  assert.equal(record.category, '风景')
  assert.equal(record.manualCategory, '风景')
  assert.equal(record.manualAction, 'category-corrected')
  checks.push('web correction persists in the status projection')
  assert.deepEqual(await readFile(path.join(workspace, 'input', filename)), await readFile('data/eval/photos/portrait.jpg'))
  checks.push('browser correction preserves the input original')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: 'artifacts/p5-2-manual-category-browser.png', fullPage: true })
} finally {
  await browser.close()
  await server.close()
}
const report = { status: 'passed', createdAt: new Date().toISOString(), kind: 'browser manual category correction with local fixture - not AI accuracy', checks, errors, workspace }
await writeFile('artifacts/p5-2-manual-category-browser.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
