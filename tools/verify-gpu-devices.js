import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as ort from 'onnxruntime-node'

const adapters = JSON.parse(execFileSync('python', ['tools/dxgi-adapters.py'], { encoding: 'utf8' }))
const targets = [adapters.find(adapter => adapter.vendorId === 0x1002 && !adapter.software), adapters.find(adapter => adapter.vendorId === 0x10de && !adapter.software)]
assert.ok(targets.every(Boolean), 'AMD and NVIDIA GPUs required')
const profiles = 'artifacts/gpu-profiles'
await mkdir(profiles, { recursive: true })
const results = []
for (const adapter of targets) {
  const prefix = path.resolve(profiles, 'device-' + adapter.deviceId + '-' + Date.now())
  const session = await ort.InferenceSession.create('public/models/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k/onnx/model.onnx', {
    executionProviders: [{ name: 'dml', deviceId: adapter.deviceId }], executionMode: 'sequential', enableMemPattern: false, enableProfiling: true, profileFilePrefix: prefix,
    extra: { session: { disable_cpu_ep_fallback: '1' } },
  })
  const durations = []
  try {
    const input = new ort.Tensor('float32', new Float32Array(3 * 224 * 224).fill(0.1), [1, 3, 224, 224])
    for (let run = 0; run < 6; run++) {
      const started = performance.now()
      const result = await session.run({ [session.inputNames[0]]: input })
      assert.equal(result[session.outputNames[0]].data.length, 1000)
      assert.ok(result[session.outputNames[0]].data.every(Number.isFinite))
      durations.push(performance.now() - started)
    }
    session.endProfiling()
  } finally { await session.release() }
  const file = (await readdir(profiles)).find(name => path.join(path.resolve(profiles), name).startsWith(prefix))
  assert.ok(file, 'profiling evidence required')
  const events = JSON.parse(await readFile(path.join(profiles, file), 'utf8'))
  const executionProviders = [...new Set(events.map(event => event.args?.provider).filter(Boolean))]
  assert.ok(executionProviders.includes('DmlExecutionProvider'), 'DML nodes required')
  assert.ok(!executionProviders.includes('CPUExecutionProvider'), 'No CPU fallback allowed')
  const warm = durations.slice(1).sort((left, right) => left - right)
  results.push({ adapter, executionProviders, coldMs: durations[0], warmMedianMs: warm[2], profile: path.join(profiles, file), syntheticInput: true })
}
const report = { status: 'passed', checkedAt: new Date().toISOString(), adapters, results, npuVerified: false, notes: 'actual GPU-only MobileNet inference with DXGI device selection and per-node profile; synthetic input is not photo accuracy' }
await writeFile('artifacts/gpu-device-verification.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
