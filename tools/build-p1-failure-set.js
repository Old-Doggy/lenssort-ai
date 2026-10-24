import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const root = process.cwd()
const config = JSON.parse(await readFile(path.join(root, 'data/control/config.json'), 'utf8'))
const stateId = createHash('sha256').update(config.input + '\n' + config.output).digest('hex').slice(0, 24)
const state = JSON.parse(await readFile(path.join(root, 'data/control', stateId, 'records.json'), 'utf8'))
const expected = new Map([
  ['IMG_20220705_213534 - 副本.jpg', { expectedCategory: '风景', tags: ['scene-missed', 'night-landscape'] }],
  ['IMG_20220707_112913 - 副本.jpg', { expectedCategory: '单人', tags: ['person-missed', 'full-body', 'masked'] }],
  ['IMG_20220707_112902 - 副本.jpg', { expectedCategory: '单人', tags: ['person-missed', 'full-body', 'masked'] }],
  ['IMG_20220708_132024 - 副本.jpg', { expectedCategory: '人物与风景', tags: ['person-missed', 'environment-portrait'] }],
  ['_MG_7073 - 副本.JPG', { expectedCategory: '风景', tags: ['scene-missed', 'architecture-landscape'] }],
  ['_MG_7105.JPG', { expectedCategory: '风景', tags: ['curation-risk', 'similar-scene'] }],
  ['_MG_7106.JPG', { expectedCategory: '风景', tags: ['curation-risk', 'similar-scene'] }],
  ['_MG_7138.JPG', { expectedCategory: '风景', tags: ['duplicate-risk', 'same-content'] }],
  ['_MG_7138 - 副本.JPG', { expectedCategory: '风景', tags: ['duplicate-risk', 'same-content'] }],
  ['_MG_7129.JPG', { expectedCategory: '风景', tags: ['technical-risk', 'low-clarity'] }],
  ['_MG_7129 - 副本.JPG', { expectedCategory: '风景', tags: ['duplicate-risk', 'technical-risk', 'low-clarity'] }],
])
const files = Object.entries(state.sources).map(([source, record]) => ({ source, record })).filter(item => item.record.status === 'done').sort((left, right) => path.basename(left.source).localeCompare(path.basename(right.source), 'zh-Hans-CN'))
const samples = []
for (const { source, record } of files) {
  const name = path.basename(source)
  const bytes = await readFile(source)
  const metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata()
  const hint = expected.get(name)
  const tags = hint?.tags ?? []
  if (record.result?.category === '待确认') tags.push('current-review')
  if (record.result?.faces?.faceCount === 0) tags.push('no-face-detected')
  samples.push({
    name,
    source,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    currentCategory: record.result?.category ?? null,
    currentReason: record.result?.reason ?? null,
    currentFaceCount: record.result?.faces?.faceCount ?? null,
    currentFaceAreaRatio: record.result?.faces?.faceAreaRatio ?? null,
    currentQualityScore: record.result?.qualityScore ?? null,
    currentSceneLabel: record.result?.candidates?.[0]?.label ?? null,
    expectedCategory: hint?.expectedCategory ?? null,
    tags: [...new Set(tags)],
    independentHumanLabel: false,
  })
}
const report = {
  status: samples.length >= 20 ? 'ready-with-boundary' : 'insufficient-samples',
  phase: 'P1',
  createdAt: new Date().toISOString(),
  input: config.input,
  output: config.output,
  sampleCount: samples.length,
  taggedFailureCount: samples.filter(sample => sample.tags.length > 0).length,
  independentHumanLabels: 0,
  note: 'Expected categories are user-provided screenshot-based regression hints, not independent accuracy ground truth.',
  samples,
}
const cellWidth = 320
const cellHeight = 250
const columns = 4
const rows = Math.ceil(samples.length / columns)
const composites = []
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
for (let index = 0; index < samples.length; index++) {
  const sample = samples[index]
  const left = (index % columns) * cellWidth
  const top = Math.floor(index / columns) * cellHeight
  const thumbnail = await sharp(sample.source).rotate().resize(300, 195, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
  composites.push({ input: thumbnail, left: left + 10, top: top + 8 })
  const caption = `${index + 1}. ${sample.name.slice(0, 36)}`
  const category = `${sample.currentCategory ?? '未知'}${sample.expectedCategory ? ` → ${sample.expectedCategory}` : ''}`
  const svg = Buffer.from(`<svg width="${cellWidth}" height="${cellHeight}"><rect x="0" y="205" width="${cellWidth}" height="45" fill="white"/><text x="8" y="222" font-family="Arial" font-size="12" fill="#111">${escapeXml(caption)}</text><text x="8" y="240" font-family="Arial" font-size="11" fill="#567">${escapeXml(category)}</text></svg>`)
  composites.push({ input: svg, left, top })
}
const contactSheet = path.join(root, 'artifacts/p1-failure-contact-sheet.jpg')
await sharp({ create: { width: cellWidth * columns, height: cellHeight * rows, channels: 3, background: { r: 245, g: 247, b: 244 } } }).composite(composites).jpeg({ quality: 86 }).toFile(contactSheet)
await mkdir(path.join(root, 'artifacts'), { recursive: true })
await writeFile(path.join(root, 'artifacts/p1-failure-samples.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ status: report.status, sampleCount: report.sampleCount, taggedFailureCount: report.taggedFailureCount, output: 'artifacts/p1-failure-samples.json', contactSheet: 'artifacts/p1-failure-contact-sheet.jpg' }, null, 2))
