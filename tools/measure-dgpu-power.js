import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'

const execute = promisify(execFile)
const root = process.cwd()
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const report = {
  status: 'partial',
  createdAt: new Date().toISOString(),
  source: 'nvidia-smi power.draw, reported NVIDIA device power only',
  scope: 'device-local observation, not whole-machine power or comparable CPU/iGPU/NPU energy',
  phases: [],
  limits: [
    'CPU, integrated GPU and NPU lack an accessible comparable calibrated power source on this machine.',
    'NVIDIA-reported watts do not include CPU face detection, decoding, disk I/O, display or the entire PC.',
    'External desktop activity can affect readings; observations are not isolated lab measurements.',
    'No power savings claim or energy-per-photo comparison across accelerators is supported.',
  ],
}

async function readPower() {
  const { stdout } = await execute('nvidia-smi.exe', [
    '--query-gpu=uuid,name,power.draw,utilization.gpu,temperature.gpu',
    '--format=csv,noheader,nounits',
  ], { timeout: 10000, windowsHide: true })
  return stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [uuid, name, power, utilization, temperature] = line.split(',').map(value => value.trim())
    const number = value => value && Number.isFinite(Number(value)) ? Number(value) : null
    return { timestamp: new Date().toISOString(), uuid, name, watts: number(power), utilizationPercent: number(utilization), temperatureCelsius: number(temperature) }
  })
}

async function observe(label, durationMs, work) {
  const phase = { label, durationMs: 0, analyzed: 0, actualDevice: null, samples: [], errors: [] }
  const started = performance.now()
  let running = true
  const sampler = (async () => {
    while (running) {
      try { phase.samples.push(...await readPower()) }
      catch (error) { phase.errors.push(error.message) }
      if (running) await sleep(1000)
    }
  })()
  try {
    while (performance.now() - started < durationMs) {
      if (work) {
        const result = await work()
        phase.actualDevice = result.device
        if (result.device?.id !== 'dgpu') throw new Error('Power observation used unexpected inference device')
        phase.analyzed++
      } else await sleep(250)
    }
  } finally {
    running = false
    await sampler
    phase.durationMs = Number((performance.now() - started).toFixed(2))
    const valid = phase.samples.filter(sample => Number.isFinite(sample.watts))
    phase.validPowerSamples = valid.length
    phase.reportedMeanWatts = valid.length ? Number((valid.reduce((sum, sample) => sum + sample.watts, 0) / valid.length).toFixed(2)) : null
    phase.reportedMinWatts = valid.length ? Math.min(...valid.map(sample => sample.watts)) : null
    phase.reportedMaxWatts = valid.length ? Math.max(...valid.map(sample => sample.watts)) : null
    report.phases.push(phase)
  }
}

let analyzer
try {
  report.detected = await readPower()
  if (report.detected.length !== 1 || report.detected[0].watts === null) throw new Error('Requires one NVIDIA GPU with readable watts; cannot attribute a multi-GPU query safely')
  await observe('idle-local-desktop', 15000)
  analyzer = await createPhotoAnalyzer(root, 'dgpu')
  const bytes = await readFile(path.join(root, 'data/eval/photos/portrait.jpg'))
  await analyzer.analyze(bytes)
  await observe('dgpu-photo-pipeline', 30000, () => analyzer.analyze(bytes))
  report.deviceObservationPassed = report.phases.every(phase => phase.errors.length === 0 && phase.validPowerSamples >= 5)
  if (!report.deviceObservationPassed) throw new Error('Device power observations incomplete')
  report.message = 'Device-local measurements captured; comparative whole-machine power remains unverified.'
} catch (error) {
  report.deviceObservationPassed = false
  report.error = error.message
  process.exitCode = 1
} finally {
  if (analyzer) await analyzer.close()
  await writeFile(path.join(root, 'artifacts/dgpu-power-observation.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ status: report.status, deviceObservationPassed: report.deviceObservationPassed, phases: report.phases.map(({ samples: _samples, ...phase }) => phase), error: report.error, scope: report.scope }, null, 2))
