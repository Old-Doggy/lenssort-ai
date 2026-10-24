import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { ensureOllama } from './ollama-lifecycle.js'

const root = process.cwd()
const reportPath = path.join(root, 'artifacts', 'ollama-lifecycle-verification.json')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const reachable = async port => fetch(`http://127.0.0.1:${port}/api/status`).then(response => response.ok).catch(() => false)

async function runServer(port, stateDir) {
  const child = spawn(process.execPath, ['tools/start-control-server.js'], { cwd: root, env: { ...process.env, LENSSORT_PORT: String(port), LENSSORT_CONTROL_DIR: stateDir }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  for (let index = 0; index < 60 && !(await reachable(port)); index++) await sleep(250)
  return { child, output: () => output }
}

const report = { createdAt: new Date().toISOString(), scenarios: [] }
const first = await ensureOllama()
report.scenarios.push({ name: 'ensure', status: first.status, message: first.message })
const second = await runServer(4330, path.join(root, 'artifacts', 'ollama-reuse-test'))
await sleep(800)
const line = second.output()
second.child.kill()
await sleep(1000)
report.scenarios.push({ name: 'control-server-reuses-ollama', serverReady: line.includes('"type":"started"'), reused: line.includes('"status":"reused"') })
await first.stop()
await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (!report.scenarios[1].serverReady || !report.scenarios[1].reused) process.exitCode = 1
