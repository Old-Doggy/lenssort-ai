import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createControlServer } from './control-server.js'

const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-web-'))
const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0 })
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'] })
const errors = []
const checks = []
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.origin)
  await page.locator('summary').click()
  const input = path.join(workspace, 'input')
  const output = path.join(workspace, 'output')
  await mkdir(input, { recursive: true })
  await mkdir(output, { recursive: true })
  await page.getByLabel('照片来源文件夹').fill(input)
  await page.getByLabel('分类结果文件夹').fill(output)
  for (const backend of ['igpu', 'dgpu', 'npu']) {
    await page.getByLabel('推理设备').selectOption(backend)
    const bytes = await readFile('data/eval/photos/portrait.jpg')
    const filename = backend + '-portrait.jpg'
    await writeFile(path.join(workspace, 'input', filename), backend === 'igpu' ? bytes : Buffer.concat([bytes, Buffer.from(backend + '-fixture')]))
    await page.locator('button.quick-action.primary').click()
    await page.getByRole('heading', { name: filename, exact: true }).waitFor({ timeout: 45000 })
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: filename, exact: true }) })
    assert.equal(await card.locator('.control-category').textContent(), '单人')
    if (backend === 'npu') {
      const current = await (await fetch(server.origin + '/api/status')).json()
      assert.equal(current.npuVerified, true)
      const record = current.records.find(item => item.name === filename)
      assert.equal(record.npuVerified, true)
      assert.ok(record.npuEvidence.providers.includes('VitisAIExecutionProvider'))
      const profile = JSON.parse(await readFile(record.npuEvidence.profile, 'utf8'))
      assert.ok(profile.some(event => event.args?.provider === 'VitisAIExecutionProvider'))
    }
    checks.push('webpage starts/stops ' + backend + ', new photo classified with actual selected device')
  }
  await page.screenshot({ path: 'artifacts/control-web-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'artifacts/control-web-mobile.png', fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  assert.deepEqual(errors, [])
  const status = await (await fetch(server.origin + '/api/status')).json()
  assert.ok(status.records.some(record => record.device?.id === 'igpu'))
  assert.ok(status.records.some(record => record.device?.id === 'dgpu'))
  assert.ok(status.records.some(record => record.device?.id === 'npu'))
  const report = { status: 'passed', createdAt: new Date().toISOString(), checks, records: status.records, errors, workspace, mobileOverflow: false }
  await writeFile('artifacts/control-browser-verification.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, checks, errors }, null, 2))
} finally { await browser.close(); await server.close() }
