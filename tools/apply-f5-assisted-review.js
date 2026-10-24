import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { applyPublicReviewLabel, readPublicReview, reviewStatus } from './public-review.js'
import { writeAtomicJson } from './atomic-state.js'

const root = process.cwd()
const evidencePath = path.join(root, 'artifacts', 'f5-assisted-review.json')

const labels = [
  '其他', '多人', '人物与风景', '人物与风景', '其他', '其他', '多人', '单人', '其他', '其他',
  '单人', '多人', '单人', '多人', '单人', '其他', '其他', '人物与风景', '单人', '多人',
  '其他', '多人', '多人', '多人', '其他', '其他', '单人', '人物与风景', '人物与风景', '多人',
  '多人', '多人', '多人', '单人', '多人', '人物与风景', '多人', '单人', '人物与风景', '人物与风景',
  '人物与风景', '人物与风景', '人物与风景', '人物与风景', '人物与风景', '人物与风景', '人物与风景', '人物与风景', '人物与风景', '人物与风景',
  '人物与风景', '人物与风景', '人物与风景', '人物与风景', '人物与风景', '人物与风景', '人物与风景', '风景', '风景', '风景',
  '风景', '风景', '风景', '风景', '风景', '其他', '其他', '风景', '风景', '风景',
  '风景', '风景', '风景', '其他', '其他', '其他', '其他', '其他', '其他', '其他',
  '其他', '其他', '其他', '其他', '单人', '其他', '其他', '风景', '其他', '其他',
  '其他', '其他', '单人', '单人', '单人', '其他', '单人', '单人', '单人', '多人',
  '单人', '多人', '其他', '多人', '其他', '多人'
]

if (labels.length !== 106) throw new Error(`Expected 106 labels, received ${labels.length}`)

const before = reviewStatus(await readPublicReview(root))
if (before.total !== labels.length) throw new Error(`Review total mismatch: ${before.total}`)

const records = before.records
const decisions = []
for (let index = 0; index < records.length; index++) {
  const record = records[index]
  const label = labels[index]
  const after = await applyPublicReviewLabel(root, record.imageId, label)
  decisions.push({
    order: index + 1,
    imageId: record.imageId,
    candidateLabel: record.candidateLabel,
    assignedLabel: label,
    sourcePageUrl: record.sourcePageUrl,
    reviewMethod: 'ai-assisted-visual-review',
    reviewedAt: after.records.find(item => item.imageId === record.imageId)?.reviewedAt ?? null
  })
}

const final = reviewStatus(await readPublicReview(root))
const counts = {}
const candidateAgreement = {}
for (const decision of decisions) {
  counts[decision.assignedLabel] = (counts[decision.assignedLabel] ?? 0) + 1
  if (decision.assignedLabel === decision.candidateLabel) candidateAgreement.agree = (candidateAgreement.agree ?? 0) + 1
  else candidateAgreement.disagree = (candidateAgreement.disagree ?? 0) + 1
}

const evidence = {
  status: final.reviewed === 106 && final.pending === 0 ? 'passed-with-boundary' : 'failed',
  createdAt: new Date().toISOString(),
  step: 'F5.2',
  reviewMethod: 'ai-assisted-visual-review',
  independentHumanGroundTruth: false,
  scope: 'All downloaded public candidates were visually reviewed from local contact sheets and assigned one fixed project category. This is not independent human annotation.',
  before: { total: before.total, reviewed: before.reviewed, pending: before.pending },
  after: { total: final.total, reviewed: final.reviewed, pending: final.pending },
  labelCounts: counts,
  candidateAgreement,
  decisions,
  nextStep: 'F5.3: generate only a clearly labeled AI-assisted/proxy evaluation unless an independent human review is added.'
}
await writeAtomicJson(evidencePath, evidence)
console.log(JSON.stringify({ status: evidence.status, step: evidence.step, before: evidence.before, after: evidence.after, labelCounts: evidence.labelCounts, candidateAgreement: evidence.candidateAgreement, evidencePath: path.relative(root, evidencePath) }, null, 2))
if (evidence.status !== 'passed-with-boundary') process.exitCode = 1
