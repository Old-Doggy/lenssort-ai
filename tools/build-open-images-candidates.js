import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const root = process.cwd()
const categories = ['单人', '多人', '人物与风景', '风景', '其他', '待确认']
const personId = '/m/01g317'
const landscapeIds = new Set([
  '/m/025s3q0', '/m/03d28y3', '/m/023bbt', '/m/05h0n', '/m/09d_r',
  '/m/04h4w', '/m/0b3yr', '/m/02zr8', '/m/06cnp', '/m/05kq4',
  '/m/01lxd', '/m/0j2kx', '/m/01b2w5', '/m/01bqvp',
])
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function option(name, fallback) {
  const prefix = '--' + name + '='
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''))
      field = ''
      if (row.some(value => value.length > 0)) rows.push(row)
      row = []
    } else {
      field += character
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''))
    if (row.some(value => value.length > 0)) rows.push(row)
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field')
  if (!rows.length) return []
  const headers = rows[0]
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

async function readCsv(file, hasHeader = true) {
  const text = await readFile(file, 'utf8')
  if (hasHeader) return parseCsv(text)
  const rows = []
  for (const row of text.split(/\r?\n/)) {
    if (!row.trim()) continue
    const values = parseCsv('first,second\n' + row)[0]
    if (values) rows.push(Object.values(values))
  }
  return rows
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function isApprovedLicense(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'creativecommons.org' && /^\/licenses\/(by|by-sa)\/\d+\.\d+\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

function sourcePageUrl(row) {
  return row.OriginalLandingURL || row.OriginalURL || 'https://storage.googleapis.com/openimages/web/index.html'
}

function imageSource(row) {
  const url = row.Thumbnail300KURL || row.OriginalURL
  if (!url) return null
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase()
    return imageExtensions.has(extension) ? url : url + '.jpg'
  } catch {
    return null
  }
}

function candidateFor(image, labels, boxes) {
  const imageLabels = labels.get(image.ImageID) ?? new Set()
  const personBoxes = boxes.get(image.ImageID) ?? { count: 0, group: false }
  const hasPerson = imageLabels.has(personId)
  const hasLandscape = [...imageLabels].some(label => landscapeIds.has(label))
  const sourceLabels = [...imageLabels]

  if (hasPerson && hasLandscape) {
    return { label: '人物与风景', score: 1, reason: '图像级标签同时包含 Person 与自然/风景相关标签' }
  }
  if (hasPerson && (personBoxes.group || personBoxes.count >= 2)) {
    return { label: '多人', score: 1, reason: personBoxes.group ? 'Person 框标注包含群组框' : 'Person 框标注包含至少两个独立框' }
  }
  if (hasPerson && personBoxes.count === 1) {
    return { label: '单人', score: 1, reason: '图像级标签包含 Person，且只有一个非群组 Person 框' }
  }
  if (hasPerson) {
    return { label: '待确认', score: 0.5, reason: '包含 Person，但缺少足够的人数框证据' }
  }
  if (hasLandscape) {
    return { label: '风景', score: 0.9, reason: '图像级标签包含自然/风景相关标签，未发现 Person 标签' }
  }
  if (sourceLabels.length > 0) {
    return { label: '其他', score: 0.6, reason: '存在图像级标签，但未发现 Person 或自然/风景相关标签' }
  }
  return { label: '待确认', score: 0.2, reason: '没有可用于映射的人工图像标签' }
}

const indexRoot = path.resolve(option('index-root', path.join(root, 'data/eval/public-indexes')))
const output = path.resolve(option('output', path.join(root, 'artifacts/open-images-candidates.json')))
const limitValue = option('limit-per-class', '20')
if (!/^\d+$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 30) throw new Error('limit-per-class must be an integer between 1 and 30')
const limitPerClass = Number(limitValue)
const imageRows = await readCsv(path.join(indexRoot, option('images', 'validation-images.csv')))
const labelRows = await readCsv(path.join(indexRoot, option('labels', 'validation-annotations-human-imagelabels.csv')))
const bboxRows = await readCsv(path.join(indexRoot, option('boxes', 'validation-annotations-bbox.csv')))
const classRows = await readCsv(path.join(indexRoot, option('classes', 'class-descriptions.csv')), false)
const requiredImageColumns = ['ImageID', 'OriginalURL', 'OriginalLandingURL', 'License', 'Thumbnail300KURL']
if (!imageRows.length || requiredImageColumns.some(column => !Object.hasOwn(imageRows[0], column))) throw new Error('Image index is missing required columns')

const labelNames = new Map(classRows.map(values => [values[0], values[1] ?? '']))
const labels = new Map()
for (const row of labelRows) {
  if (toNumber(row.Confidence) < 1) continue
  if (!labels.has(row.ImageID)) labels.set(row.ImageID, new Set())
  labels.get(row.ImageID).add(row.LabelName)
}
const boxes = new Map()
for (const row of bboxRows) {
  if (row.LabelName !== personId || toNumber(row.Confidence) < 1) continue
  if (!boxes.has(row.ImageID)) boxes.set(row.ImageID, { count: 0, group: false })
  const entry = boxes.get(row.ImageID)
  entry.count += 1
  entry.group ||= row.IsGroupOf === '1'
}

const allCandidates = []
for (const image of imageRows) {
  if (!isApprovedLicense(image.License)) continue
  const source = imageSource(image)
  if (!source) continue
  const mapping = candidateFor(image, labels, boxes)
  allCandidates.push({
    candidateLabel: mapping.label,
    candidateScore: mapping.score,
    reviewStatus: 'needs-human-review',
    humanLabel: null,
    downloadStatus: 'not-downloaded',
    imageId: image.ImageID,
    sourceSite: 'Open Images validation set',
    sourcePageUrl: sourcePageUrl(image),
    directMediaUrl: source,
    originalMediaUrl: image.OriginalURL || null,
    license: image.License,
    author: image.Author || null,
    title: image.Title || null,
    originalSize: image.OriginalSize || null,
    originalMd5: image.OriginalMD5 || null,
    sourceLabels: [...(labels.get(image.ImageID) ?? [])],
    sourceLabelNames: [...(labels.get(image.ImageID) ?? [])].map(label => labelNames.get(label) ?? label),
    personBoxCount: boxes.get(image.ImageID)?.count ?? 0,
    personGroupBox: boxes.get(image.ImageID)?.group ?? false,
    mappingReason: mapping.reason,
  })
}

const records = []
for (const category of categories) {
  const selected = allCandidates
    .filter(candidate => candidate.candidateLabel === category)
    .sort((left, right) => right.candidateScore - left.candidateScore || left.imageId.localeCompare(right.imageId))
    .slice(0, limitPerClass)
    .map((candidate, index) => ({ ...candidate, candidateRank: index + 1 }))
  records.push(...selected)
}
const candidateCounts = Object.fromEntries(categories.map(category => [category, records.filter(record => record.candidateLabel === category).length]))
const report = {
  version: 1,
  status: categories.every(category => candidateCounts[category] >= limitPerClass) ? 'ready-for-human-review' : 'partial',
  createdAt: new Date().toISOString(),
  indexRoot,
  dataset: 'Open Images validation set',
  licensePolicy: 'Only rows with an explicit Creative Commons BY or BY-SA URL are retained; every selected record remains pending human review.',
  limitPerClass,
  candidateCounts,
  missingCategories: categories.filter(category => candidateCounts[category] < limitPerClass),
  records,
  limitations: [
    'Candidate labels are index-assisted mappings, not human ground truth.',
    'Absence of a Person or landscape label is not proof that the image contains none.',
    'Person box counts can miss people or contain group boxes and therefore require human review.',
    'The selected URLs are not downloaded by this tool; download and decode must be a separate bounded step.',
  ],
}
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ status: report.status, output, imageRows: imageRows.length, labeledImages: labels.size, candidateCounts, missingCategories: report.missingCategories }, null, 2))
if (report.status !== 'ready-for-human-review') process.exitCode = 2
