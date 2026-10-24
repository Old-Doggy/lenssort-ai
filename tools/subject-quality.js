import sharp from 'sharp'

const clamp = value => Math.max(0, Math.min(100, value))
const people = new Set(['单人', '多人', '人物与风景'])

function sharpness(data, width, height) {
  let total = 0
  let squared = 0
  let count = 0
  for (let row = 1; row < height - 1; row++) for (let column = 1; column < width - 1; column++) {
    const offset = row * width + column
    const edge = data[offset - width] + data[offset + width] + data[offset - 1] + data[offset + 1] - 4 * data[offset]
    total += edge
    squared += edge * edge
    count++
  }
  const variance = count ? Math.max(0, squared / count - (total / count) ** 2) : 0
  return { variance, score: clamp(Math.round(12 + 11 * Math.log1p(variance))) }
}

function validRegion(region, width, height) {
  return [region.x, region.y, region.width, region.height].every(Number.isFinite)
    && region.width > 0 && region.height > 0 && region.x < 1 && region.y < 1
    && region.x + region.width > 0 && region.y + region.height > 0
    && region.width * width >= 32 && region.height * height >= 32
}

function compatibleAspect(sourceWidth, sourceHeight, width, height) {
  return sourceWidth > 0 && sourceHeight > 0 && width > 0 && height > 0
    && Math.abs(Math.log((sourceWidth / sourceHeight) / (width / height))) <= 0.02
}

function faceRegions(faces, width, height) {
  const sourceWidth = Number(faces.imageWidth)
  const sourceHeight = Number(faces.imageHeight)
  if (!compatibleAspect(sourceWidth, sourceHeight, width, height)) return []
  return (faces.detections ?? []).filter(face => face.score >= 0.75).map(face => {
    const box = face.box ?? {}
    return { x: box.originX / sourceWidth, y: box.originY / sourceHeight, width: box.width / sourceWidth, height: box.height / sourceHeight, source: 'face-region' }
  }).filter(region => validRegion(region, width, height))
}

export async function analyzeSubjectQuality(bytes, { category, faces = {}, person = {}, vision = {} } = {}) {
  const started = performance.now()
  if (!people.has(category) || vision.realPersonPresent === false) return { status: 'not-applicable', clarityScore: null, blurRisk: 'unknown', regions: [] }
  const { data, info } = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true })
  let regions = faceRegions(faces, info.width, info.height)
  const visualBox = vision.subjectBox
  if (Array.isArray(visualBox) && visualBox.length === 4) {
    const [x, y, width, height] = visualBox
    const focused = { x, y, width, height, source: 'visual-subject-region' }
    if (validRegion(focused, info.width, info.height)) {
      const contained = regions.filter(region => {
        const centerX = region.x + region.width / 2
        const centerY = region.y + region.height / 2
        return centerX >= x && centerX <= x + width && centerY >= y && centerY <= y + height
      })
      if (contained.length) regions = contained
    }
  }
  if (!regions.length && person.status === 'succeeded' && compatibleAspect(Number(person.imageWidth), Number(person.imageHeight), info.width, info.height)) {
    regions = (person.boxes ?? []).filter(box => box.score >= 0.85).map(box => ({ x: box.x / person.imageWidth, y: box.y / person.imageHeight, width: box.width / person.imageWidth, height: box.height / person.imageHeight, source: 'body-region' })).filter(region => validRegion(region, info.width, info.height))
  }
  regions.sort((left, right) => right.width * right.height - left.width * left.height)
  const largestArea = regions[0] ? regions[0].width * regions[0].height : 0
  regions = regions.filter(region => region.width * region.height >= largestArea * 0.2)
  regions = regions.slice(0, category === '单人' ? 1 : 4)
  return measureRegions(data, info, regions, started)
}

async function measureRegions(data, info, regions, started) {
  const measured = []
  for (const region of regions) {
    const left = Math.max(0, Math.floor(region.x * info.width))
    const top = Math.max(0, Math.floor(region.y * info.height))
    const width = Math.min(info.width - left, Math.round(region.width * info.width))
    const height = Math.min(info.height - top, Math.round(region.height * info.height))
    if (width < 32 || height < 32) continue
    const crop = sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } }).extract({ left, top, width, height })
    const full = await crop.clone().resize(256, 256, { fit: 'inside', withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true })
    const reduced = await crop.resize(128, 128, { fit: 'inside', withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true })
    const fine = sharpness(full.data, full.info.width, full.info.height)
    const coarse = sharpness(reduced.data, reduced.info.width, reduced.info.height)
    measured.push({ ...region, clarityScore: fine.score, fineVariance: fine.variance, coarseVariance: coarse.variance, blurRisk: fine.score < 45 && coarse.score < 55 ? 'high' : 'not-detected' })
  }
  const available = measured.length > 0
  const clarityScores = measured.map(region => region.clarityScore).sort((left, right) => left - right)
  const middle = Math.floor(clarityScores.length / 2)
  const clarityScore = available ? clarityScores.length % 2 ? clarityScores[middle] : Math.round((clarityScores[middle - 1] + clarityScores[middle]) / 2) : null
  const highRiskCount = measured.filter(region => region.blurRisk === 'high').length
  const blurRisk = highRiskCount > measured.length / 2 ? 'high' : available ? 'not-detected' : 'unknown'
  return { status: available ? 'measured' : 'unavailable', clarityScore, blurRisk, regions: measured, durationMs: Math.round(performance.now() - started), reason: available ? '有限主体候选区域的多尺度技术清晰度；使用中位数避免单个异常候选主导精选；不代表真人身份确认或主观审美' : '没有足够大的可靠主体区域，无法判断局部清晰度' }
}
