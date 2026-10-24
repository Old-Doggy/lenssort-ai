import sharp from 'sharp'

export async function reviewPersonPresence({ bytes, vision, person = {}, explain }) {
  if (!vision.generated || vision.uncertain || vision.realPersonPresent || vision.bodyPartOnly || !['object', 'environment', 'animal', 'plant'].includes(vision.subjectFocus)) return vision
  const box = person.status === 'succeeded' ? person.boxes?.find(candidate => candidate.score >= 0.65 && candidate.areaRatio >= 0.004) : null
  if (!box) return vision
  const metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().metadata()
  const width = metadata.autoOrient?.width ?? metadata.width
  const height = metadata.autoOrient?.height ?? metadata.height
  const left = Math.max(0, Math.floor(box.x - box.width * 0.3))
  const top = Math.max(0, Math.floor(box.y - box.height * 0.3))
  const right = Math.min(width, Math.ceil(box.x + box.width * 1.3))
  const bottom = Math.min(height, Math.ceil(box.y + box.height * 1.3))
  if (![left, top, right, bottom].every(Number.isFinite) || right - left < 24 || bottom - top < 24) return vision
  try {
    const crop = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().extract({ left, top, width: right - left, height: bottom - top }).jpeg().toBuffer()
    const review = await explain(crop, { review: true })
    const evidence = { calls: 1, scope: 'single-detector-region', generated: review.generated, summary: review.summary, realPersonPresent: review.realPersonPresent, bodyPartOnly: review.bodyPartOnly }
    if (!review.generated || review.uncertain || !review.realPersonPresent || review.bodyPartOnly || review.mediaType !== 'photograph') return { ...vision, presenceReview: evidence }
    return { ...vision, realPersonPresent: true, personCount: null, personCountScope: 'unknown-total', personCountLowerBound: 1, summary: `${vision.summary} 局部复核确认画面中另有真人，未推断全图人数。`, explanation: `${vision.explanation || vision.summary} 局部复核确认画面中另有真人，未推断全图人数。`, presenceReview: evidence }
  } catch (error) {
    if (error.code === 'LENSSORT_FORCED_MODEL_FAILED') throw error
    return { ...vision, presenceReview: { calls: 1, generated: false, error: error.message } }
  }
}
