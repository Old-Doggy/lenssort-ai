import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyFolderCategory } from './folder-classification.js'

const candidates = [{ label: 'envelope', score: 0.1 }]

test('two independent high-confidence body boxes classify as multiple people without faces', () => {
  const person = {
    status: 'succeeded',
    maxScore: 0.91,
    candidateCount: 2,
    imageWidth: 1200,
    imageHeight: 800,
    boxes: [
      { score: 0.91, x: 80, y: 120, width: 180, height: 420, areaRatio: 0.07875 },
      { score: 0.88, x: 760, y: 140, width: 190, height: 400, areaRatio: 0.07917 },
    ],
  }
  assert.equal(classifyFolderCategory(candidates, { faceCount: 0 }, { person }).category, '多人')
})

test('one high-confidence body box can classify as one person without a face', () => {
  const person = {
    status: 'succeeded',
    maxScore: 0.91,
    candidateCount: 1,
    imageWidth: 1200,
    imageHeight: 800,
    boxes: [{ score: 0.91, x: 80, y: 120, width: 180, height: 420, areaRatio: 0.07875 }],
  }
  assert.equal(classifyFolderCategory(candidates, { faceCount: 0 }, { person }).category, '单人')
})

test('overlapping boxes for one person do not inflate the people count', () => {
  const person = {
    status: 'succeeded',
    maxScore: 0.91,
    candidateCount: 2,
    imageWidth: 1200,
    imageHeight: 800,
    boxes: [
      { score: 0.91, x: 80, y: 120, width: 180, height: 420, areaRatio: 0.07875 },
      { score: 0.82, x: 92, y: 132, width: 175, height: 410, areaRatio: 0.07474 },
    ],
  }
  assert.equal(classifyFolderCategory(candidates, { faceCount: 0 }, { person }).category, '单人')
})

test('weak or incomplete body evidence remains pending without faces', () => {
  const person = {
    status: 'succeeded',
    maxScore: 0.6,
    candidateCount: 2,
    boxes: [{ score: 0.6 }, { score: 0.59 }],
  }
  assert.equal(classifyFolderCategory(candidates, { faceCount: 0 }, { person }).category, '待确认')
})
