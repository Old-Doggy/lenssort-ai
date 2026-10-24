import sharp from 'sharp'

async function describeImage(bytes) {
  const image = sharp(bytes, { limitInputPixels: 80_000_000 }).rotate()
  const metadata = await image.metadata()
  const width = metadata.autoOrient?.width ?? metadata.width
  const height = metadata.autoOrient?.height ?? metadata.height
  const pixels = await image.resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer()
  const mean = pixels.reduce((total, value) => total + value, 0) / pixels.length
  const deviation = Math.sqrt(pixels.reduce((total, value) => total + (value - mean) ** 2, 0) / pixels.length)
  return { aspect: width / height, mean, deviation, pixels }
}

function near(left, right) {
  if (left.deviation < 8 || right.deviation < 8 || Math.abs(Math.log(left.aspect / right.aspect)) > 0.02 || Math.abs(left.mean - right.mean) > 10) return false
  if (!left.pixels.length || left.pixels.length !== right.pixels.length) return false
  const difference = left.pixels.reduce((total, value, index) => total + Math.abs((value - left.mean) / left.deviation - (right.pixels[index] - right.mean) / right.deviation), 0) / left.pixels.length
  return difference <= 0.12
}

export function createSimilarityReviewPolicy({ describe = describeImage, maxReviews = 20, maxHistory = 300 } = {}) {
  const history = []
  let reviews = 0
  let total = 0
  return {
    get stats() { return { history: history.length, reviews, total } },
    async inspect(bytes, vision) {
      total++
      if (!vision?.generated || !vision.categoryCandidate) return { review: false }
      const descriptor = await describe(bytes)
      const previous = history.find(item => item.category !== vision.categoryCandidate && near(item.descriptor, descriptor))
      const budgetLimited = Boolean(previous) && (reviews >= maxReviews || reviews >= Math.max(2, Math.ceil(total * 0.2)))
      const review = Boolean(previous) && !budgetLimited
      if (review) reviews++
      history.unshift({ descriptor, category: vision.categoryCandidate })
      if (history.length > maxHistory) history.length = maxHistory
      return { review, budgetLimited, previousCategory: previous?.category ?? null, reason: previous ? '极近似画面出现类别冲突，仅触发独立复核，不复制历史标签' : '未发现极近似类别冲突' }
    },
  }
}
