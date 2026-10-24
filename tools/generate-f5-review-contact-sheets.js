import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import sharp from 'sharp'

const root = process.cwd()
const outputRoot = path.join(root, 'artifacts', 'f5-review-contact-sheets')
const manifest = JSON.parse(await readFile(path.join(root, 'artifacts', 'open-images-download-manifest.json'), 'utf8'))
const records = manifest.records.filter(record => record.downloadStatus === 'downloaded')
const actualReview = JSON.parse(await readFile(path.join(root, 'artifacts/public-eval-review/manual-review.json'), 'utf8'))
const corrections = JSON.parse(await readFile(path.join(root, 'artifacts/public-eval-review/human-corrections-2026-10-22.json'), 'utf8'))
const retestPath = process.argv.find(value => value.startsWith('--results='))?.slice('--results='.length)
const retest = retestPath ? JSON.parse(await readFile(path.resolve(root, retestPath), 'utf8')) : null
if (retest && (!retest.complete || retest.records.length !== records.length)) throw new Error('复测尚未完整结束，禁止生成最终总览')
const columns = 4
const cellWidth = 300
const cellHeight = 245
const imageWidth = 280
const imageHeight = 190
const rowsPerSheet = 5
const sheetSize = columns * rowsPerSheet

await mkdir(outputRoot, { recursive: true })
const results = []

for (let offset = 0; offset < records.length; offset += sheetSize) {
  const batch = records.slice(offset, offset + sheetSize)
  const composites = []
  for (let index = 0; index < batch.length; index++) {
    const record = batch[index]
    const source = path.resolve(root, record.localPath)
    const name = path.basename(record.localPath)
    const actual = actualReview.records.find(item => item.name === name)
    const latest = retest?.records.find(item => item.sha256 === record.sha256)
    const human = corrections.records.find(item => item.sha256 === record.sha256)
    const label = `${offset + index + 1}. ${retest ? '本轮复测' : '上轮实际'}:${latest?.result.category ?? actual?.predictedCategory ?? '未评测'}`
    const note = `来源候选:${record.candidateLabel} / 人工:${human?.expected.category ?? (human?.expected.realPersonPresent ? '有人' : '未定类')}`
    const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const svg = `<svg width="${cellWidth}" height="${cellHeight}" xmlns="http://www.w3.org/2000/svg"><text x="10" y="213" font-family="Arial" font-size="14" fill="#18181b">${escape(label)}</text><text x="10" y="235" font-family="Arial" font-size="12" fill="#52525b">${escape(note)}</text></svg>`
    const image = await sharp(source).rotate().resize(imageWidth, imageHeight, { fit: 'inside', background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer()
    const picture = await sharp({ create: { width: cellWidth, height: cellHeight, channels: 4, background: '#f4f4f5' } }).composite([
      { input: image, left: 10, top: 10 },
    ]).png().toBuffer()
    const tile = await sharp(picture).composite([
      { input: Buffer.from(svg), left: 0, top: 0 }
    ]).png().toBuffer()
    composites.push({ input: tile, left: (index % columns) * cellWidth, top: Math.floor(index / columns) * cellHeight })
  }
  const filename = `sheet-${String(Math.floor(offset / sheetSize) + 1).padStart(2, '0')}.png`
  const destination = path.join(outputRoot, filename)
  await sharp({ create: { width: columns * cellWidth, height: rowsPerSheet * cellHeight, channels: 4, background: '#e4e4e7' } }).composite(composites).png().toFile(destination)
  results.push({ filename: path.relative(root, destination), start: offset + 1, end: offset + batch.length, count: batch.length })
}

console.log(JSON.stringify({ status: 'passed', total: records.length, sheets: results }, null, 2))
