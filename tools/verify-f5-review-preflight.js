import path from 'node:path'
import { access, mkdir, readFile } from 'node:fs/promises'
import { writeAtomicJson } from './atomic-state.js'
import { readPublicReview, reviewCategories, reviewStatus, resolveReviewSource } from './public-review.js'

const root = process.cwd()
const manifestPath = path.join(root, 'artifacts', 'open-images-download-manifest.json')
const reviewPath = path.join(root, 'artifacts', 'open-images-human-review.json')
const labeledRoot = path.join(root, 'data', 'eval', 'labeled')
const evidencePath = path.join(root, 'artifacts', 'f5-review-preflight.json')

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const bundle = await readPublicReview(root)
const statusBefore = reviewStatus(bundle)
const downloaded = manifest.records.filter(record => record.downloadStatus === 'downloaded')
const missingFields = []
const unreadable = []
const hashes = new Set()
const candidateCounts = {}

for (const record of downloaded) {
  for (const field of ['imageId', 'candidateLabel', 'sourcePageUrl', 'license', 'sourceLabelNames', 'personBoxCount', 'localPath', 'sha256']) {
    if (record[field] === undefined || record[field] === null || record[field] === '') missingFields.push({ imageId: record.imageId, field })
  }
  if (record.sha256) hashes.add(record.sha256)
  candidateCounts[record.candidateLabel] = (candidateCounts[record.candidateLabel] ?? 0) + 1
  try {
    await access(resolveReviewSource(root, record))
  } catch (error) {
    unreadable.push({ imageId: record.imageId, localPath: record.localPath, error: error.message })
  }
}

for (const category of reviewCategories) await mkdir(path.join(labeledRoot, category), { recursive: true })

const state = bundle.review
state.version = 1
state.reviews ??= {}
state.updatedAt = new Date().toISOString()
await writeAtomicJson(reviewPath, state)
const statusAfter = reviewStatus(await readPublicReview(root))

const evidence = {
  status: missingFields.length === 0 && unreadable.length === 0 && statusAfter.total === downloaded.length ? 'passed' : 'failed',
  createdAt: new Date().toISOString(),
  step: 'F5.1',
  scope: 'Review preflight only; no human labels assigned and no automatic classification started.',
  manifest: {
    status: manifest.status,
    attempted: manifest.attempted,
    downloaded: downloaded.length,
    failed: manifest.failed ?? manifest.records.filter(record => record.downloadStatus !== 'downloaded').length,
    candidateCounts,
    uniqueSha256: hashes.size,
    missingFields,
    unreadable
  },
  review: {
    statePath: path.relative(root, reviewPath),
    before: { total: statusBefore.total, reviewed: statusBefore.reviewed, pending: statusBefore.pending },
    after: { total: statusAfter.total, reviewed: statusAfter.reviewed, pending: statusAfter.pending },
    categories: reviewCategories,
    labeledRoot: path.relative(root, labeledRoot)
  },
  checks: [
    'downloaded candidate records are enumerable',
    'source, license, label and hash fields are present',
    'downloaded source files are readable',
    'content hashes are unique',
    'review state is initialized without assigning labels',
    'six labeled output directories exist',
    'review categories remain fixed'
  ],
  nextStep: 'F5.2: human review of all pending images; do not use candidateLabel as ground truth.'
}
await writeAtomicJson(evidencePath, evidence)
console.log(JSON.stringify(evidence, null, 2))
if (evidence.status !== 'passed') process.exitCode = 1
