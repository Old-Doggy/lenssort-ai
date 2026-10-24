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

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitForState(stateFile, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let state
  while (Date.now() < deadline) {
    state = JSON.parse(await readFile(stateFile, 'utf8'))
    const records = Object.values(state.sources)
    if (records.length === expected && records.every(record => record.status === 'done')) return state
    if (records.some(record => record.status === 'failed')) return state
    await sleep(250)
  }
  throw new Error('Timed out waiting for ' + expected + ' classified files')
}

async function makeUniqueSample(bytes, index) {
  const image = sharp(bytes, { limitInputPixels: 80_000_000 }).rotate()
  return image.jpeg({ quality: 78 + (index % 5) * 4, mozjpeg: false }).toBuffer()
}

const sourceFolder = path.resolve(option('source', path.join(root, 'data/eval/similarity_cases')))
const requestedBackends = option('backends', 'cpu,npu').split(',').map(item => item.trim()).filter(Boolean)
const sourceLimit = Math.max(1, Number.parseInt(option('source-limit', '30'), 10) || 30)
const copies = Math.max(1, Number.parseInt(option('copies', '3'), 10) || 3)
const timeoutMs = Math.max(60_000, Number.parseInt(option('timeout-ms', '300000'), 10) || 300000)
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
  measurements: [],
  limitations: [
    'Samples are generated from local engineering fixtures and prove service stability, not photo classification accuracy.',
    'This check does not measure power consumption.',
    'NPU timing includes required CPU auxiliary operators and provider startup/cache effects.',
  ],
}

for (const backend of requestedBackends) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-stability-'))
  const input = path.join(workspace, 'input')
  const output = path.join(workspace, 'output')
  const stateDir = path.join(workspace, 'state')
  const measurement = { backend, workspace, expected: report.expectedPerBackend, expectedUniqueOutputs: null, classified: 0, failed: 0, uniqueOutputs: 0, analysisCalls: 0, restartAnalysisCalls: 0, restartStateCount: 0, durationMs: null, npuVerified: false, records: [], errors: [] }
  let analyzer
  let sorter
  try {
    analyzer = await createPhotoAnalyzer(root, backend)
    const startedAt = performance.now()
    sorter = await createFolderSorter({ input, output, stateDir, pollMs: 80, stableMs: 240, analyze: bytes => { measurement.analysisCalls++; return analyzer.analyze(bytes) } })
    sorter.start()
    let index = 0
    for (const source of sourceFiles) {
      const bytes = await readFile(source)
      for (let copy = 0; copy < copies; copy++) {
        const unique = await makeUniqueSample(bytes, index++)
        await writeFile(path.join(input, String(index).padStart(3, '0') + '-' + path.basename(source, path.extname(source)) + '-' + copy + '.jpg'), unique)
      }
    }
    const stateFile = path.join(stateDir, 'records.json')
    const state = await waitForState(stateFile, report.expectedPerBackend, timeoutMs)
    measurement.durationMs = Number((performance.now() - startedAt).toFixed(2))
    measurement.records = Object.values(state.sources)
    measurement.classified = measurement.records.filter(record => record.status === 'done').length
    measurement.failed = measurement.records.filter(record => record.status === 'failed').length
    measurement.npuVerified = measurement.records.some(record => record.result?.npuVerified === true)
    const outputFiles = await collectImages(output)
    const uniqueHashes = new Set(measurement.records.filter(record => record.status === 'done').map(record => record.hash))
    measurement.expectedUniqueOutputs = uniqueHashes.size
    measurement.uniqueOutputs = outputFiles.length
    if (measurement.classified !== report.expectedPerBackend) measurement.errors.push('Not all files were classified')
    if (measurement.failed) measurement.errors.push(measurement.failed + ' files failed')
    if (outputFiles.length !== measurement.expectedUniqueOutputs) measurement.errors.push('Unique output file count mismatch: ' + outputFiles.length + ' expected ' + measurement.expectedUniqueOutputs)
    for (const record of measurement.records) {
      if (record.status !== 'done') continue
      const sourceBytes = await readFile(record.output.replace(/\\/g, path.sep))
      if (sha256(sourceBytes) !== record.hash) measurement.errors.push('Output hash mismatch: ' + record.output)
    }
    if (backend === 'npu' && !measurement.npuVerified) measurement.errors.push('NPU records lack verified VitisAI evidence')
    await sorter.close()
    sorter = null
    await analyzer.close()
    analyzer = null
    const persisted = JSON.parse(await readFile(stateFile, 'utf8'))
    if (Object.keys(persisted.sources).length !== report.expectedPerBackend) measurement.errors.push('Persisted state count mismatch after close')
    const callsBeforeRestart = measurement.analysisCalls
    analyzer = await createPhotoAnalyzer(root, backend)
    sorter = await createFolderSorter({ input, output, stateDir, pollMs: 80, stableMs: 240, analyze: bytes => { measurement.analysisCalls++; return analyzer.analyze(bytes) } })
    sorter.start()
    await sleep(1000)
    const restarted = JSON.parse(await readFile(stateFile, 'utf8'))
    measurement.restartAnalysisCalls = measurement.analysisCalls - callsBeforeRestart
    measurement.restartStateCount = Object.keys(restarted.sources).length
    if (measurement.restartStateCount !== report.expectedPerBackend) measurement.errors.push('Restart state count mismatch')
    if (measurement.restartAnalysisCalls !== 0) measurement.errors.push('Restart reprocessed completed files: ' + measurement.restartAnalysisCalls)
    await sorter.close()
    sorter = null
    await analyzer.close()
    analyzer = null
  } catch (error) {
    measurement.errors.push(error.message)
  } finally {
    if (sorter) await sorter.close()
    if (analyzer) await analyzer.close()
  }
  if (measurement.errors.length) report.status = 'partial'
  report.measurements.push(measurement)
}

await writeFile(path.join(root, 'artifacts/folder-stability-verification.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  status: report.status,
  expectedPerBackend: report.expectedPerBackend,
  measurements: report.measurements.map(item => ({ backend: item.backend, classified: item.classified, failed: item.failed, uniqueOutputs: item.uniqueOutputs, analysisCalls: item.analysisCalls, restartAnalysisCalls: item.restartAnalysisCalls, restartStateCount: item.restartStateCount, durationMs: item.durationMs, photosPerSecond: item.durationMs ? Number((item.classified * 1000 / item.durationMs).toFixed(3)) : null, npuVerified: item.npuVerified, errors: item.errors })),
}, null, 2))
if (report.status !== 'passed') process.exitCode = 1
