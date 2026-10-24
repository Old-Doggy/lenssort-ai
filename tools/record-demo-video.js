import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import sharp from 'sharp'
import { chromium } from 'playwright'
import { createControlServer } from './control-server.js'

const root = process.cwd()
const outputDir = path.join(root, 'output', 'playwright')
const workspace = path.join(outputDir, 'demo-workspaces', randomUUID())
const input = path.join(workspace, 'input')
const output = path.join(workspace, 'output')
const source = path.join(input, 'demo-portrait.jpg')
await mkdir(outputDir, { recursive: true })
await mkdir(input, { recursive: true })
await mkdir(output, { recursive: true })
const bytes = await sharp(await readFile(path.join(root, 'data', 'eval', 'photos', 'portrait.jpg'))).modulate({ brightness: 1.4 }).jpeg().toBuffer()

const server = await createControlServer({ root, controlDir: path.join(workspace, 'control'), port: 0 })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } }, viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const status = await (await fetch(server.origin + '/api/status')).json()
const report = { status: 'failed', createdAt: new Date().toISOString(), fixture: '公开演示人像的本地亮度变换；仅证明网页操作，不代表真实准确率、审美结论或真人满意度', errors, checks: [] }
const video = page.video()
const hold = async (text, milliseconds) => {
  await page.evaluate(text => {
    let caption = document.getElementById('recording-caption')
    if (!caption) {
      caption = document.createElement('div')
      caption.id = 'recording-caption'
      caption.style.cssText = 'position:fixed;bottom:16px;left:24px;right:24px;z-index:9999;padding:14px 20px;background:#102a43;color:white;border-radius:12px;font:17px sans-serif;pointer-events:none'
      document.body.append(caption)
    }
    caption.textContent = '自动化实机演示 · ' + text
  }, text)
  await page.waitForTimeout(milliseconds)
}

try {
  const configured = await fetch(server.origin + '/api/config', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lenssort-token': status.token }, body: JSON.stringify({ input, output, backend: 'npu' }) })
  if (!configured.ok) throw new Error('Demo configuration failed')
  await page.goto(server.origin)
  await page.getByRole('button', { name: /一键筛选/ }).waitFor()
  await hold('网页是控制入口：日常只用一键筛选、辅助推荐。此录制为本地流程演示，不是真人测试。', 25000)
  await page.locator('summary').click()
  await hold('首次设置一次来源/输出文件夹和设备；本次实际选择 AMD NPU。目录为隔离演示路径。', 15000)
  await page.locator('summary').click()
  await page.getByRole('button', { name: /一键筛选/ }).click()
  await page.getByRole('button', { name: /停止筛选/ }).waitFor({ timeout: 30000 })
  await hold('监听已启动。下面实际向来源文件夹写入公开人像与一个相同内容副本，不在网页逐张上传。', 10000)
  await writeFile(source, bytes)
  await writeFile(path.join(input, 'demo-duplicate.jpg'), bytes)
  await page.getByRole('heading', { name: 'demo-portrait.jpg', exact: true }).waitFor({ timeout: 30000 })
  await page.getByRole('heading', { name: 'demo-duplicate.jpg', exact: true }).waitFor({ timeout: 30000 })
  const analyzed = await (await fetch(server.origin + '/api/status')).json()
  assert.equal(analyzed.records.filter(record => record.status === 'done').length, 2)
  assert.ok(analyzed.records.every(record => record.npuVerified))
  const evidence = analyzed.records[0].npuEvidence
  const profile = JSON.parse(await readFile(evidence.profile, 'utf8'))
  assert.ok(profile.some(event => event.args?.provider === 'VitisAIExecutionProvider'))
  report.checks.push('新增文件自动分类，照片结果与 VitisAI profile 确认 NPU 混合执行')
  await page.locator('.control-results').scrollIntoViewIfNeeded()
  await hold('文件写入稳定后自动显示分类结果、技术质量与设备；NPU 包含 CPU 辅助算子，不宣称纯 NPU。', 20000)
  await page.locator('.control-quick-actions').scrollIntoViewIfNeeded()
  await hold('辅助推荐会结合审美候选分、技术质量与相似度进行初筛：仍不替代人工最终选择。', 15000)
  await page.getByRole('button', { name: /辅助推荐/ }).click()
  await page.getByRole('status').filter({ hasText: /已挑出/ }).waitFor({ timeout: 30000 })
  const manifest = JSON.parse(await readFile(path.join(output, '精选', 'selection.json'), 'utf8'))
  assert.equal(manifest.selected.length, 1)
  assert.deepEqual(await readFile(manifest.selected[0].output), bytes)
  assert.deepEqual(await readFile(source), bytes)
  report.checks.push('重复内容只精选一份，精选副本与原图字节一致')
  await page.locator('.control-results').scrollIntoViewIfNeeded()
  await hold('实际精选副本已生成：相同内容只留一份。选择符合技术条件候选的前30%，原图不删除、不移动。', 20000)
  await page.locator('.control-quick-actions').scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: /停止筛选/ }).click()
  await page.getByRole('button', { name: /一键筛选/ }).waitFor({ timeout: 30000 })
  await hold('停止筛选后不再监听；分类与精选产出留在输出目录。真实六类准确率、统一功耗、真人反馈仍待验收。', 25000)
  if (errors.length) throw new Error('Demo page errors: ' + errors.join('; '))
  await page.screenshot({ path: path.join(outputDir, 'lenssort-folder-demo-final.png'), fullPage: true })
  report.status = 'passed'
} catch (error) {
  report.error = error.stack
  throw error
} finally {
  await context.close()
  await browser.close()
  await server.close()
  await writeFile(path.join(outputDir, 'lenssort-folder-demo.json'), JSON.stringify(report, null, 2))
  await rm(workspace, { recursive: true, force: true })
}

const videoPath = await video.path()
const finalPath = path.join(outputDir, 'lenssort-folder-demo.webm')
await rename(videoPath, finalPath)
report.video = finalPath
report.sha256 = createHash('sha256').update(await readFile(finalPath)).digest('hex')
report.flow = ['网页打开', '一键筛选', '放入文件夹后自动分类', '辅助推荐', '停止筛选']
await writeFile(path.join(outputDir, 'lenssort-folder-demo.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
