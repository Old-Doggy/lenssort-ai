import assert from 'node:assert/strict'
import { classifyFolderCategory } from './folder-classification.js'

const scene = (label, score = 0.8) => [{ label, score }]
assert.equal(classifyFolderCategory(scene('valley, vale'), { faceCount: 0 }).category, '风景')
assert.equal(classifyFolderCategory(scene('valley, vale'), { faceCount: 1 }).category, '人物与风景')
assert.equal(classifyFolderCategory(scene('envelope', 0.1), { faceCount: 1 }).category, '单人')
assert.equal(classifyFolderCategory(scene('envelope', 0.1), { faceCount: 3 }).category, '多人')
assert.equal(classifyFolderCategory(scene('envelope', 0.1), { faceCount: 0 }).category, '待确认')
assert.equal(classifyFolderCategory(scene('envelope'), { faceCount: 0 }).category, '其他')
assert.equal(classifyFolderCategory(scene('valley, vale'), null).category, '待确认')
assert.equal(classifyFolderCategory([], { faceCount: 0 }).category, '待确认')
assert.equal(classifyFolderCategory(scene('groom, bridegroom'), { faceCount: 0 }).category, '待确认')
assert.equal(classifyFolderCategory([{ label: 'person', score: 0.92 }], { faceCount: 0 }, { person: { status: 'succeeded', candidateCount: 1, maxScore: 0.92 } }).category, '单人')
assert.equal(classifyFolderCategory(scene('envelope', NaN), { faceCount: 0 }).category, '待确认')
assert.equal(classifyFolderCategory([{ label: 'street sign', score: 0.2 }, { label: 'pier', score: 0.32 }], { faceCount: 0 }).category, '风景')
assert.equal(classifyFolderCategory([{ label: 'street sign', score: 0.5 }, { label: 'woman, woman', score: 0.21 }], { faceCount: 0 }).category, '待确认')
assert.equal(classifyFolderCategory([{ label: 'seashore, coast, seacoast, sea-coast', score: 0.12 }], { faceCount: 1 }).category, '人物与风景')
assert.equal(classifyFolderCategory([{ label: 'bird', score: 0.2 }], { faceCount: 0 }, { sceneCandidates: [{ label: 'a photo of a bird', score: 0.89 }] }).category, '动物')
assert.equal(classifyFolderCategory([{ label: 'person', score: 0.2 }], { faceCount: 1 }, { sceneCandidates: [{ label: 'a photo of a bird', score: 0.89 }] }).category, '单人')
assert.equal(classifyFolderCategory([{ label: 'envelope', score: 0.9 }], { faceCount: 0 }, { sceneCandidates: [{ label: 'a photo of the sky', score: 0.6 }] }).category, '风景')
assert.equal(classifyFolderCategory([{ label: 'envelope', score: 0.9 }], { faceCount: 0 }, { sceneCandidates: [{ label: 'a photo of clouds or sunset', score: 0.6 }] }).sceneLabel, 'a photo of clouds or sunset')
const statueScene = [{ label: 'a photo of a statue or sculpture', score: 0.72 }, { label: 'a portrait of one person', score: 0.08 }]
const statueResult = classifyFolderCategory(statueScene, { faceCount: 2, maxConfidence: 0.9 }, { sceneCandidates: statueScene })
assert.equal(statueResult.category, '待确认')
assert.match(statueResult.explanation, /艺术品|歧义/)
assert.equal(statueResult.confidence, null)
assert.doesNotMatch(statueResult.explanation, /过滤 1|约 1 位真人/)
const statueWithBlurredPerson = classifyFolderCategory(
  [{ label: 'a portrait of one person', score: 0.3 }],
  { faceCount: 2, maxConfidence: 0.7 },
  {
    sceneCandidates: [
      { label: 'a photo of a statue or sculpture', score: 0.42 },
      { label: 'a portrait of one person', score: 0.12 },
    ],
    person: {
      status: 'succeeded', maxScore: 0.88, candidateCount: 1, imageWidth: 1200, imageHeight: 800,
      boxes: [{ score: 0.88, x: 760, y: 140, width: 190, height: 400, areaRatio: 0.07917 }],
    },
  },
)
assert.equal(statueWithBlurredPerson.category, '单人')
console.log('11 folder classification boundary checks passed; not a real-photo accuracy score')
