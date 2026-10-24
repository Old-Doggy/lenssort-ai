import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const directory = path.join(process.cwd(), 'output/playwright')
const reportPath = path.join(directory, 'lenssort-folder-demo.json')
const report = JSON.parse(await readFile(reportPath, 'utf8'))
assert.equal(report.status, 'passed')
assert.equal(createHash('sha256').update(await readFile(report.video)).digest('hex'), report.sha256)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(pathToFileURL(path.join(directory, 'lenssort-demo-player.html')).href)
  await page.waitForFunction(() => document.querySelector('video').readyState >= 1)
  const metadata = await page.locator('video').evaluate(video => ({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }))
  assert.ok(metadata.duration >= 120 && metadata.duration <= 180)
  assert.equal(metadata.width, 1440)
  assert.equal(metadata.height, 900)
  for (const seconds of [5, 65, 100]) {
    await page.locator('video').evaluate((video, seconds) => new Promise((resolve, reject) => {
      video.addEventListener('seeked', resolve, { once: true })
      video.addEventListener('error', () => reject(new Error('Video decode error')), { once: true })
      video.currentTime = seconds
    }), seconds)
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2)
  }
  await page.screenshot({ path: path.join(directory, 'lenssort-demo-player.png'), fullPage: true })
  report.playbackVerification = { status: 'passed', createdAt: new Date().toISOString(), ...metadata, seekSeconds: [5, 65, 100], sha256Matched: true }
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.playbackVerification, null, 2))
} catch (error) {
  await writeFile(path.join(directory, 'lenssort-demo-playback-failure.json'), JSON.stringify({ status: 'failed', createdAt: new Date().toISOString(), error: error.stack }, null, 2))
  throw error
} finally { await browser.close() }
