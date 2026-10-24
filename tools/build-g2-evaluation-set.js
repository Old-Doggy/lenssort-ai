import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const source = JSON.parse(await readFile('artifacts/open-images-download-manifest.json', 'utf8'))
const prior = JSON.parse(await readFile('artifacts/g1-general-evaluation.json', 'utf8'))
const excluded = new Set(prior.results.map(row => row.sha256))
const reserve = process.argv.includes('--reserve')
if (reserve) for (const row of JSON.parse(await readFile('artifacts/g2-frozen-set.json', 'utf8')).records) excluded.add(row.sha256)
const perCategory = reserve ? 4 : 8
const outputPrefix = reserve ? 'g2-reserve' : 'g2'
const rows = []
for (const category of ['单人', '多人', '人物与风景', '风景', '其他', '待确认']) {
  const available = source.records.filter(row => row.candidateLabel === category && !excluded.has(row.sha256)).sort((left, right) => left.imageId.localeCompare(right.imageId))
  let count = 0
  for (const record of available) {
    if (count >= perCategory) break
    const bytes = await readFile(record.localPath)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (excluded.has(hash) || rows.some(row => row.sha256 === hash)) continue
    rows.push({ id: rows.length + 1, imageId: record.imageId, file: path.resolve(record.localPath), sha256: hash, split: reserve ? 'acceptance' : count % 2 ? 'acceptance' : 'development', license: record.license, author: record.author, sourcePageUrl: record.sourcePageUrl, datasetLabels: record.sourceLabelNames, datasetPersonBoxes: record.personBoxCount, expected: null, labelSource: 'pending blinded AI visual review; not independent human ground truth', slices: [] })
    count++
  }
  if (count !== perCategory) throw new Error('Insufficient unused samples in ' + category)
}
await mkdir(`artifacts/${outputPrefix}-review`, { recursive: true })
for (let offset = 0; offset < rows.length; offset += 8) {
  const batch = rows.slice(offset, offset + 8)
  const composites = []
  for (const [index, row] of batch.entries()) {
    const tile = await sharp(row.file).rotate().resize(390, 290, { fit: 'contain', background: '#ffffff' }).toBuffer()
    composites.push({ input: tile, left: index % 4 * 400 + 5, top: Math.floor(index / 4) * 330 + 5 })
    composites.push({ input: Buffer.from(`<svg width="390" height="30"><text x="10" y="22" font-size="20">${row.id} - ${row.imageId}</text></svg>`), left: index % 4 * 400 + 5, top: Math.floor(index / 4) * 330 + 298 })
  }
  await sharp({ create: { width: 1600, height: 660, channels: 3, background: '#eeeeee' } }).composite(composites).png().toFile(`artifacts/${outputPrefix}-review/sheet-${offset / 8 + 1}.png`)
}
const manifest = { date: '2026-10-20', frozen: true, excludedG1Hashes: [...excluded], policy: 'Labels must be assigned before model outputs. AI visual review is explicitly not independent human annotation. Acceptance set cannot be used for prompt tuning.', records: rows }
await writeFile(`artifacts/${outputPrefix}-frozen-set.json`, JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ count: rows.length, development: rows.filter(row => row.split === 'development').length, acceptance: rows.filter(row => row.split === 'acceptance').length, sheets: Math.ceil(rows.length / 8) }))
