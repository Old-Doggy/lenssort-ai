import { mkdir, writeFile } from 'node:fs/promises'
const sources = [
  ['qwen35-card', 'https://raw.githubusercontent.com/QwenLM/Qwen3.5/main/README.md'],
  ['qwen3vl-card', 'https://raw.githubusercontent.com/QwenLM/Qwen3-VL/main/README.md'],
  ['qrealign-readme', 'https://raw.githubusercontent.com/Q-Future/Q-ReAlign/main/README.md'],
  ['ollama-qwen35-4', 'https://ollama.com/library/qwen3.5:4b'],
  ['ollama-qwen35-9', 'https://ollama.com/library/qwen3.5:9b'],
  ['qwen8-card', 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct/raw/main/README.md'],
  ['qwen4-card', 'https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct/raw/main/README.md'],
  ['ollama-qwen8', 'https://ollama.com/library/qwen3-vl:8b'],
  ['ollama-qwen4', 'https://ollama.com/library/qwen3-vl:4b'],
  ['qalign-readme', 'https://raw.githubusercontent.com/Q-Future/Q-Align/main/README.md'],
  ['siglip2-card', 'https://huggingface.co/google/siglip2-base-patch16-224/raw/main/README.md'],
]
await mkdir('artifacts/precision-research', { recursive: true })
const results = []
for (const [id, url] of sources.filter(([, url]) => !url.includes('huggingface.co'))) {
  const started = Date.now()
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
    const body = await response.text()
    const file = `artifacts/precision-research/${id}.txt`
    await writeFile(file, body)
    results.push({ id, url, status: response.status, bytes: Buffer.byteLength(body), elapsedMs: Date.now() - started, file })
  } catch (error) { results.push({ id, url, error: error.message, cause: error.cause?.message }) }
}
let runtime
try {
  const tags = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) }).then(response => response.json())
  const version = await fetch('http://127.0.0.1:11434/api/version').then(response => response.json())
  runtime = { tags, version }
} catch (error) { runtime = { error: error.message } }
const report = { createdAt: new Date().toISOString(), results, runtime }
await writeFile('artifacts/precision-research/github-sources.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
