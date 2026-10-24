import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createControlServer } from './control-server.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-rescan-web-'))
const input = path.join(workspace, '中文来源')
const output = path.join(workspace, '中文结果')
const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0 })
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'] })
const checks = []
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.origin)
  await page.locator('summary').click()
  await page.getByLabel('照片来源文件夹').fill(input)
  await page.getByLabel('分类结果文件夹').fill(output)
  await page.getByLabel('推理设备').selectOption('cpu')
  const outputFilename = '重新扫描-输出副本测试.jpg'
  await mkdir(input, { recursive: true })
  await mkdir(output, { recursive: true })
  await writeFile(path.join(input, outputFilename), await readFile('data/eval/photos/portrait.jpg'))
  await page.locator('button.quick-action.primary').click()
  await page.getByRole('heading', { name: outputFilename, exact: true }).waitFor({ timeout: 30000 })
  const outputCard = page.locator('article').filter({ has: page.getByRole('heading', { name: outputFilename, exact: true }) })
  checks.push('a new photo appears before rescan')
  const statusBeforeOutputDelete = await page.evaluate(() => fetch('/api/status', { cache: 'no-store' }).then(response => response.json()))
  const outputPath = statusBeforeOutputDelete.records.find(record => record.name === outputFilename)?.output
  assert.ok(outputPath, 'processed photo should expose its output path to the local control page')
  await rm(outputPath)
  await page.getByRole('button', { name: /刷新当前文件夹/ }).click()
  await page.getByRole('status').filter({ hasText: '输出缺失 1 张' }).waitFor({ timeout: 10000 })
  assert.equal(await outputCard.count(), 0)
  checks.push('rescan removes a card whose classification copy no longer exists')

  const sourceFilename = '重新扫描-源文件测试.jpg'
  await writeFile(path.join(input, sourceFilename), await readFile('data/eval/photos/portrait.jpg'))
  await page.locator('button.quick-action.primary').click()
  await page.getByRole('heading', { name: sourceFilename, exact: true }).waitFor({ timeout: 30000 })
  const sourceCard = page.locator('article').filter({ has: page.getByRole('heading', { name: sourceFilename, exact: true }) })
  await rm(path.join(input, sourceFilename))
  await page.getByRole('button', { name: /刷新当前文件夹/ }).click()
  await page.getByRole('status').filter({ hasText: '源文件移除 1 张' }).waitFor({ timeout: 10000 })
  assert.equal(await sourceCard.count(), 0)
  checks.push('rescan removes a card whose source file no longer exists')
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
const report = { status: 'passed', createdAt: new Date().toISOString(), kind: 'browser rescan with local fixture - not AI accuracy', checks, errors, workspace }
await writeFile('artifacts/p5-3-rescan-browser.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
