import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { modelAssets } from './model-assets.js'
import { verifyAsset } from './asset-install.js'
import { projectRoot } from './runtime-paths.js'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const execute = promisify(execFile)
const checks = []
const add = (id, status, message, details = {}) => checks.push({ id, status, message, ...details })

const [major, minor] = process.versions.node.split('.').map(Number)
add('node', major > 22 || major === 22 && minor >= 12 ? 'pass' : 'fail', `Node.js ${process.versions.node}`, { required: '>=22.12.0' })
for (const command of process.platform === 'win32' ? ['python'] : ['python3']) {
  try { const result = await execute(command, ['--version'], { windowsHide: true, timeout: 3000 }); add(command, 'pass', String(result.stdout).trim()) }
  catch { add(command, 'warn', `未找到 ${command}；Windows GPU设备探测需要Python，CPU分类不依赖Python`) }
}
try { await execute(process.platform === 'win32' ? 'where.exe' : 'which', [process.platform === 'win32' ? 'npm.cmd' : 'npm'], { windowsHide: true, timeout: 3000 }); add('npm', 'pass', '已找到npm安装工具') }
catch { add('npm', 'fail', '未找到npm，请安装完整Node.js发行版') }
try { await access(chromium.executablePath()); add('browser', 'pass', '本地Chromium运行时已安装') }
catch {
  const edge = process.platform === 'win32' ? path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe') : null
  try { if (!edge) throw new Error('missing'); await access(edge); add('browser', 'warn', '未安装Chromium，运行时将尝试系统Edge') }
  catch { add('browser', 'fail', '运行 npx playwright install chromium 安装本地浏览器') }
}
try { await access(path.join(projectRoot, 'dist/index.html')); add('build', 'pass', '网页已构建') }
catch { add('build', 'fail', '运行 npm run build 构建网页') }
const assets = []
for (const asset of modelAssets) assets.push(await verifyAsset(projectRoot, asset))
const missing = assets.filter(asset => !asset.verified)
add('models', missing.length ? 'fail' : 'pass', missing.length ? `缺少或校验失败 ${missing.length}/${assets.length} 个模型资源` : `模型资源已校验 ${assets.length}/${assets.length}`, { missing: missing.map(asset => asset.path) })
try { await execute(process.platform === 'win32' ? 'where.exe' : 'which', ['ollama'], { windowsHide: true, timeout: 3000 }); add('ollama', 'pass', '已找到 Ollama；视觉描述可用（仍需模型已安装）') }
catch { add('ollama', 'warn', '未找到 Ollama；基础分类仍可用，视觉描述与复杂复核不可用') }
const failed = checks.filter(check => check.status === 'fail')
const result = { status: failed.length ? 'failed' : 'passed', root: projectRoot, checks }
console.log(JSON.stringify(result, null, 2))
if (failed.length) process.exitCode = 1
