import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'

const execute = promisify(execFile)

async function listDxgiAdapters(root) {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await execute('python', [path.join(root, 'tools/dxgi-adapters.py')], { windowsHide: true, timeout: 15000 })
    const adapters = JSON.parse(stdout)
    return Array.isArray(adapters) ? adapters : []
  } catch {
    return []
  }
}

async function npuReady(root) {
  if (process.platform !== 'win32') return false
  const python = path.join(root, '.venv-winml/Scripts/python.exe')
  try { await access(python) } catch { return false }
  try {
    const { stdout } = await execute(python, [path.join(root, 'tools/winml-discover.py')], { windowsHide: true, timeout: 30000 })
    const providers = JSON.parse(stdout)
    return providers.some(provider => provider.name === 'VitisAIExecutionProvider' && (String(provider.state) === '1' || /ready/i.test(String(provider.state))))
  } catch {
    return false
  }
}

const looksIntegrated = adapter => {
  const name = adapter.name.toLowerCase()
  return adapter.dedicatedBytes < 2 * 1024 ** 3 || /integrated|uhd|iris|radeon\(tm\).*graphics|vega/i.test(name)
}

const uniqueAdapters = adapters => {
  const seen = new Set()
  return adapters.filter(adapter => {
    const key = [adapter.vendorId, adapter.name, adapter.dedicatedBytes].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function listInferenceDevices(root) {
  const adapters = uniqueAdapters((await listDxgiAdapters(root)).filter(adapter => !adapter.software))
  const devices = [{ id: 'auto', name: '自动选择（推荐）', provider: 'auto' }, { id: 'cpu', name: 'CPU', provider: 'cpu' }]
  const integrated = adapters.find(looksIntegrated)
  const discrete = adapters.find(adapter => adapter !== integrated && !looksIntegrated(adapter))
  const primary = new Map()
  if (integrated) primary.set(integrated.deviceId, 'igpu')
  if (discrete) primary.set(discrete.deviceId, 'dgpu')
  if (!integrated && !discrete && adapters[0]) primary.set(adapters[0].deviceId, 'gpu-' + adapters[0].deviceId)
  for (const adapter of adapters) {
    const id = primary.get(adapter.deviceId) ?? 'gpu-' + adapter.deviceId
    const label = id === 'igpu' ? '核显 · ' : id === 'dgpu' ? '独显 · ' : 'GPU · '
    devices.push({ ...adapter, id, name: label + adapter.name, provider: 'dml', deviceId: adapter.deviceId })
  }
  if (await npuReady(root)) devices.push({ id: 'npu', name: 'NPU · AMD WinML', provider: 'vitisai', requiresProbe: true })
  return devices
}

export async function resolveInferenceDevice(root, backend) {
  const devices = await listInferenceDevices(root)
  if (backend === 'auto') return devices.find(device => device.id === 'igpu') ?? devices.find(device => device.id === 'dgpu') ?? devices.find(device => device.provider === 'dml') ?? devices.find(device => device.id === 'cpu')
  if (backend === 'dml') { const device = devices.find(item => item.provider === 'dml'); if (!device) throw new Error('本机未确认可用DirectML设备；可选择CPU或检查Python与显卡驱动'); return device }
  const device = devices.find(item => item.id === backend)
  if (!device) throw new Error('Requested device unavailable: ' + backend)
  return device
}
