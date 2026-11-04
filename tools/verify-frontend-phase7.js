import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'

// Isolated UI fixtures: no user folders, model services, or inference are used.
const baseline = process.argv.includes('--baseline')
const out = path.resolve('output/playwright', 'phase7-' + Date.now())
await mkdir(out, { recursive: true })
const image = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#85ae99' } }).jpeg().toBuffer()
const config = { input: 'X:/示例照片/' + '中文长文件夹/'.repeat(12), output: 'X:/示例分类结果', backend: 'auto', model: 'off' }
const classes = ['单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认']
let records = []
const traffic = { status: [], thumbnails: [], images: [], details: [] }
const report = { kind: 'synthetic frontend only; not inference accuracy or speed', baseline, checks: [], violations: [], sizes: [], performance: [], errors: [], node: process.version, os: os.platform(), ramGiB: Math.round(os.totalmem() / 2 ** 30) }
const makeRecords = count => Array.from({ length: count }, (_, i) => ({ id: String(i), name: '场景照片-' + i + '-中文长文件名.jpg', category: classes[i % classes.length], status: 'done', explanation: '工程测试生成的画面说明，仅用于布局与交互验证', qualityScore: 70, faceCount: 0 }))
const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname
  const json = data => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }
  try {
    if (route === '/api/status') { traffic.status.push(Date.now()); json({ token: 'isolated-ui-fixture', config, phase: 'stopped', devices: [{ id: 'auto', name: '自动选择（推荐）' }, { id: 'igpu', name: '核显 · 测试设备长名称' }], records, npuVerified: false, progress: { phase: 'finished', total: records.length, completed: records.length, pending: 0, message: '本批已完成' } }); return }
    if (route === '/api/models') { json({ resources: { totalRamGiB: 16, freeRamGiB: 8, totalVramGiB: 0, freeVramGiB: 0 }, options: [{ id: 'off', label: '基础分析', installed: true, minRamGiB: 0, minVramGiB: 0, advice: '基础分类测试' }], serviceMessage: 'Ollama 未连接', recommendation: { selected: 'off', fallback: false, reason: '工程测试' } }); return }
    if (route.startsWith('/api/thumbnail/') || route.startsWith('/api/photo-image/')) { (route.includes('thumbnail') ? traffic.thumbnails : traffic.images).push(route); res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); res.end(image); return }
    if (route.startsWith('/api/photo/')) { traffic.details.push(route); json(records.find(record => record.id === route.split('/').pop())); return }
    const file = path.resolve('dist', route === '/' ? 'index.html' : '.' + route)
    if (!file.startsWith(path.resolve('dist') + path.sep)) { res.writeHead(403); res.end(); return }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(body)
  } catch { res.writeHead(404); res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const check = (ok, label) => { report.checks.push({ label, passed: Boolean(ok) }); if (!ok) report.violations.push(label) }
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
try {
  records = makeRecords(100)
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  report.browser = browser.version()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(origin)
  await page.locator('.control-photo').first().waitFor()
  for (const [width, height, scale] of [[1366,768,1],[1920,1080,1],[2560,1440,1],[1093,614,1.25],[911,512,1.5],[600,800,1],[390,844,1],[320,640,1]]) {
    await page.setViewportSize({ width, height })
    await settle(page)
    const bodyOK = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    await page.getByRole('button', { name: '查看详情', exact: true }).first().click()
    const modal = page.getByRole('dialog')
    const modalOK = await modal.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth)
    report.sizes.push({ width, height, scale, method: scale === 1 ? 'viewport' : 'equivalent CSS viewport for 1366x768 zoom; native browser zoom requires human', bodyOK, modalOK })
    check(bodyOK && modalOK, 'layout ' + width + 'x' + height)
    if (width === 911 || width === 390) await page.screenshot({ path: path.join(out, 'detail-' + width + '.png') })
    await page.keyboard.press('Escape')
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  const opener = page.getByRole('button', { name: '查看详情', exact: true }).first()
  await opener.focus()
  await page.keyboard.press('Enter')
  const modal = page.getByRole('dialog')
  await modal.waitFor()
  check(await modal.evaluate(el => el.contains(document.activeElement)), 'dialog initial focus')
  await modal.locator('.danger-action').focus()
  await page.keyboard.press('Tab')
  check(await modal.evaluate(el => el.contains(document.activeElement)), 'dialog Tab stays inside')
  await modal.locator('.photo-modal-close').focus()
  await page.keyboard.press('Shift+Tab')
  check(await modal.evaluate(el => el.contains(document.activeElement)), 'dialog Shift+Tab stays inside')
  check(await page.evaluate(() => document.body.style.overflow === 'hidden'), 'dialog locks background scroll')
  await page.keyboard.press('Escape')
  check(await opener.evaluate(el => el === document.activeElement), 'closing dialog restores opener focus')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await opener.click()
  check(await modal.evaluate(el => parseFloat(getComputedStyle(el).animationDuration) <= 0.01), 'reduced motion')
  await page.keyboard.press('Escape')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.close()
  for (const count of [100,300,500]) {
    records = makeRecords(count)
    const p = await browser.newPage({ viewport: { width: 1366, height: 768 } })
    p.on('pageerror', error => report.errors.push(error.message))
    const cdp = await p.context().newCDPSession(p)
    await cdp.send('Performance.enable')
    const thumbnailStart = traffic.thumbnails.length
    const imageStart = traffic.images.length
    const start = performance.now()
    await p.goto(origin)
    await p.locator('.control-photo').first().waitFor()
    const firstDisplayMs = Math.round(performance.now() - start)
    const initialThumbs = traffic.thumbnails.length - thumbnailStart
    check(traffic.images.length === imageStart, count + ' no full image before details')
    const frames = await p.evaluate(async () => {
      const gaps = []
      let previous = performance.now()
      for (let i = 0; i < 120; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        const now = performance.now(); gaps.push(now - previous); previous = now
        scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * i / 119)
      }
      return gaps.sort((a,b) => a-b)
    })
    await p.waitForTimeout(1000)
    const seen = new Set(traffic.thumbnails)
    const requestsBefore = traffic.thumbnails.length
    const filter = p.getByRole('navigation', { name: '分类筛选' })
    await filter.getByRole('button', { name: /^单人/ }).click()
    await filter.getByRole('button', { name: /^失败/ }).click()
    await filter.getByRole('button', { name: /^全部/ }).click()
    await p.waitForTimeout(500)
    const duplicateRequests = traffic.thumbnails.slice(requestsBefore).filter(url => seen.has(url)).length
    const openStart = performance.now()
    await p.getByRole('button', { name: '查看详情', exact: true }).first().click()
    await p.getByRole('dialog').locator('.photo-modal-image img').evaluate(img => img.decode())
    const detailMs = Math.round(performance.now() - openStart)
    await p.keyboard.press('Escape')
    const memory = []
    const pollsStart = traffic.status.length
    const duration = count === 500 ? (baseline ? 60000 : 300000) : 0
    const t0 = Date.now()
    let monitoring = true
    while (monitoring) {
      await cdp.send('HeapProfiler.collectGarbage')
      const metrics = await cdp.send('Performance.getMetrics')
      memory.push({ seconds: Math.round((Date.now()-t0)/1000), heapMiB: Math.round(metrics.metrics.find(m => m.name === 'JSHeapUsedSize').value / 2**20 * 10)/10 })
      if (Date.now()-t0 >= duration) monitoring = false
      else await p.waitForTimeout(Math.min(10000, duration - (Date.now()-t0)))
    }
    const item = { count, firstDisplayMs, detailMs, frameP95Ms: Math.round(frames[Math.floor(frames.length*.95)]), frameMaxMs: Math.round(frames.at(-1)), initialThumbs, duplicateRequests, memory, idlePolls: traffic.status.length-pollsStart, observationMs: duration }
    report.performance.push(item)
    check(await p.locator('.control-photo').count() === count, count + ' cards available')
    check(duplicateRequests === 0, count + ' category switch avoids repeated thumbnail downloads')
    if (count === 500) {
      check(item.idlePolls >= Math.floor(duration/5000)-2 && item.idlePolls <= Math.ceil(duration/5000)+2, 'completed batch uses slow polling')
      check(memory.at(-1).heapMiB - memory[0].heapMiB < 5, '500 retained JS heap has no large growth in observation window')
    }
    console.log(JSON.stringify(item))
    await p.screenshot({ path: path.join(out, 'results-' + count + '.png') })
    await p.close()
  }
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  report.passed = !report.error && !report.violations.length && !report.errors.length
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ report: path.relative(process.cwd(), out), passed: report.passed, violations: report.violations, error: report.error }))
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  if (!baseline && !report.passed) process.exitCode = 1
}
