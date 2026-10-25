import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'

const execute = promisify(execFile)
const tracked = (await execute('git', ['ls-files', '-z'], { windowsHide: true, maxBuffer: 2_000_000 })).stdout.split('\0').filter(Boolean)
const untracked = (await execute('git', ['ls-files', '--others', '--exclude-standard', '-z'], { windowsHide: true, maxBuffer: 2_000_000 })).stdout.split('\0').filter(Boolean)
const candidates = [...new Set([...tracked, ...untracked])]
const blockedPath = /^(?:artifacts|data|output|screenshots|node_modules|\.venv[^/]*|dist)(?:\/|$)|\.(?:onnx|tflite|task|bin)$/i
const privateText = /(?:C:\\Users\\Olddog|E:\\ai项目|\/Users\/Olddog|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})/i
const failures = []
const pathViolations = candidates.filter(file => blockedPath.test(file))
if (pathViolations.length) failures.push({ kind: 'blocked-path', files: pathViolations })
for (const file of candidates) {
  if (!/\.(?:js|mjs|ts|tsx|json|md|cmd|ps1|py|yml|yaml|html|css|txt|svg)$/i.test(file)) continue
  let contents
  try { contents = await readFile(path.resolve(file), 'utf8') } catch { continue }
  if (privateText.test(contents)) failures.push({ kind: 'private-content', file })
}
const result = { status: failures.length ? 'failed' : 'passed', inspectedFiles: candidates.length, failures }
console.log(JSON.stringify(result, null, 2))
if (failures.length) process.exitCode = 1
