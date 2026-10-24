import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'

const directory = path.resolve(process.argv.find(value => value.startsWith('--directory='))?.slice('--directory='.length) || 'artifacts/public-eval-review/retest-2026-10-22')
const report = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'))
const manifest = JSON.parse(await readFile('artifacts/open-images-download-manifest.json', 'utf8'))
const labels = JSON.parse(await readFile('artifacts/public-eval-review/human-corrections-2026-10-22.json', 'utf8'))
const samples = manifest.records.filter(record => record.downloadStatus === 'downloaded')
assert.equal(report.complete, true)
assert.equal(report.records.length, samples.length)
assert.ok(!report.error && !report.cleanupError && !report.serviceCleanupError)
for (const [index, row] of report.records.entries()) {
  assert.equal(row.sha256, samples[index].sha256)
  assert.equal(row.number, index + 1)
  const bytes = await readFile(path.resolve(row.localPath))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256)
}
const checked = labels.records.map(label => {
  const row = report.records.find(item => item.sha256 === label.sha256)
  assert.ok(row)
  const checks = []
  const vision = row.result.visionExplanation
  if (label.expected.category) checks.push(row.result.category === label.expected.category)
  if (typeof label.expected.realPersonPresent === 'boolean') checks.push(vision?.generated === true && vision.realPersonPresent === label.expected.realPersonPresent)
  if (Number.isInteger(label.expected.personCount)) checks.push(vision?.generated === true && vision.personCount === label.expected.personCount)
  return { number: row.number, previous: row.previousCategory, actual: row.result.category, expected: label.expected, personCount: vision?.personCount, personPresent: vision?.realPersonPresent, status: label.expected.needsClarification || !checks.length ? '口径待确认' : checks.every(Boolean) ? '符合本条标注' : '未符合', summary: vision?.summary ?? vision?.error ?? '无视觉描述' }
})
const milliseconds = report.records.map(row => row.ms).sort((left, right) => left - right)
const profiles = [...new Set(report.records.map(row => row.result.npuEvidence?.profile).filter(Boolean))]
const verifiedProfiles = []
for (const profile of profiles) {
  const events = JSON.parse(await readFile(profile, 'utf8'))
  const kernels = events.filter(event => event.args?.provider === 'VitisAIExecutionProvider' && event.name?.endsWith('_kernel_time'))
  assert.ok(kernels.length > 0, 'NPU profile没有实际VitisAI内核证据')
  verifiedProfiles.push({ profile, kernelCount: kernels.length, kernelMs: kernels.reduce((sum, event) => sum + Number(event.dur ?? 0), 0) / 1000 })
}
const summary = {
  complete: report.complete, total: report.records.length, annotated: checked.length,
  matched: checked.filter(row => row.status === '符合本条标注').length,
  unmatched: checked.filter(row => row.status === '未符合').length,
  needsClarification: checked.filter(row => row.status === '口径待确认').length,
  visionGenerated: report.records.filter(row => row.result.visionExplanation?.generated).length,
  pending: report.records.filter(row => row.result.category === '待确认').map(row => row.number),
  changed: report.records.filter(row => row.previousCategory !== row.result.category).length,
  elapsedSeconds: Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000),
  medianMs: milliseconds[Math.floor(milliseconds.length / 2)], p95Ms: milliseconds[Math.ceil(milliseconds.length * 0.95) - 1],
  npuVerifiedPhotos: report.records.filter(row => row.result.npuVerified === true).length,
  profileEvidence: verifiedProfiles,
  npuEvidenceScope: '首张推理的会话profile由本批共用，不是逐张独立profile；CPU辅助算子允许。视觉大模型使用GPU，不是NPU。',
  notice: '有限人工纠错回归，非独立准确率；有人不等于以人为主。96、103不计入通过率。',
}
await writeFile(path.join(directory, 'comparison.json'), JSON.stringify({ summary, records: checked }, null, 2), 'utf8')
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const cards = report.records.map(row => {
  const annotation = checked.find(item => item.number === row.number)
  const source = path.relative(directory, path.resolve(row.localPath)).split(path.sep).map(encodeURIComponent).join('/')
  const vision = row.result.visionExplanation
  const expected = annotation ? JSON.stringify(annotation.expected) : '本张没有人工纠错标注'
  return `<article><a href="${source}" target="_blank" rel="noopener"><img src="${source}" loading="lazy" alt="第${row.number}张原图"></a><h2>${row.number} · ${escape(row.result.category)}</h2><p>上轮：${escape(row.previousCategory)} · ${escape(annotation?.status ?? '待人工查看')}</p><p>真人线索：${vision?.generated ? `${vision.realPersonPresent ? '有人' : '无可确认真人'}；模型计数 ${vision.personCount}` : '视觉输出无效'}</p><p>${escape(vision?.summary ?? vision?.error)}</p><details><summary>查看人工标注与文件名</summary><p>${escape(expected)}</p><p>${escape(row.name)}</p></details></article>`
}).join('\n')
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>公开照片复测对照</title><style>body{margin:0;background:#f5f5f7;color:#222;font:16px/1.6 system-ui,sans-serif}header{padding:28px;max-width:1250px;margin:auto}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;padding:24px;max-width:1300px;margin:auto}article{background:white;border-radius:16px;padding:16px;box-shadow:0 2px 12px #0001}img{width:100%;height:240px;object-fit:contain;background:#eee;border-radius:8px}h2{font-size:21px}p{overflow-wrap:anywhere}summary{cursor:pointer}</style><header><h1>公开照片复测：按原编号核对</h1><p>${summary.total}张；${summary.annotated}条人工纠错中，${summary.matched}条符合、${summary.unmatched}条未符合、${summary.needsClarification}条口径待确认。点击图片看原图。</p><p>分类表示主要拍摄主体；“真人线索”单独展示画面是否有人，不把“其他/风景/动物”等同于无人。局部手部与雕像不据此推断真人数量。模型计数不是人工真值。</p><p>${escape(summary.notice)}</p></header><main>${cards}</main></html>`
await writeFile(path.join(directory, '人工核对.html'), html, 'utf8')
console.log(JSON.stringify(summary, null, 2))
