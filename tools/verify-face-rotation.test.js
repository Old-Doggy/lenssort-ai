import test from 'node:test'
import assert from 'node:assert/strict'
import { mapDetectionToBase, shouldTryRotatedFaceVariants } from './local-face-detector.js'

const detection = { score: 0.9, box: { originX: 20, originY: 30, width: 40, height: 50 } }

test('rotated face boxes map back to the normalized image coordinates', () => {
  assert.deepEqual(mapDetectionToBase(detection, 0, 200, 100).box, { originX: 20, originY: 30, width: 40, height: 50 })
  assert.deepEqual(mapDetectionToBase(detection, 90, 200, 100).box, { originX: 30, originY: 40, width: 50, height: 40 })
  assert.deepEqual(mapDetectionToBase(detection, 180, 200, 100).box, { originX: 140, originY: 20, width: 40, height: 50 })
  assert.deepEqual(mapDetectionToBase(detection, 270, 200, 100).box, { originX: 120, originY: 20, width: 50, height: 40 })
})

test('rotation fallback is bounded and only runs for weak face evidence', () => {
  assert.equal(shouldTryRotatedFaceVariants({ faceCount: 0, maxConfidence: 0 }), true)
  assert.equal(shouldTryRotatedFaceVariants({ faceCount: 1, maxConfidence: 0.55 }), true)
  assert.equal(shouldTryRotatedFaceVariants({ faceCount: 1, maxConfidence: 0.8 }), false)
})
