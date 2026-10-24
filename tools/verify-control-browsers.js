import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createControlServer } from './control-server.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-browsers-'))
const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0 })
const browsers = ['chrome', 'msedge']
const checks = []
const errors = []
const results = []

try {
  for (const channel of browsers) {
    const browser = await chromium.launch({ channel, headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      await page.goto(server.origin)
      await page.locator('summary').click()
      await page.getByLabel('照片来源文件夹').fill(path.join(workspace, channel, 'input'))
      await page.getByLabel('分类结果文件夹').fill(path.join(workspace, channel, 'output'))
      await page.getByLabel('推理设备').selectOption('cpu')
      await page.getByRole('button', { name: '开始自动分类', exact: true }).click()
      await page.getByRole('button', { name: '停止监听', exact: true }).waitFor({ timeout: 30000 })
      const bytes = await readFile('data/eval/photos/portrait.jpg')
      const filename = channel + '-portrait.jpg'
      await writeFile(path.join(workspace, channel, 'input', filename), bytes)
      await page.getByRole('heading', { name: filename, exact: true }).waitFor({ timeout: 30000 })
      const card = page.locator('article').filter({ has: page.getByRole('heading', { name: filename, exact: true }) })
      assert.equal(await card.locator('.control-category').textContent(), '单人')
      assert.deepEqual(pageErrors, [])
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      await page.getByRole('button', { name: '停止监听', exact: true }).click()
      await page.getByRole('button', { name: '开始自动分类', exact: true }).waitFor()
      checks.push(channel + ' opens control page and automatically classifies a new photo')
      results.push({ browser: channel, category: '单人', pageErrors: pageErrors.length, mobileOverflow: false })
    } catch (error) {
      errors.push({ browser: channel, error: error.message })
    } finally {
      await browser.close()
    }
  }
} finally {
  await server.close()
}

const report = { status: errors.length ? 'partial' : 'passed', createdAt: new Date().toISOString(), browsers, checks, results, errors, workspace }
await writeFile('artifacts/control-browser-compatibility.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({ status: report.status, checks, results, errors }, null, 2))
if (report.status !== 'passed') process.exitCode = 1
