import os from 'node:os'
import path from 'node:path'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'

export async function createMusiqAestheticScorer(root) {
  const python = path.join(root, 'data/p5-models/.venv/Scripts/python.exe')
  const script = path.join(root, 'tools/run-musiq-batch.py')
  const weight = path.join(root, 'data/p5-models/weights/musiq_ava_ckpt-e8d3f067.pth')
  try { await Promise.all([access(python), access(script), access(weight)]) } catch { return null }
  let child = null
  let pending = null
  return {
    async scoreBatch(items, onProgress = () => {}) {
      if (!Array.isArray(items) || items.length > 500) return { status: 'unavailable', error: '单批最多支持500张照片', results: [] }
      if (!items.length) return { status: 'completed', results: [] }
      const folder = await mkdtemp(path.join(os.tmpdir(), 'lenssort-musiq-'))
      const manifest = path.join(folder, 'input.json')
      const output = path.join(folder, 'output.json')
      try {
        await writeFile(manifest, JSON.stringify(items.map(item => ({ id: item.id, path: item.path }))), { flag: 'wx' })
        pending = new Promise((resolve, reject) => {
          child = execFile(python, [script, '--manifest', manifest, '--output', output, '--root', root], { windowsHide: true, timeout: Math.min(1800000, 30000 + items.length * 5000), maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, error => error ? reject(error) : resolve())
          let buffer = ''
          child.stdout.setEncoding('utf8')
          child.stdout.on('data', chunk => {
            buffer += chunk
            const lines = buffer.split('\n')
            buffer = lines.pop()
            for (const line of lines) {
              try {
                const progress = JSON.parse(line)
                if (Number.isInteger(progress.completed) && progress.completed <= items.length) onProgress(progress)
              } catch {}
            }
          })
        })
        await pending
        return JSON.parse(await readFile(output, 'utf8'))
      } catch (error) {
        return { status: 'unavailable', model: 'MUSIQ-AVA', error: error instanceof Error ? error.message : String(error), results: [] }
      } finally { child = null; pending = null; await rm(folder, { recursive: true, force: true }).catch(() => {}) }
    },
    async close() { if (child) child.kill(); if (pending) await pending.catch(() => {}) },
  }
}
