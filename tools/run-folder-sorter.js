import path from 'node:path'
import process from 'node:process'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'
import { createFolderSorter } from './folder-sorter.js'

const root = process.cwd()
const input = path.resolve(process.env.LENSSORT_INPUT ?? path.join(root, 'data/inbox'))
const output = path.resolve(process.env.LENSSORT_OUTPUT ?? path.join(root, 'data/sorted'))
const stateDir = path.resolve(process.env.LENSSORT_STATE ?? path.join(root, 'data/service-state'))
const backend = process.env.LENSSORT_BACKEND ?? 'cpu'
const analyzer = await createPhotoAnalyzer(root, backend)
let sorter
try { sorter = await createFolderSorter({
  input,
  output,
  stateDir,
  analyze: bytes => analyzer.analyze(bytes),
  onEvent: event => console.log(JSON.stringify({ ...event, at: new Date().toISOString() })),
}) } catch (error) { await analyzer.close(); throw error }
console.log(JSON.stringify({ type: 'started', input, output, stateDir, backend: analyzer.backend, npuVerified: false }))
const shutdown = async signal => {
  console.log(JSON.stringify({ type: 'stopping', signal }))
  try { await sorter.close() } finally { await analyzer.close() }
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
if (process.send) process.once('message', message => { if (message === 'shutdown') void shutdown('IPC verification') })
await new Promise(() => {})
