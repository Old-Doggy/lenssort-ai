export type ProductLabel = 'person' | 'landscape' | 'other' | 'review'

export type ModelLabelCandidate = {
  label: string
  score: number
}

export type ProductLabelMapping = {
  label: ProductLabel
  confidence: number
  reason: string
}

const PRODUCT_MAPPING_THRESHOLD = 0.45

const PERSON_LABELS = new Set([
  'ballplayer, baseball player',
  'groom, bridegroom',
  'scuba diver',
])

const LANDSCAPE_LABELS = new Set([
  'alp',
  'cliff, drop, drop-off',
  'coral reef',
  'geyser',
  'lakeside, lakeshore',
  'promontory, headland, head, foreland',
  'seashore, coast, seacoast, sea-coast',
  'valley, vale',
  'volcano',
])

function normalizeLabel(label: string) {
  return label.trim().toLowerCase()
}

function formatConfidence(score: number) {
  return `${Math.round(score * 100)}%`
}

export function mapModelLabelToProductLabel(candidates: ModelLabelCandidate[]): ProductLabelMapping {
  const first = candidates[0]
  if (!first) {
    return { label: 'review', confidence: 0, reason: '模型没有返回可用标签，保留为待确认。' }
  }

  const normalized = normalizeLabel(first.label)
  if (first.score >= PRODUCT_MAPPING_THRESHOLD && PERSON_LABELS.has(normalized)) {
    return {
      label: 'person',
      confidence: first.score,
      reason: `原始标签“${first.label}”命中人物白名单，置信度 ${formatConfidence(first.score)}；仅作粗粒度候选，建议人工确认。`,
    }
  }

  if (first.score >= PRODUCT_MAPPING_THRESHOLD && LANDSCAPE_LABELS.has(normalized)) {
    return {
      label: 'landscape',
      confidence: first.score,
      reason: `原始标签“${first.label}”命中风景白名单，置信度 ${formatConfidence(first.score)}；仅作粗粒度候选，建议人工确认。`,
    }
  }

  if (first.score >= PRODUCT_MAPPING_THRESHOLD) {
    return {
      label: 'other',
      confidence: first.score,
      reason: `模型推理成功，但原始标签“${first.label}”未命中人物或风景白名单，归入其他，不作为确定结论。`,
    }
  }

  return {
    label: 'review',
    confidence: first.score,
    reason: `原始标签“${first.label}”置信度仅 ${formatConfidence(first.score)}，低于 ${formatConfidence(PRODUCT_MAPPING_THRESHOLD)} 映射门槛，保留为待确认。`,
  }
}
