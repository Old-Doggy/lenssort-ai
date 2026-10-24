import path from 'node:path'
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import { writeAtomicJson } from './atomic-state.js'

export const reviewCategories = ['单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认']
const categorySet = new Set(reviewCategories)
const manifestRelative = path.join('artifacts', 'open-images-download-manifest.json')
const reviewRelative = path.join('artifacts', 'open-images-human-review.json')
const labeledRelative = path.join('data', 'eval', 'labeled')

const within = (parent, child) => {
  const relative = path.relative(parent, child)
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

function resolveProjectPath(root, relativePath) {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  if (!within(resolvedRoot, resolved)) throw new Error('Review file path escapes project root')
  return resolved
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}

export async function readPublicReview(root) {
  const manifest = await readJson(resolveProjectPath(root, manifestRelative), null)
  if (!manifest || !Array.isArray(manifest.records)) throw new Error('Public review download manifest is missing or invalid')
  const review = await readJson(resolveProjectPath(root, reviewRelative), { version: 1, reviews: {} })
  if (!review.reviews || typeof review.reviews !== 'object') throw new Error('Public review state is invalid')
  const records = manifest.records.filter(record => record.downloadStatus === 'downloaded' && typeof record.imageId === 'string' && typeof record.localPath === 'string')
  return { manifest, review, records }
}

export function reviewStatus(bundle) {
  const records = bundle.records.map(record => {
    const saved = bundle.review.reviews[record.imageId]
    return { imageId: record.imageId, candidateLabel: record.candidateLabel, candidateScore: record.candidateScore, sourceLabelNames: record.sourceLabelNames ?? [], personBoxCount: record.personBoxCount ?? 0, personGroupBox: record.personGroupBox === true, mappingReason: record.mappingReason ?? '', sourcePageUrl: record.sourcePageUrl ?? null, license: record.license ?? null, humanLabel: saved?.label ?? null, reviewedAt: saved?.reviewedAt ?? null }
  })
  const reviewed = records.filter(record => record.humanLabel !== null).length
  return { status: bundle.manifest.status, total: records.length, reviewed, pending: records.length - reviewed, records }
}

function labeledPath(root, label, imageId, extension) {
  return resolveProjectPath(root, path.join(labeledRelative, label, imageId + extension.toLowerCase()))
}

export async function applyPublicReviewLabel(root, imageId, label) {
  if (typeof imageId !== 'string' || !/^[a-f0-9]{8,64}$/.test(imageId)) throw Object.assign(new Error('Invalid review image id'), { status: 400 })
  if (!categorySet.has(label)) throw Object.assign(new Error('Invalid review category'), { status: 400 })
  const bundle = await readPublicReview(root)
  const record = bundle.records.find(item => item.imageId === imageId)
  if (!record) throw Object.assign(new Error('Unknown review image'), { status: 404 })
  const source = resolveProjectPath(root, record.localPath)
  const extension = path.extname(source)
  if (!extension) throw new Error('Review source has no image extension')
  const previous = bundle.review.reviews[imageId]
  if (previous?.label && categorySet.has(previous.label)) await unlink(labeledPath(root, previous.label, imageId, extension)).catch(error => { if (error.code !== 'ENOENT') throw error })
  const destination = labeledPath(root, label, imageId, extension)
  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(source, destination)
  bundle.review.reviews[imageId] = { label, localPath: path.relative(root, destination), reviewedAt: new Date().toISOString() }
  bundle.review.updatedAt = new Date().toISOString()
  await writeAtomicJson(resolveProjectPath(root, reviewRelative), bundle.review)
  return reviewStatus(bundle)
}

export function resolveReviewSource(root, record) {
  if (!record || typeof record.localPath !== 'string') throw new Error('Review source is missing')
  return resolveProjectPath(root, record.localPath)
}
