import { mkdir, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { projectRoot } from './runtime-paths.js'

await mkdir(path.join(projectRoot, 'artifacts'), { recursive: true })
const files = (await readdir(path.join(projectRoot, 'tools'))).filter(name => name.endsWith('.test.js')).sort().map(name => path.join(projectRoot, 'tools', name))
const child = spawn(process.execPath, ['--test', ...files], { cwd: projectRoot, stdio: 'inherit', windowsHide: true })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
