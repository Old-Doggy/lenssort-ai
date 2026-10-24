import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createVisionLanguageExplainer } from './vision-language-explainer.js'
import { inspectResources, ollamaRequest } from './model-resources.js'

const reportFile = path.resolve('artifacts/resource-real-2026-10-19.json')
const report = { createdAt: new Date().toISOString(), passed: false }
let explainer
const snapshot = async () => ({ resources: await inspectResources(), running: (await ollamaRequest('/api/ps', {}, 3000)).models ?? [] })
try {
  report.before = await snapshot()
  assert.equal(report.before.running.length, 0, '真实测试仅在Ollama无用户驻留模型时运行')
  const samples = JSON.parse(await readFile('artifacts/precision-research/samples-refined.json', 'utf8'))
  const photo = await readFile(samples[0].file)
  explainer = await createVisionLanguageExplainer({ model: 'qwen3.5:4b' })
  report.initialStatus = explainer.status
  assert.equal(explainer.status.status, 'ready', '当前电脑须满足4B安全门槛')
  const started = performance.now()
  report.result = await explainer.explain(photo)
  report.durationMs = Math.round(performance.now() - started)
  report.loaded = await snapshot()
  report.loadedStatus = explainer.status
  assert.equal(report.result.generated, true)
  assert.equal(report.loadedStatus.fullyGpuResident, true)
  assert.ok(report.loaded.running.some(item => item.name === 'qwen3.5:4b'))
  await explainer.close()
  report.closedStatus = explainer.status
  explainer = null
  for (let attempt = 0; attempt < 20; attempt++) {
    report.after = await snapshot()
    if (!report.after.running.some(item => item.name === 'qwen3.5:4b')) break
    await sleep(250)
  }
  assert.equal(report.after.running.some(item => item.name === 'qwen3.5:4b'), false, '本批模型结束须卸载')
  report.passed = true
} catch (error) {
  report.error = error.stack || error.message
  process.exitCode = 1
} finally {
  if (explainer) await explainer.close()
  await writeFile(reportFile, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: report.passed, durationMs: report.durationMs, loadedGpuGiB: report.loaded?.running.map(item => ({ model: item.name, vramGiB: Number((item.size_vram / 1024 ** 3).toFixed(2)) })), afterModels: report.after?.running.length, error: report.error, reportFile }, null, 2))
}
