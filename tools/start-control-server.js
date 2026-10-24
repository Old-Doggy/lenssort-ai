import process from 'node:process'
import { spawn } from 'node:child_process'
import { createControlServer } from './control-server.js'
import { ensureOllama } from './ollama-lifecycle.js'
import { projectRoot } from './runtime-paths.js'

const ollama = await ensureOllama()
let server
try {
  server = await createControlServer({ root: projectRoot, controlDir: process.env.LENSSORT_CONTROL_DIR || undefined, port: Number(process.env.LENSSORT_PORT ?? 4317) })
} catch (error) {
  await ollama.stop()
  throw error
}
console.log(JSON.stringify({ type: 'started', origin: server.origin, control: 'open the origin in the browser', token: 'returned by GET /api/status', ollama: { status: ollama.status, message: ollama.message } }))
if (process.argv.includes('--open')) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const browser = spawn(command, [server.origin], { windowsHide: true, stdio: 'ignore' })
  browser.on('error', error => console.error('Open ' + server.origin + ' manually: ' + error.message))
  browser.unref()
}
let shuttingDown = false
const shutdown = async signal => { if (shuttingDown) return; shuttingDown = true; await server.close(); await ollama.stop(); console.log(JSON.stringify({ type: 'stopped', signal, ollama: ollama.status === 'started' ? 'stopped' : 'left-unchanged' })); process.exit(0) }
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGBREAK', () => void shutdown('SIGBREAK'))
await new Promise(() => {})
