import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import sharp from 'sharp'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'
import { createFolderSorter } from './folder-sorter.js'

const root = process.cwd()
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif'])

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

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function makeUniqueSample(bytes, index) {
  const encoded = await sharp(bytes, { limitInputPixels: 80_000_000 })
    .rotate()
    .modulate({ brightness: 0.94 + (index % 13) * 0.01 })
    .jpeg({ quality: 80 + (index % 12) })
    .toBuffer()
  return Buffer.concat([encoded, Buffer.from('LENS_SORT_STABILITY_' + String(index).padStart(5, '0'))])
}

async function waitForState(stateFile, expected, timeoutMs, peakMemory) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    const records = Object.values(state.sources)
    peakMemory.value = Math.max(peakMemory.value, process.memoryUsage().rss)
    if (records.length === expected && records.every(record => ['done', 'failed'].includes(record.status))) return state
    await sleep(500)
  }
  throw new Error('Timed out waiting for ' + expected + ' classified files')
}

const sourceFolder = path.resolve(option('source', path.join(root, 'data/eval/similarity_cases')))
const requestedBackends = option('backends', 'cpu,npu').split(',').map(item => item.trim()).filter(Boolean)
const sourceLimit = Math.max(1, Number.parseInt(option('source-limit', '20'), 10) || 20)
const copies = Math.max(1, Number.parseInt(option('copies', '50'), 10) || 50)
const timeoutMs = Math.max(60_000, Number.parseInt(option('timeout-ms', '900000'), 10) || 900000)
const sustainedMs = Number(option('sustained-ms', '300000'))
if (!Number.isInteger(sustainedMs) || sustainedMs < 0 || sustainedMs > 600000) throw new Error('sustained-ms must be between 0 and 600000')
const reportFile = path.resolve(option('report', path.join(root, 'artifacts/folder-long-batch-verification.json')))
const sourceFiles = (await collectImages(sourceFolder)).slice(0, sourceLimit)
if (!sourceFiles.length) throw new Error('No source images found: ' + sourceFolder)

const report = {
  status: 'passed',
  createdAt: new Date().toISOString(),
  sourceFolder,
  sourceCount: sourceFiles.length,
  copies,
  expectedPerBackend: sourceFiles.length * copies,
  timeoutMs,
  sustainedMs,
  measurements: [],
  limitations: [
    'Samples are local engineering fixtures transformed into valid unique JPEG byte streams; this proves pipeline stability, not photo classification accuracy.',
    'Power consumption is not included because CPU, iGPU, dGPU and NPU do not expose one comparable calibrated source on this machine.',
    'NPU timing includes required CPU auxiliary operators and provider startup/cache effects.',
    'The RSS metric covers only the Node process, not the Edge and Python/WinML child processes; it is not total pipeline memory.',
  ],
}

for (const backend of requestedBackends) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-long-batch-'))
  const input = path.join(workspace, 'input')
  const output = path.join(workspace, 'output')
  const stateDir = path.join(workspace, 'state')
  const measurement = {
    backend,
    workspace,
    expected: report.expectedPerBackend,
    classified: 0,
    failed: 0,
    uniqueOutputs: 0,
    analysisCalls: 0,
    restartAnalysisCalls: 0,
    restartStateCount: 0,
    durationMs: null,
    photosPerSecond: null,
    peakRssMiB: null,
    sustainedInferenceCalls: 0,
    sustainedDurationMs: 0,
    npuProfileVerified: false,
    npuVerified: false,
    errors: [],
  }
  let analyzer
  let sorter
  let memoryTimer
  const peakMemory = { value: process.memoryUsage().rss }
  try {
    analyzer = await createPhotoAnalyzer(root, backend)
    peakMemory.value = Math.max(peakMemory.value, process.memoryUsage().rss)
    memoryTimer = setInterval(() => { peakMemory.value = Math.max(peakMemory.value, process.memoryUsage().rss) }, 250)
    const startedAt = performance.now()
    sorter = await createFolderSorter({
      input,
      output,
      stateDir,
      pollMs: 80,
      stableMs: 240,
      analyze: bytes => { measurement.analysisCalls++; return analyzer.analyze(bytes) },
    })
    sorter.start()
    let index = 0
    for (const source of sourceFiles) {
      const bytes = await readFile(source)
      for (let copy = 0; copy < copies; copy++) {
        const unique = await makeUniqueSample(bytes, index)
        index++
        await writeFile(path.join(input, String(index).padStart(4, '0') + '-' + path.basename(source, path.extname(source)) + '-' + copy + '.jpg'), unique)
      }
    }
    const stateFile = path.join(stateDir, 'records.json')
    const state = await waitForState(stateFile, report.expectedPerBackend, timeoutMs, peakMemory)
    measurement.durationMs = Number((performance.now() - startedAt).toFixed(2))
    measurement.classified = Object.values(state.sources).filter(record => record.status === 'done').length
    measurement.photosPerSecond = Number((measurement.classified * 1000 / measurement.durationMs).toFixed(3))
    measurement.failed = Object.values(state.sources).filter(record => record.status === 'failed').length
    measurement.npuVerified = Object.values(state.sources).some(record => record.result?.npuVerified === true)
    const outputFiles = await collectImages(output)
    measurement.uniqueOutputs = outputFiles.length
    const hashes = new Set()
    for (const [source, record] of Object.entries(state.sources)) {
      if (record.status !== 'done') continue
      hashes.add(record.hash)
      const outputBytes = await readFile(record.output)
      if (digest(outputBytes) !== record.hash) measurement.errors.push('Output hash mismatch: ' + record.output)
      if (digest(await readFile(source)) !== record.hash) measurement.errors.push('Original hash mismatch: ' + source)
      if (record.result?.device?.id !== backend) measurement.errors.push('Unexpected inference device: ' + source)
      if (backend === 'npu' && record.result?.npuVerified !== true) measurement.errors.push('Unverified NPU photo: ' + source)
    }
    if (measurement.classified !== measurement.expected) measurement.errors.push('Not all files were classified')
    if (measurement.failed) measurement.errors.push(measurement.failed + ' files failed')
    if (measurement.uniqueOutputs !== hashes.size) measurement.errors.push('Unique output mismatch: ' + measurement.uniqueOutputs + ' expected ' + hashes.size)
    if (hashes.size !== measurement.expected || measurement.analysisCalls !== measurement.expected) measurement.errors.push('Generated samples were deduplicated; expected an inference call for every file')
    if (backend === 'npu' && !measurement.npuVerified) measurement.errors.push('NPU records lack verified VitisAI evidence')
    if (backend === 'npu') {
      const verified = Object.values(state.sources).find(record => record.result?.npuVerified === true)
      if (verified) {
        const profile = JSON.parse(await readFile(verified.result.npuEvidence.profile, 'utf8'))
        measurement.npuProfileVerified = profile.some(event => event.args?.provider === 'VitisAIExecutionProvider')
      }
      if (!measurement.npuProfileVerified) measurement.errors.push('No actual VitisAI kernel in NPU profile')
    }
    if (measurement.errors.length) throw new Error('Batch validation failed; sustained inference skipped')
    console.log(backend + ': batch processed; starting ' + sustainedMs + ' ms sustained inference check')
    const sustainedStarted = performance.now()
    const sustainedSamples = await Promise.all(sourceFiles.map(file => readFile(file)))
    while (performance.now() - sustainedStarted < sustainedMs) {
      const result = await analyzer.analyze(sustainedSamples[measurement.sustainedInferenceCalls % sustainedSamples.length])
      if (result.device?.id !== backend || (backend === 'npu' && result.npuVerified !== true)) throw new Error('Sustained inference device/evidence mismatch')
      measurement.sustainedInferenceCalls++
    }
    measurement.sustainedDurationMs = Number((performance.now() - sustainedStarted).toFixed(2))
    await sorter.close(); sorter = null
    await analyzer.close(); analyzer = null
    const callsBeforeRestart = measurement.analysisCalls
    analyzer = await createPhotoAnalyzer(root, backend)
    sorter = await createFolderSorter({ input, output, stateDir, pollMs: 80, stableMs: 240, analyze: bytes => { measurement.analysisCalls++; return analyzer.analyze(bytes) } })
    sorter.start()
    await sleep(2000)
    const restarted = JSON.parse(await readFile(stateFile, 'utf8'))
    measurement.restartAnalysisCalls = measurement.analysisCalls - callsBeforeRestart
    measurement.restartStateCount = Object.keys(restarted.sources).length
    if (measurement.restartStateCount !== measurement.expected) measurement.errors.push('Restart state count mismatch')
    if (measurement.restartAnalysisCalls !== 0) measurement.errors.push('Restart reprocessed completed files: ' + measurement.restartAnalysisCalls)
  } catch (error) {
    measurement.errors.push(error.message)
  } finally {
    if (memoryTimer) clearInterval(memoryTimer)
    measurement.peakRssMiB = Number((Math.max(peakMemory.value, process.memoryUsage().rss) / 1024 / 1024).toFixed(2))
    if (sorter) await sorter.close()
    if (analyzer) await analyzer.close()
  }
  measurement.peakRssMiB = Number((measurement.peakRssMiB ?? 0).toFixed(2))
  if (measurement.errors.length) report.status = 'partial'
  report.measurements.push(measurement)
}

await writeFile(reportFile, JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  status: report.status,
  expectedPerBackend: report.expectedPerBackend,
  measurements: report.measurements,
}, null, 2))
if (report.status !== 'passed') process.exitCode = 1
