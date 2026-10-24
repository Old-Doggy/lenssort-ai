import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { readBoundedImage } from './public-eval-policy.js'

const root = process.cwd()
const input = path.resolve(option('input', path.join(root, 'artifacts/open-images-candidates.json')))
const output = path.resolve(option('output', path.join(root, 'artifacts/open-images-download-manifest.json')))
const targetRoot = path.resolve(option('target-root', path.join(root, 'data/eval/public-candidates/open-images')))
const maximum = boundedInteger(option('maximum', '120'), 'maximum', 120)
const userAgent = 'LensSortAI-public-eval/1.0 (local evaluation)'

function option(name, fallback) {
  const prefix = '--' + name + '='
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

function boundedInteger(value, name, maximumValue) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximumValue) throw new Error(name + ' must be an integer between 1 and ' + maximumValue)
  return Number(value)
}

function extensionFor(contentType, url) {
  if (contentType === 'image/png' || url.toLowerCase().includes('.png')) return '.png'
  if (contentType === 'image/webp' || url.toLowerCase().includes('.webp')) return '.webp'
  return '.jpg'
}

function approvedSource(record) {
  try {
    const license = new URL(record.license)
    const source = new URL(record.directMediaUrl)
    return license.protocol === 'https:' && license.hostname === 'creativecommons.org' && /^\/licenses\/(by|by-sa)\/\d+\.\d+\/?$/.test(license.pathname) && source.protocol === 'https:'
  } catch {
    return false
  }
}

async function downloadFromUrl(record, mediaUrl) {
  if (!approvedSource(record)) throw new Error('record has no approved HTTPS source and license')
  const response = await fetch(mediaUrl, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
  if (!contentType.startsWith('image/')) throw new Error('not an image response: ' + contentType)
  const bytes = await readBoundedImage(response, 2 * 1024 * 1024)
  const image = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata()
  if (!image.width || !image.height || image.width < 256 || image.height < 256) throw new Error('image dimensions below 256 pixels')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const filename = record.candidateLabel + '-' + String(record.candidateRank).padStart(2, '0') + '-' + sha256.slice(0, 12) + extensionFor(contentType, mediaUrl)
  const localPath = path.join(targetRoot, record.candidateLabel, filename)
  await mkdir(path.dirname(localPath), { recursive: true })
  try { await writeFile(localPath, bytes, { flag: 'wx' }) } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  return { localPath: path.relative(root, localPath), sha256, bytes: bytes.length, width: image.width, height: image.height, contentType }
}

async function download(record) {
  try {
    return await downloadFromUrl(record, record.directMediaUrl)
  } catch (error) {
    if (![404, 410].some(status => error.message === 'HTTP ' + status) || !record.originalMediaUrl || record.originalMediaUrl === record.directMediaUrl) throw error
    return { ...(await downloadFromUrl(record, record.originalMediaUrl)), fallback: 'originalMediaUrl' }
  }
}

const source = JSON.parse(await readFile(input, 'utf8'))
if (!Array.isArray(source.records)) throw new Error('candidate manifest records must be an array')
const records = source.records.slice(0, maximum)
const manifest = {
  version: 1,
  status: 'partial',
  createdAt: new Date().toISOString(),
  sourceManifest: path.relative(root, input),
  targetRoot: path.relative(root, targetRoot),
  attempted: records.length,
  downloaded: 0,
  failed: 0,
  records: [],
  failures: [],
  limitations: [
    'Open Images candidate mapping remains index-assisted and requires human review before use as ground truth.',
    'This step downloads bounded thumbnails only and does not claim that source URLs are permanently available.',
  ],
}
const seen = new Set()
for (const record of records) {
  try {
    const downloaded = await download(record)
    if (seen.has(downloaded.sha256)) {
      manifest.failures.push({ imageId: record.imageId, phase: 'dedupe', error: 'duplicate content in selected candidates' })
      manifest.failed += 1
      continue
    }
    seen.add(downloaded.sha256)
    manifest.records.push({ ...record, ...downloaded, downloadStatus: 'downloaded', reviewStatus: 'needs-human-review', humanLabel: null, downloadedAt: new Date().toISOString() })
    manifest.downloaded += 1
  } catch (error) {
    manifest.failed += 1
    manifest.failures.push({ imageId: record.imageId, sourceUrl: record.directMediaUrl, phase: 'download-or-decode', error: error.message })
  }
}
manifest.status = manifest.downloaded === manifest.attempted ? 'ready-for-human-review' : 'partial'
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(manifest, null, 2), 'utf8')
console.log(JSON.stringify({ status: manifest.status, output, attempted: manifest.attempted, downloaded: manifest.downloaded, failed: manifest.failed }, null, 2))
if (!manifest.downloaded) process.exitCode = 2
