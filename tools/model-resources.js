import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { modelProfiles, chooseSafeModel, summarizeResources } from './model-resource-policy.js'

const execute = promisify(execFile)
export const ollamaBaseUrl = () => String(process.env.LENSSORT_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')

export async function ollamaRequest(route, init = {}, timeout = 45000) {
  const response = await fetch(ollamaBaseUrl() + route, { ...init, signal: AbortSignal.timeout(timeout) })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || `Ollama 请求失败（${response.status}）`)
  return body
}

export async function inspectResources() {
  const resources = summarizeResources({ totalRamBytes: os.totalmem(), freeRamBytes: os.freemem() })
  try {
    const { stdout } = await execute('nvidia-smi', ['--query-gpu=index,name,memory.total,memory.free', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 2500 })
    const adapters = stdout.trim().split(/\r?\n/).map(line => {
      const [index, name, total, free] = line.split(',').map(value => value.trim())
      return { index, name, total: Number(total), free: Number(free) }
    }).filter(adapter => Number.isFinite(adapter.total) && Number.isFinite(adapter.free))
    if (adapters.length === 1) {
      resources.totalVramGiB = adapters[0].total / 1024
      resources.freeVramGiB = adapters[0].free / 1024
      resources.gpuName = adapters[0].name
    }
    resources.gpuProbe = adapters.length === 1 ? 'verified' : 'unknown'
  } catch { resources.gpuProbe = 'unknown' }
  return resources
}

export async function inspectModelOptions(requested = 'auto') {
  const resources = await inspectResources()
  let installed = []
  let installedDetails = []
  let resident = []
  let serviceMessage = 'Ollama 未连接；可使用基础分析。'
  try {
    const [tags, running] = await Promise.all([ollamaRequest('/api/tags', {}, 3000), ollamaRequest('/api/ps', {}, 3000)])
    installedDetails = tags.models ?? []
    installed = installedDetails.map(item => item.name || item.model)
    resident = running.models ?? []
    serviceMessage = '本地模型可用，不自动下载；完成后释放本批加载的模型。'
  } catch {}
  const recommendation = chooseSafeModel({ requested, installed, installedDetails, resident, resources })
  return { resources, recommendation, serviceMessage, options: modelProfiles(installedDetails).map(profile => ({ ...profile, installed: profile.id === 'off' || installed.includes(profile.id) })) }
}
