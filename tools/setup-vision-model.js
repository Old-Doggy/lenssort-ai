import { access, rm, writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { ensureOllama } from './ollama-lifecycle.js'

const execute = promisify(execFile)
export const supportedVisionModels = Object.freeze({
  'qwen3.5:4b': { label: 'Qwen 3.5 4B', disk: '约 3–5 GB', recommendation: '默认推荐，兼顾速度、内存和中文图像描述' },
  'gemma3:4b': { label: 'Gemma 3 4B', disk: '约 3–5 GB', recommendation: '兼容性基线，适合希望使用 Gemma 的电脑' },
  'qwen3.5:9b': { label: 'Qwen 3.5 9B', disk: '约 6–10 GB', recommendation: '精度优先，建议 32 GB 内存和 9 GB 以上空闲显存' },
})

const officialInstallerUrl = 'https://ollama.com/download/OllamaSetup.exe'
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export function parseVisionModel(value = 'qwen3.5:4b') {
  const model = String(value).trim().toLowerCase()
  if (!Object.hasOwn(supportedVisionModels, model)) throw new Error(`不支持的视觉模型：${model}；可选 ${Object.keys(supportedVisionModels).join('、')}`)
  return model
}

export function parseInstallerArgs(argv = process.argv.slice(2)) {
  const modelArg = argv.find(value => value.startsWith('--model='))
  return { model: parseVisionModel(modelArg?.slice('--model='.length) || 'qwen3.5:4b'), installOllama: argv.includes('--install-ollama'), keepService: argv.includes('--keep-service') }
}

async function findExecutable() {
  const candidates = [process.env.LENSSORT_OLLAMA_EXE, process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe') : null, process.platform === 'win32' ? path.join(process.env.PROGRAMFILES || '', 'Ollama', 'ollama.exe') : null]
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch {}
  }
  try {
    const command = process.platform === 'win32' ? 'where.exe' : 'which'
    const result = await execute(command, ['ollama' + (process.platform === 'win32' ? '.exe' : '')], { windowsHide: true, timeout: 3000, maxBuffer: 8192 })
    return String(result.stdout).split(/\r?\n/).map(value => value.trim()).find(Boolean) || null
  } catch { return null }
}

async function downloadOfficialInstaller() {
  if (process.platform !== 'win32') throw new Error('自动安装 Ollama 目前仅支持 Windows；请从 https://ollama.com/download 手动安装')
  const file = path.join(os.tmpdir(), `LensSort-OllamaSetup-${Date.now()}.exe`)
  const response = await fetch(officialInstallerUrl, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`无法下载官方 Ollama 安装程序（HTTP ${response.status}）`)
  await writeFile(file, Buffer.from(await response.arrayBuffer()))
  try {
    console.log('已下载官方 Ollama 安装程序，正在打开安装向导；请按向导完成安装。')
    const child = spawn(file, [], { windowsHide: false, stdio: 'inherit' })
    await once(child, 'exit')
  } finally { await rm(file, { force: true }).catch(() => {}) }
}

async function findExecutableAfterInstall() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const executable = await findExecutable()
    if (executable) return executable
    await wait(1000)
  }
  return null
}

async function installedModels() {
  try {
    const base = String(process.env.LENSSORT_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return []
    const body = await response.json()
    return (body.models || []).map(item => item.name || item.model).filter(Boolean)
  } catch { return [] }
}

async function pullModel(executable, model) {
  console.log(`正在从 Ollama 官方模型仓库准备 ${model}，预计占用 ${supportedVisionModels[model].disk}；照片不会上传。`)
  const child = spawn(executable, ['pull', model], { windowsHide: false, stdio: 'inherit', env: process.env })
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(`模型下载失败，退出码 ${code ?? 'unknown'}；可重新运行本脚本继续`)
}

export async function prepareVisionModel({ model = 'qwen3.5:4b', installOllama = false, keepService = false } = {}) {
  const selected = parseVisionModel(model)
  let executable = await findExecutable()
  if (!executable && !installOllama) throw new Error('未找到 Ollama；请使用“安装本地视觉模型.cmd”，或先从 https://ollama.com/download 安装 Ollama')
  if (!executable) {
    await downloadOfficialInstaller()
    executable = await findExecutableAfterInstall()
  }
  if (!executable) throw new Error('Ollama 安装后仍未找到 ollama.exe；请重启终端或确认安装完成')
  const previousExecutable = process.env.LENSSORT_OLLAMA_EXE
  if (!previousExecutable) process.env.LENSSORT_OLLAMA_EXE = executable
  let lifecycle
  try {
    lifecycle = await ensureOllama()
    if (lifecycle.status !== 'started' && lifecycle.status !== 'reused') throw new Error(lifecycle.message)
    const before = await installedModels()
    if (!before.includes(selected)) await pullModel(executable, selected)
    const after = await installedModels()
    if (!after.includes(selected)) throw new Error(`下载结束但未检测到 ${selected}；请运行 npm run doctor 检查 Ollama`)
    return { model: selected, installed: true, service: lifecycle.status, executable }
  } finally {
    if (lifecycle && !keepService) await lifecycle.stop()
    if (!previousExecutable) delete process.env.LENSSORT_OLLAMA_EXE
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseInstallerArgs(argv)
  const profile = supportedVisionModels[options.model]
  console.log(`LensSort AI 本地视觉模型准备器\n模型：${profile.label}（${options.model}）\n用途：${profile.recommendation}\n`)
  const result = await prepareVisionModel(options)
  console.log(`准备完成：${result.model} 已安装。现在运行“启动网页控制.cmd”即可在网页中选择它。`)
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main() } catch (error) { console.error(`\n准备失败：${error.message}`); process.exitCode = 1 }
}
