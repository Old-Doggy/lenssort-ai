import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { applyPublicReviewLabel, readPublicReview, reviewStatus } from './public-review.js'

const root = await mkdtemp(path.join(process.cwd(), 'artifacts/public-review-fixture-'))
try {
  const imageId = 'abcdef0123456789'
  const source = path.join(root, 'data/eval/public-candidates/open-images/单人/' + imageId + '.jpg')
  await mkdir(path.dirname(source), { recursive: true })
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  await writeFile(source, Buffer.from('fixture-image'))
  await writeFile(path.join(root, 'artifacts/open-images-download-manifest.json'), JSON.stringify({ status: 'partial', records: [{ imageId, candidateLabel: '单人', candidateScore: 1, sourceLabelNames: ['Person'], personBoxCount: 1, personGroupBox: false, mappingReason: 'fixture', sourcePageUrl: 'https://example.org/photo', license: 'https://creativecommons.org/licenses/by/2.0/', downloadStatus: 'downloaded', localPath: path.relative(root, source) }] }))
  const before = reviewStatus(await readPublicReview(root))
  assert.deepEqual({ total: before.total, reviewed: before.reviewed, pending: before.pending }, { total: 1, reviewed: 0, pending: 1 })
  const after = await applyPublicReviewLabel(root, imageId, '风景')
  assert.deepEqual({ total: after.total, reviewed: after.reviewed, pending: after.pending }, { total: 1, reviewed: 1, pending: 0 })
  const destination = path.join(root, 'data/eval/labeled/风景/' + imageId + '.jpg')
  assert.equal(await readFile(destination, 'utf8'), 'fixture-image')
  const saved = JSON.parse(await readFile(path.join(root, 'artifacts/open-images-human-review.json'), 'utf8'))
  assert.equal(saved.reviews[imageId].label, '风景')
  await assert.rejects(applyPublicReviewLabel(root, imageId, 'not-a-category'), /Invalid review category/)
  console.log(JSON.stringify({ status: 'passed', checks: ['pending review counted', 'label copied to labeled folder', 'atomic review state persisted', 'invalid category rejected'] }, null, 2))
} finally {
  assert.ok(root.includes(path.join(process.cwd(), 'artifacts')))
  await rm(root, { recursive: true, force: true })
}
