import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { approvedPublicLicense, readBoundedImage, boundedCollectionInteger } from './public-eval-policy.js'

const root = process.cwd()
const candidateRoot = path.join(root, 'data/eval/public-candidates')
const manifestPath = path.join(root, 'artifacts/public-eval-manifest.json')
const categories = [
  { label: '单人', queries: ['single person portrait', 'one person outdoor photo'] },
  { label: '多人', queries: ['group of people photo', 'crowd people portrait'] },
  { label: '人物与风景', queries: ['person landscape photo', 'hiker landscape person'] },
  { label: '风景', queries: ['natural landscape photo', 'mountain landscape lake'] },
  { label: '其他', queries: ['animal photo', 'building still life photo'] },
  { label: '待确认', queries: ['obscured person photo', 'ambiguous scene photo'] },
]
const perClass = boundedCollectionInteger(option('per-class', '20'), 'per-class', 30)
const maxResults = boundedCollectionInteger(option('max-results', '30'), 'max-results', 30)
const maxQueries = boundedCollectionInteger(option('max-queries', '2'), 'max-queries', 2)
const userAgent = 'LensSortAI-public-eval/1.0 (local evaluation; contact unavailable)'

function option(name, fallback) {
  const prefix = '--' + name + '='
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

function metadataValue(metadata, key) {
  const value = metadata?.[key]?.value
  return typeof value === 'string' ? value.replace(/<[^>]+>/g, '').trim() : ''
}

function allowedLicense(metadata) {
  return approvedPublicLicense(metadataValue(metadata, 'LicenseShortName'), metadataValue(metadata, 'LicenseUrl'))
}

function extensionFor(mime, url) {
  if (mime === 'image/png' || url.toLowerCase().includes('.png')) return '.png'
  if (mime === 'image/webp' || url.toLowerCase().includes('.webp')) return '.webp'
  return '.jpg'
}

async function requestJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.json()
}

async function search(query) {
  const params = new URLSearchParams({
    action: 'query', origin: '*', format: 'json', generator: 'search', gsrsearch: query,
    gsrnamespace: '6', gsrlimit: String(maxResults), prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime|sha1', iiurlwidth: '768',
  })
  return requestJson('https://commons.wikimedia.org/w/api.php?' + params)
}

async function download(url) {
  const response = await fetch(url, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('image HTTP ' + response.status)
  const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
  if (!contentType.startsWith('image/')) throw new Error('not an image response: ' + contentType)
  const bytes = await readBoundedImage(response)
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error('image size outside 1 byte to 12 MiB')
  const image = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata()
  if (!image.width || !image.height || image.width < 256 || image.height < 256) throw new Error('image dimensions below 256 pixels')
  return { bytes, contentType, width: image.width, height: image.height }
}

let manifest = { version: 1, createdAt: new Date().toISOString(), status: 'partial', records: [], failures: [] }
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const existingHashes = new Set(manifest.records.map(record => record.sha256).filter(Boolean))
const existingCounts = Object.fromEntries(categories.map(category => [category.label, manifest.records.filter(record => record.candidateLabel === category.label).length]))
const run = { startedAt: new Date().toISOString(), perClass, maxResults, categories: [], failures: [] }

for (const category of categories) {
  let count = existingCounts[category.label] ?? 0
  const categoryRun = { candidateLabel: category.label, queries: category.queries, downloaded: 0, skipped: 0, failures: [] }
  await mkdir(path.join(candidateRoot, category.label), { recursive: true })
  for (const query of category.queries.slice(0, maxQueries)) {
    if (count >= perClass) break
    let result
    try { result = await search(query) } catch (error) { categoryRun.failures.push({ phase: 'search', query, error: error.message }); continue }
    const pages = Object.values(result.query?.pages ?? {})
    for (const page of pages) {
      if (count >= perClass) break
      const info = page.imageinfo?.[0]
      const metadata = info?.extmetadata
      const license = allowedLicense(metadata)
      const sourceUrl = info?.descriptionurl ?? ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(page.title.replaceAll(' ', '_')))
      if (!info?.url || !license || !info.mime?.startsWith('image/')) { categoryRun.skipped++; continue }
      try {
        const downloaded = await download(info.thumburl ?? info.url)
        const sha256 = createHash('sha256').update(downloaded.bytes).digest('hex')
        if (existingHashes.has(sha256)) { categoryRun.skipped++; continue }
        const extension = extensionFor(downloaded.contentType, info.url)
        const filename = category.label + '-' + String(count + 1).padStart(2, '0') + '-' + sha256.slice(0, 12) + extension
        const relativePath = path.join('data/eval/public-candidates', category.label, filename)
        await writeFile(path.join(root, relativePath), downloaded.bytes, { flag: 'wx' })
        manifest.records.push({
          candidateLabel: category.label, reviewStatus: 'needs-human-or-explicit-review', localPath: relativePath,
          sha256, bytes: downloaded.bytes.length, width: downloaded.width, height: downloaded.height,
          sourceSite: 'Wikimedia Commons', sourcePageUrl: sourceUrl, directMediaUrl: info.url,
          title: page.title, author: metadataValue(metadata, 'Artist'), license, licenseUrl: metadataValue(metadata, 'LicenseUrl'),
          downloadedAt: new Date().toISOString(), sourceQuery: query, humanLabel: null, excludedReason: null,
        })
        existingHashes.add(sha256)
        count++
        categoryRun.downloaded++
      } catch (error) { categoryRun.failures.push({ phase: 'download', title: page.title, error: error.message }) }
    }
  }
  run.categories.push({ ...categoryRun, totalCandidates: count, missing: Math.max(0, perClass - count) })
  run.failures.push(...categoryRun.failures)
}

manifest.updatedAt = new Date().toISOString()
manifest.lastRun = run
manifest.candidateCounts = Object.fromEntries(categories.map(category => [category.label, manifest.records.filter(record => record.candidateLabel === category.label).length]))
manifest.missingCandidates = categories.filter(category => (manifest.candidateCounts[category.label] ?? 0) < perClass).map(category => category.label)
manifest.status = 'partial'
await mkdir(path.dirname(manifestPath), { recursive: true })
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
console.log(JSON.stringify({ status: manifest.status, manifest: manifestPath, candidateCounts: manifest.candidateCounts, missingCandidates: manifest.missingCandidates, failures: run.failures.length }, null, 2))
if (manifest.missingCandidates.length) process.exitCode = 2
