import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'
import { ensureOllama } from './ollama-lifecycle.js'
import { inspectResources } from './model-resources.js'

const root = process.cwd()
const outputArgument = process.argv.find(value => value.startsWith('--output='))?.slice('--output='.length)
const directory = path.resolve(root, outputArgument || 'artifacts/public-eval-review/retest-2026-10-22')
await mkdir(directory, { recursive: true })
const source = JSON.parse(await readFile('artifacts/open-images-download-manifest.json', 'utf8'))
const previous = JSON.parse(await readFile('artifacts/public-eval-review/manual-review.json', 'utf8'))
const labels = JSON.parse(await readFile('artifacts/public-eval-review/human-corrections-2026-10-22.json', 'utf8'))
const allSamples = source.records.filter(record => record.downloadStatus === 'downloaded')
const requested = process.argv.find(value => value.startsWith('--numbers='))?.slice('--numbers='.length).split(',').map(Number)
const samples = allSamples.filter((_sample, index) => !requested || requested.includes(index + 1))
const report = { version: 1, startedAt: new Date().toISOString(), complete: false, model: 'qwen3.5:4b', backend: 'npu', labelBoundary: '人工局部纠错回归，不能称为独立测试集准确率', resourcesBefore: await inspectResources(), records: [] }
const save = () => writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2), 'utf8')
let service
let analyzer
try {
  service = await ensureOllama()
  assert.ok(['started', 'reused'].includes(service.status), service.message)
  analyzer = await createPhotoAnalyzer(root, 'npu', report.model)
  assert.equal(analyzer.visionModelStatus.model, report.model, '评测禁止静默替换模型或基础降级')
  for (const [index, sample] of samples.entries()) {
    const bytes = await readFile(path.resolve(root, sample.localPath))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sample.sha256)
    const name = path.basename(sample.localPath)
    const annotation = labels.records.find(record => record.sha256 === sample.sha256)
    const before = previous.records.find(record => record.name === name)
    const started = performance.now()
    const result = await analyzer.analyze(bytes)
    const row = { number: allSamples.indexOf(sample) + 1, name, sha256: sample.sha256, localPath: sample.localPath, previousCategory: before?.predictedCategory, expected: annotation?.expected ?? null, result, ms: Math.round(performance.now() - started) }
    report.records.push(row)
    const destination = path.join(directory, 'classified', result.category, name)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.resolve(root, sample.localPath), destination)
    await save()
    console.log(JSON.stringify({ number: row.number, before: row.previousCategory, after: result.category, human: row.expected, vision: result.visionExplanation?.generated === true, ms: row.ms }))
    assert.equal(analyzer.visionModelStatus.status, 'ready', '运行期模型不可用，停止评测；不把基础模型替代结果算成功')
  }
  report.complete = true
} catch (error) {
  report.error = error.stack
  process.exitCode = 1
} finally {
  try { if (analyzer) await analyzer.close() }
  catch (error) { report.cleanupError = error.stack; process.exitCode = 1 }
  try { if (service) await service.stop() }
  catch (error) { report.serviceCleanupError = error.stack; process.exitCode = 1 }
  report.finishedAt = new Date().toISOString()
  report.resourcesAfter = await inspectResources()
  await save()
  console.log(JSON.stringify({ complete: report.complete, processed: report.records.length, directory, error: report.error }))
}
