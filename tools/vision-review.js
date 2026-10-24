import { applyVisionLanguageCategory, getVisionConflict, mergeVisionReviews } from './vision-language-policy.js'
import { reviewPersonPresence } from './person-presence-review.js'

export async function reviewPhotoDecision({ bytes, classification, faces, person, scene, explain, enableReview = false, similarityReview = null }) {
  const first = await explain(bytes)
  let vision = first
  let calls = 1
  const trigger = getVisionConflict({ classification, vision, faces, person, scene })
  const similarity = similarityReview ? await similarityReview.inspect(bytes, first) : { review: false }
  const shouldReview = Boolean(trigger && enableReview) || similarity.review
  if (shouldReview) {
    calls++
    try {
      const second = await explain(bytes, { review: true })
      vision = { ...mergeVisionReviews(first, second), firstReview: first, secondReview: second }
    } catch (error) {
      if (error.code === 'LENSSORT_FORCED_MODEL_FAILED') throw error
      vision = { ...first, uncertain: true, reviewConflict: '二次视觉复核失败', reviewError: error.message }
    }
  }
  vision = await reviewPersonPresence({ bytes, vision, person, explain })
  calls += vision.presenceReview?.calls ?? 0
  const decision = applyVisionLanguageCategory(classification, vision, { faces, person })
  const explanation = decision.classification.category === '待确认'
    ? '视觉证据暂不足以稳定判断主体或类别，已保留待确认；可打开原图人工修改分类。'
    : vision.generated !== false && !vision.uncertain && !vision.reviewConflict
      ? vision.explanation || vision.summary || decision.classification.explanation
      : decision.classification.explanation
  return {
    classification: { ...decision.classification, explanation },
    applied: decision.applied,
    vision: { ...vision, explanation, reviewTrigger: trigger ?? (similarity.review ? similarity.reason : null), similarityReview: similarity, reviewEnabled: enableReview || Boolean(similarityReview), reviewCalls: calls, categoryApplied: decision.applied, categoryDecision: decision.reason },
  }
}
