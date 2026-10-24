import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { normalizeVision, semanticCategory, visionPrompt, visionSchema } from './vision-output.js'

const folder = 'artifacts/precision-research'
const base = 'http://127.0.0.1:11434'
const model = process.argv.find(value => value.startsWith('--model='))?.slice(8) || 'gemma3:4b'
const refined = process.argv.includes('--refined')
if (!['gemma3:4b', 'qwen3.5:4b', 'qwen3.5:9b'].includes(model)) throw new Error('Outside frozen candidate list')
await mkdir(folder, { recursive: true })
const api = async (route, body, timeout = 90000) => {
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) })
  const value = await response.json()
  if (!response.ok || value.error) throw new Error(value.error || String(response.status))
  return value
}
if (process.argv.includes('--pull')) {
  const started = Date.now()
  const response = await fetch(base + '/api/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal: AbortSignal.timeout(900000) })
  if (!response.ok) throw new Error('Model download HTTP ' + response.status)
  let buffer = ''
  let lastProgress = 0
  const log = []
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString('utf8')
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const item = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
      if (item.error) throw new Error(item.error)
      if (!item.total || Date.now() - lastProgress > 15000) {
        log.push(item); console.log(model, item.status, item.total ? `${Math.round(100 * (item.completed || 0) / item.total)}%` : '')
        lastProgress = Date.now()
        await writeFile(`${folder}/pull-${model.replace(':', '-')}.json`, JSON.stringify({ model, elapsedMs: Date.now() - started, log }, null, 2))
      }
    }
  }
}
let samples
try { samples = JSON.parse(await readFile(`${folder}/samples.json`, 'utf8')) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  const user = 'F:\\测试\\测试'
  samples = ['IMG_20220705_213534 - 副本.jpg', 'IMG_20220707_112913 - 副本.jpg', 'IMG_20220708_132024 - 副本.jpg', '_MG_7105.JPG', '_MG_7106.JPG', '_MG_7073 - 副本.JPG'].map(name => ({ file: path.join(user, name), labelSource: 'historical-failure-hint-not-independent-ground-truth' }))
  for (const category of ['单人', '多人', '风景', '人物与风景', '其他', '其他']) {
    const entries = (await readdir(path.join('data/eval/labeled', category))).filter(name => name.endsWith('.jpg')).sort()
    const index = category === '其他' && samples.some(item => item.proxyLabel === '其他') ? 1 : 0
    samples.push({ file: path.resolve('data/eval/labeled', category, entries[index]), proxyLabel: category, labelSource: 'AI-assisted-not-human-truth' })
  }
  for (const sample of samples) sample.sha256 = createHash('sha256').update(await readFile(sample.file)).digest('hex')
  await writeFile(`${folder}/samples.json`, JSON.stringify(samples, null, 2))
}
if (process.argv.includes('--prepare')) { console.log('Frozen samples:', samples.length); process.exit(0) }
if (refined) {
  const extraNames = ['_MG_7103 - 副本.JPG', '_MG_7129.JPG', '_MG_7156.JPG', '_MG_7157.JPG', '_MG_7000 - 副本.JPG']
  for (const name of extraNames) samples.push({ file: path.join('F:\\测试\\测试', name), labelSource: 'AI-visual-case-review-not-human-truth' })
  samples.push({ file: path.resolve('data/eval/labeled/其他/0007cebe1b2ba653.jpg'), labelSource: 'animal-dominant-previous-proxy-label-not-reused' })
  for (const sample of samples) sample.sha256 = createHash('sha256').update(await readFile(sample.file)).digest('hex')
  await writeFile(`${folder}/samples-refined.json`, JSON.stringify(samples, null, 2))
}
const prompt = '请直接观察照片，输出JSON，不要猜地点身份。category只能为单人、多人、人物与风景、风景、动物、其他、待确认。人物与风景需要真人和明显环境，单人/多人用于人物为主要主体。天空、自然、城市建筑夜景属于风景。雕像、海报、倒影不是额外真人。字段：category、summary（一句准确中文画面描述）、real_person_present、statue_present、animal_present、landscape_present（四项布尔值）、composition（简短构图评价）、aesthetic_comment（简短美感评价；技术清晰不等于好看）。不输出数值置信度。'
const report = { createdAt: new Date().toISOString(), model, prompt: refined ? visionPrompt : prompt, schema: refined ? visionSchema : null, settings: { edge: 896, jpeg: 85, num_ctx: 4096, num_predict: 420, think: false }, metadata: await api('/api/show', { model }), records: [] }
const reportFile = `${folder}/benchmark-${model.replace(':', '-')}${refined ? '-refined' : ''}.json`
const percentile = (values, ratio) => values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)] ?? null
const existing = await api('/api/ps')
if (existing.models?.some(item => item.name !== model)) console.log('Other loaded models exist; Ollama may evict them under memory pressure')
for (const [index, sample] of samples.entries()) {
  const started = Date.now()
  try {
    const bytes = await readFile(sample.file)
    if (createHash('sha256').update(bytes).digest('hex') !== sample.sha256) throw new Error('Frozen sample changed')
    const image = await sharp(bytes).rotate().resize(896, 896, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    const result = await api('/api/chat', { model, stream: false, format: refined ? visionSchema : 'json', think: false, keep_alive: '5m', messages: [{ role: 'user', content: report.prompt, images: [image.toString('base64')] }], options: { temperature: 0, seed: 42, num_ctx: 4096, num_predict: 420 } })
    const parsed = JSON.parse(result.message?.content || '')
    if (refined) {
      if (result.done_reason === 'length') throw new Error('Truncated visual output')
      const normalized = normalizeVision(parsed)
      parsed.category = semanticCategory(normalized) || normalized.categoryCandidate
    }
    if (!['单人', '多人', '人物与风景', '风景', '动物', '其他', '待确认'].includes(parsed.category) || !parsed.summary) throw new Error('Invalid semantic JSON schema')
    report.records.push({ ...sample, index, elapsedMs: Date.now() - started, loadMs: result.load_duration / 1e6, totalMs: result.total_duration / 1e6, promptTokens: result.prompt_eval_count, tokens: result.eval_count, doneReason: result.done_reason, parsed, runtime: await api('/api/ps') })
  } catch (error) { report.records.push({ ...sample, index, error: error.message, elapsedMs: Date.now() - started }) }
  await writeFile(reportFile, JSON.stringify(report, null, 2))
  console.log(model, index + 1, report.records.at(-1).parsed?.category || report.records.at(-1).error, report.records.at(-1).elapsedMs + 'ms')
}
const hot = report.records.slice(1).filter(item => !item.error).map(item => item.elapsedMs).sort((left, right) => left - right)
report.summary = { samples: samples.length, failures: report.records.filter(item => item.error).length, hotP50Ms: percentile(hot, 0.5), hotP95Ms: percentile(hot, 0.95), totalMs: report.records.reduce((sum, item) => sum + item.elapsedMs, 0), independentAccuracy: null }
await writeFile(reportFile, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.summary, null, 2))
