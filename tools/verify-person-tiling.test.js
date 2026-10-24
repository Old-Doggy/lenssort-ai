import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileRegions, mergePersonCandidates, shouldUsePersonTiles } from './yolox-person-detector.js'

test('adaptive person tiles cover all four corners with bounded overlap', () => {
  const regions = createTileRegions(4000, 3000)
  assert.equal(regions.length, 4)
  assert.deepEqual(regions[0], { left: 0, top: 0, width: 2400, height: 1800 })
  assert.deepEqual(regions[3], { left: 1600, top: 1200, width: 2400, height: 1800 })
  assert.ok(regions.every(region => region.left >= 0 && region.top >= 0 && region.left + region.width <= 4000 && region.top + region.height <= 3000))
})

test('tile detections map back to full image and expose independent support', () => {
  const result = mergePersonCandidates(
    [],
    [
      [{ score: 0.52, x: 900, y: 700, width: 160, height: 360, areaRatio: 0.013 }],
      [{ score: 0.48, x: 100, y: 700, width: 160, height: 360, areaRatio: 0.013 }],
    ],
    [{ left: 0, top: 0, width: 2400, height: 1800 }, { left: 1600, top: 0, width: 2400, height: 1800 }],
    4000,
    3000,
  )
  assert.equal(result[0].x, 900)
  assert.equal(result[0].tileSupport, 1)
  assert.equal(result[1].x, 1700)
  assert.equal(result[1].tileSupport, 1)
})

test('tiled scan is only requested when full-frame evidence is weak', () => {
  assert.equal(shouldUsePersonTiles([], true), true)
  assert.equal(shouldUsePersonTiles([{ score: 0.2 }], true), true)
  assert.equal(shouldUsePersonTiles([{ score: 0.42 }], true), false)
  assert.equal(shouldUsePersonTiles([], false), false)
})
