import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { analyzeSubjectQuality } from './subject-quality.js'

async function fixture() {
  const width = 480
  const height = 360
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 ? 210 : 45
    pixels.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3)
  }
  const clear = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer()
  const blurred = await sharp(clear).blur(5).png().toBuffer()
  const region = { left: 144, top: 72, width: 192, height: 216 }
  const patch = await sharp(blurred).extract(region).toBuffer()
  const subjectBlur = await sharp(clear).composite([{ input: patch, left: region.left, top: region.top }]).png().toBuffer()
  const sharpPatch = await sharp(clear).extract(region).toBuffer()
  const backgroundBlur = await sharp(blurred).composite([{ input: sharpPatch, left: region.left, top: region.top }]).png().toBuffer()
  const faces = { imageWidth: width, imageHeight: height, detections: [{ score: 0.95, box: { originX: 144, originY: 72, width: 192, height: 216 } }] }
  return { clear, blurred, subjectBlur, backgroundBlur, faces }
}

test('subject sharpness distinguishes subject blur from intentional background blur', async () => {
  const images = await fixture()
  const options = { category: '单人', faces: images.faces }
  const sharpSubject = await analyzeSubjectQuality(images.backgroundBlur, options)
  const blurredSubject = await analyzeSubjectQuality(images.subjectBlur, options)
  assert.equal(sharpSubject.status, 'measured')
  assert.ok(sharpSubject.clarityScore > blurredSubject.clarityScore + 20)
  assert.equal(blurredSubject.blurRisk, 'high')
  assert.notEqual(sharpSubject.blurRisk, 'high')
})

test('non-person categories and tiny unreliable face boxes cannot claim a sharp subject', async () => {
  const images = await fixture()
  assert.equal((await analyzeSubjectQuality(images.clear, { category: '其他', faces: images.faces })).status, 'not-applicable')
  const faces = { ...images.faces, detections: [{ score: 0.95, box: { originX: 10, originY: 10, width: 5, height: 5 } }] }
  assert.equal((await analyzeSubjectQuality(images.clear, { category: '单人', faces })).status, 'unavailable')
})

test('region work is bounded and invalid coordinates never reach image extraction', async () => {
  const images = await fixture()
  const faces = { ...images.faces, detections: [...Array.from({ length: 30 }, () => images.faces.detections[0]), { score: 1, box: { originX: NaN, originY: 0, width: Infinity, height: 100 } }] }
  const result = await analyzeSubjectQuality(images.clear, { category: '多人', faces })
  assert.ok(result.regions.length <= 4)
  assert.ok(Number.isFinite(result.clarityScore))
})

test('a vision-model box alone cannot claim a measured human subject region', async () => {
  const images = await fixture()
  const result = await analyzeSubjectQuality(images.clear, { category: '单人', vision: { subjectBox: [0.2, 0.2, 0.5, 0.5] } })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.clarityScore, null)
})

test('one blurred minor face does not make a mostly sharp group portrait a high-risk pick', async () => {
  const images = await fixture()
  const minorRegion = { left: 20, top: 20, width: 95, height: 95 }
  const blurredMinorPatch = await sharp(images.blurred).extract(minorRegion).toBuffer()
  const blurredMinor = await sharp(images.clear).composite([{ input: blurredMinorPatch, left: minorRegion.left, top: minorRegion.top }]).png().toBuffer()
  const faces = {
    imageWidth: 480,
    imageHeight: 360,
    detections: [
      { score: 0.95, box: { originX: 144, originY: 72, width: 192, height: 216 } },
      { score: 0.95, box: { originX: 20, originY: 20, width: 95, height: 95 } },
      { score: 0.95, box: { originX: 365, originY: 20, width: 95, height: 95 } },
      { score: 0.95, box: { originX: 20, originY: 245, width: 95, height: 95 } },
    ],
  }
  const result = await analyzeSubjectQuality(blurredMinor, { category: '多人', faces })
  assert.equal(result.regions.length, 4)
  assert.equal(result.blurRisk, 'not-detected')
})

test('detector coordinates with a different aspect ratio are rejected instead of measuring the wrong area', async () => {
  const images = await fixture()
  const mismatchedFaces = { imageWidth: 360, imageHeight: 360, detections: images.faces.detections }
  const result = await analyzeSubjectQuality(images.clear, { category: '单人', faces: mismatchedFaces })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.clarityScore, null)
})

test('rotated and recompressed inputs keep a valid normalized subject region', async () => {
  const images = await fixture()
  const rotated = await sharp(images.clear).withMetadata({ orientation: 6 }).jpeg({ quality: 72 }).toBuffer()
  const faces = { imageWidth: 360, imageHeight: 480, detections: [{ score: 0.95, box: { originX: 72, originY: 96, width: 144, height: 216 } }] }
  const result = await analyzeSubjectQuality(rotated, { category: '单人', faces })
  assert.equal(result.status, 'measured')
  assert.ok(result.regions.every(region => region.x >= 0 && region.y >= 0 && region.x + region.width <= 1 && region.y + region.height <= 1))
})

test('malformed person and vision boxes degrade to unknown without throwing', async () => {
  const images = await fixture()
  const result = await analyzeSubjectQuality(images.clear, {
    category: '单人',
    person: { status: 'succeeded', imageWidth: 480, imageHeight: 360, boxes: [{ score: 0.99, x: 'bad', y: 0, width: Infinity, height: 100 }] },
    vision: { subjectBox: [0.9, 0.9, 0.5, 0.5] },
  })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.blurRisk, 'unknown')
})
