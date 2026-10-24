import path from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { access } from 'node:fs/promises'

export async function createNpuSession(root) {
  const python = path.join(root, '.venv-winml/Scripts/python.exe')
  try { await access(python) } catch { throw new Error('NPU requires project .venv-winml and WinML dependencies; run the documented setup') }
  const child = spawn(python, ['-u', path.join(root, 'tools/npu-session.py')], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let stderr = ''
  let sequence = 0
  let readyResolve
  let readyReject
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const startupTimer = setTimeout(() => { readyReject(new Error('NPU initialization timeout (180 seconds)')); child.kill() }, 180000)
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-12000) })
  const completed = new Promise(resolve => child.once('exit', (code, signal) => {
    clearTimeout(startupTimer)
    const error = new Error('NPU process exited ' + code + '/' + signal + ': ' + stderr.slice(-1500))
    readyReject(error)
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
    pending.clear()
    resolve({ code, signal })
  }))
  child.once('error', error => { clearTimeout(startupTimer); readyReject(error) })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message.type === 'ready') { clearTimeout(startupTimer); readyResolve(message); return }
    if (message.type === 'error') { clearTimeout(startupTimer); readyReject(new Error(message.error)); return }
    const item = pending.get(message.id)
    if (!item) return
    clearTimeout(item.timer); pending.delete(message.id)
    if (message.error) item.reject(new Error(message.error)); else item.resolve(message)
  })
  try { await ready } catch (error) { child.kill(); throw error }
  let closing
  return {
    async run(tensor) {
      if (child.exitCode !== null || closing) throw new Error('NPU process is not running')
      const id = sequence++
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('NPU inference timeout (60 seconds)')); child.kill() }, 60000)
        pending.set(id, { resolve, reject, timer })
      })
      const bytes = Buffer.from(tensor.buffer, tensor.byteOffset, tensor.byteLength)
      child.stdin.write(JSON.stringify({ id, tensor: bytes.toString('base64') }) + '\n')
      return result
    },
    close() {
      closing ??= (async () => {
        if (child.exitCode === null) child.stdin.end(JSON.stringify({ type: 'close' }) + '\n')
        const timer = setTimeout(() => child.kill(), 10000)
        try { await completed } finally { clearTimeout(timer); lines.close() }
      })()
      return closing
    },
  }
}
