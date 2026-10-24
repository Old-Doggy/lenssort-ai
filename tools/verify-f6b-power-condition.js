import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

const execute = promisify(execFile)
const root = process.cwd()
const evidencePath = path.join(root, 'artifacts', 'f6b-power-condition.json')
const evidence = {
  status: 'external-blocked',
  createdAt: new Date().toISOString(),
  step: 'F6b.1',
  objective: 'Confirm whether four accelerators can be measured with one comparable whole-system power or energy source.',
  checks: [],
  sources: [],
  limits: [],
  nextStep: 'F6b.2: close the power section with an explicit external-blocked conclusion.'
}

try {
  const { stdout } = await execute('nvidia-smi.exe', ['--query-gpu=name,power.draw', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 10000 })
  evidence.sources.push({ name: 'nvidia-smi', available: true, output: stdout.trim() })
  evidence.checks.push({ name: 'NVIDIA device-local power', result: 'available', scope: 'device-only' })
} catch (error) {
  evidence.sources.push({ name: 'nvidia-smi', available: false, error: error.message })
  evidence.checks.push({ name: 'NVIDIA device-local power', result: 'unavailable' })
}

try {
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', "$b = Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction Stop; $b | Select-Object PowerOnline,Charging,Discharging,RemainingCapacity,Voltage,Current,ChargeRate,DischargeRate | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 10000 })
  const battery = JSON.parse(stdout.trim())
  evidence.sources.push({ name: 'Windows BatteryStatus', available: true, data: battery })
  const items = Array.isArray(battery) ? battery : [battery]
  const hasEnergyRate = items.some(item => Number.isFinite(item.Current) || (Number.isFinite(item.ChargeRate) && item.ChargeRate > 0) || (Number.isFinite(item.DischargeRate) && item.DischargeRate > 0))
  evidence.checks.push({ name: 'battery energy rate', result: hasEnergyRate ? 'available' : 'unavailable', reason: hasEnergyRate ? null : 'Current/ChargeRate/DischargeRate are not exposed as a non-zero active energy rate by this device' })
} catch (error) {
  evidence.sources.push({ name: 'Windows BatteryStatus', available: false, error: error.message })
  evidence.checks.push({ name: 'battery energy rate', result: 'unavailable' })
}

const unavailableMeterNames = ['HWiNFO64', 'LibreHardwareMonitor', 'OpenHardwareMonitor']
const installedTools = []
for (const name of unavailableMeterNames) {
  try {
    const { stdout } = await execute('where.exe', [name + '.exe'], { windowsHide: true, timeout: 5000 })
    installedTools.push({ name, available: true, path: stdout.trim() })
  } catch {
    installedTools.push({ name, available: false })
  }
}
evidence.sources.push({ name: 'local hardware monitor tools', available: installedTools.some(item => item.available), tools: installedTools })

evidence.limits = [
  'nvidia-smi reports only NVIDIA device-local power, not whole-machine power.',
  'Windows BatteryStatus exposes no usable current or charge/discharge rate in this session.',
  'No external calibrated power meter or unified energy source is available to compare CPU, iGPU, dGPU and NPU.',
  'No CPU/iGPU/NPU whole-system energy ranking or power-saving claim is permitted.'
]
await writeFile(evidencePath, JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
