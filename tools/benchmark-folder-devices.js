import path from 'node:path'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'
import { inspectResources } from './model-resources.js'

const root = process.cwd()
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif'])
const defaultInputs = [
  path.join(root, 'data/eval/similarity_cases'),
  path.join(root, 'data/eval/similarity_cases_extra'),
]

function option(name, fallback) {
  const prefix = '--' + name + '='
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

async function collectImages(folder) {
  const entries = await readdir(folder, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const file = path.join(folder, entry.name)
    if (entry.isDirectory()) files.push(...await collectImages(file))
    else if (entry.isFile() && imageExtensions.has(path.extname(file).toLowerCase())) files.push(file)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function percentile(values, level) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return Number(sorted[Math.floor((sorted.length - 1) * level)].toFixed(2))
}

function average(values) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null
}

function summarize(records) {
  const durations = records.filter(record => record.ok).map(record => record.durationMs)
  const inferenceDurations = records.filter(record => record.ok).map(record => record.classificationMs)
  const stageNames = ['readMs', 'decodePreprocessMs', 'faceMs', 'qualityMs', 'classificationMs']
  const stages = Object.fromEntries(stageNames.map(stage => {
    const values = records.filter(record => record.ok && Number.isFinite(record[stage])).map(record => record[stage])
    return [stage, { average: average(values), p50: percentile(values, 0.5), p95: percentile(values, 0.95) }]
  }))
  const elapsedMs = records.reduce((sum, record) => sum + record.durationMs, 0)
  return {
    attempted: records.length,
    succeeded: records.filter(record => record.ok).length,
    failed: records.filter(record => !record.ok).length,
    failureRate: records.length ? Number((records.filter(record => !record.ok).length / records.length).toFixed(4)) : null,
    totalPhotoMs: Number(elapsedMs.toFixed(2)),
    photosPerSecond: elapsedMs ? Number((records.length * 1000 / elapsedMs).toFixed(3)) : null,
    durationMs: { average: average(durations), p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
    classificationMs: { average: average(inferenceDurations), p50: percentile(inferenceDurations, 0.5), p95: percentile(inferenceDurations, 0.95) },
    stages,
  }
}

const inputOption = option('input', '')
const inputFolders = inputOption ? inputOption.split(';').filter(Boolean).map(folder => path.resolve(folder)) : defaultInputs
const limit = Math.max(1, Number.parseInt(option('limit', '30'), 10) || 30)
const passes = Math.max(1, Number.parseInt(option('passes', '1'), 10) || 1)
const concurrencyValue = option('concurrency', '1')
if (!/^(1|2)$/.test(concurrencyValue)) throw new Error('concurrency must be 1 or 2')
const concurrency = Number(concurrencyValue)
const backends = option('backends', 'cpu,igpu,dgpu,npu').split(',').map(item => item.trim()).filter(Boolean)
const samples = []
for (const folder of inputFolders) samples.push(...await collectImages(folder))
const selected = samples.slice(0, limit)
if (!selected.length) throw new Error('No benchmark images found; use --input=folder or add the documented local fixtures')

const report = {
  status: 'passed',
  createdAt: new Date().toISOString(),
  workspace: root,
  inputFolders: inputFolders.map(folder => path.basename(folder)),
  sampleCount: selected.length,
  passes,
  concurrency,
  backends,
  measurements: [],
  limitations: [
    'This benchmark measures local inference and face-detection pipeline time, not photo classification accuracy.',
    'The default fixtures are engineering samples, not a representative natural-photo album.',
    'Power consumption is not measured because this script has no calibrated hardware power source.',
    'NPU timing includes the required CPU auxiliary operators and provider startup/cache effects.',
  ],
}

for (const backend of backends) {
  const measurement = { backend, initMs: null, summary: null, npuVerified: false, device: null, initialResources: await inspectResources(), peakRssBytes: 0, minimumFreeRamGiB: null, minimumFreeVramGiB: null, records: [], errors: [] }
  const initStarted = performance.now()
  let analyzer
  try {
    analyzer = await createPhotoAnalyzer(root, backend)
    measurement.initMs = Number((performance.now() - initStarted).toFixed(2))
    measurement.device = analyzer.device
    const runOne = async (pass, file) => {
        const started = performance.now()
        try {
          const readStarted = performance.now()
          const bytes = await readFile(file)
          const readMs = Number((performance.now() - readStarted).toFixed(2))
          const result = await analyzer.analyze(bytes)
          const durationMs = Number((performance.now() - started).toFixed(2))
          const resources = await inspectResources()
          measurement.peakRssBytes = Math.max(measurement.peakRssBytes, process.memoryUsage().rss)
          measurement.minimumFreeRamGiB = measurement.minimumFreeRamGiB === null ? resources.freeRamGiB : Math.min(measurement.minimumFreeRamGiB, resources.freeRamGiB)
          if (Number.isFinite(resources.freeVramGiB)) measurement.minimumFreeVramGiB = measurement.minimumFreeVramGiB === null ? resources.freeVramGiB : Math.min(measurement.minimumFreeVramGiB, resources.freeVramGiB)
          measurement.records.push({ pass, name: path.basename(file), ok: true, category: result.category, durationMs, readMs, classificationMs: result.classificationMs, ...result.timings, device: result.device?.id ?? null, npuVerified: result.npuVerified === true, npuEvidence: result.npuEvidence, processRssBytes: process.memoryUsage().rss, resources })
          measurement.npuVerified ||= result.npuVerified === true
          if (result.device?.id !== backend && backend !== 'cpu') throw new Error('Selected device mismatch: ' + (result.device?.id ?? 'unknown'))
        } catch (error) {
          const durationMs = Number((performance.now() - started).toFixed(2))
          measurement.records.push({ pass, name: path.basename(file), ok: false, durationMs, error: error.message })
          measurement.errors.push({ pass, name: path.basename(file), error: error.message })
        }
    }
    for (let pass = 1; pass <= passes; pass++) {
      for (let index = 0; index < selected.length; index += concurrency) {
        await Promise.all(selected.slice(index, index + concurrency).map(file => runOne(pass, file)))
      }
    }
    measurement.summary = summarize(measurement.records)
    if (backend === 'npu' && !measurement.npuVerified) measurement.errors.push({ error: 'NPU photo inference did not produce verified VitisAI evidence' })
  } catch (error) {
    measurement.initMs = Number((performance.now() - initStarted).toFixed(2))
    measurement.errors.push({ phase: 'initialization', error: error.message })
    report.status = 'partial'
  } finally {
    if (analyzer) await analyzer.close()
  }
  if (measurement.errors.length) report.status = 'partial'
  report.measurements.push(measurement)
}

await mkdir(path.join(root, 'artifacts'), { recursive: true })
await writeFile(path.join(root, 'artifacts/folder-device-benchmark.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  status: report.status,
  sampleCount: report.sampleCount,
  passes: report.passes,
  measurements: report.measurements.map(item => ({ backend: item.backend, device: item.device?.name ?? null, initMs: item.initMs, summary: item.summary, npuVerified: item.npuVerified, errors: item.errors.length })),
}, null, 2))
if (report.status !== 'passed') process.exitCode = 1
