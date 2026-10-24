import { access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'

const execute = promisify(execFile)
const defaultUrl = () => String(process.env.LENSSORT_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')

async function isReachable(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1200)
  try { const response = await fetch(`${url}/api/tags`, { signal: controller.signal }); return response.ok }
  catch { return false }
  finally { clearTimeout(timer) }
}

async function resolveExecutable() {
  const candidates = [process.env.LENSSORT_OLLAMA_EXE, 'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Programs\\Ollama\\ollama.exe']
  for (const candidate of candidates) { if (!candidate) continue; try { await access(candidate); return candidate } catch {} }
  try { const result = await execute('where.exe', ['ollama.exe'], { windowsHide: true, timeout: 3000, maxBuffer: 8192 }); const located = String(result.stdout).split(/\r?\n/).map(value => value.trim()).find(Boolean); if (located) return located } catch {}
  return null
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.killed) return
  if (process.platform === 'win32') { try { await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000, maxBuffer: 8192 }) } catch {} }
  else child.kill('SIGTERM')
}

export async function ensureOllama() {
  const url = defaultUrl()
  if (await isReachable(url)) return { status: 'reused', url, executable: null, child: null, message: 'Ollama 已在运行，LensSort 复用现有服务。', async stop() {} }
  const executable = await resolveExecutable()
  if (!executable) return { status: 'unavailable', url, executable: null, child: null, message: '未找到 ollama.exe；快速分类仍可用，视觉大模型暂不可用。', async stop() {} }
  const host = new URL(url).host
  const child = spawn(executable, ['serve'], { cwd: process.env.USERPROFILE || process.cwd(), env: { ...process.env, OLLAMA_HOST: host }, windowsHide: true, stdio: 'ignore' })
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15000) { if (await isReachable(url)) return { status: 'started', url, executable, child, message: 'LensSort 已自动启动 Ollama。', async stop() { await stopProcess(child) } }; if (child.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 250)) }
  await stopProcess(child)
  return { status: 'failed', url, executable, child: null, message: 'Ollama 启动失败；快速分类仍可用，视觉大模型暂不可用。', async stop() {} }
}
