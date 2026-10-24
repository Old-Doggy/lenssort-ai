import type { CSSProperties } from 'react'
import RecommendationExplanation, { type RecommendationExplanationData } from './RecommendationExplanation'

type PhotoCardData = {
  id: string
  title: string
  label: 'person' | 'landscape' | 'other' | 'review'
  productLabel?: 'person' | 'landscape' | 'other' | 'review'
  score: number | null
  gradient?: string
  meta: string
  clarityScore?: number
  meanBrightness?: number
  exposureStatus?: 'balanced' | 'underexposed' | 'overexposed' | 'mixed'
  faceDetectionStatus?: 'not-run' | 'succeeded' | 'failed'
  faceCount?: number
  lowQuality?: boolean
  isNearDuplicate?: boolean
  similarityDistance?: number
  imageUrl?: string
  isImported?: boolean
  modelStatus?: 'not-run' | 'succeeded' | 'failed'
}

type Props = {
  photo: PhotoCardData
  score: number
  explanation: RecommendationExplanationData
  kept: boolean
  imageStyle?: CSSProperties
  onOpen: () => void
}

const labels = { person: '人物', landscape: '风景', other: '其他', review: '待确认' } as const
const exposureLabels = { balanced: '曝光均衡', underexposed: '偏暗', overexposed: '偏亮', mixed: '明暗反差大' } as const

export default function PhotoCard({ photo, score, explanation, kept, imageStyle, onOpen }: Props) {
  const label = photo.productLabel ?? photo.label
  return <article className="photo-card" onClick={onOpen}>
    <div className={`photo-image ${photo.gradient ?? ''}`} style={imageStyle}>
      <span className={`photo-badge ${label}`}>{photo.isImported && photo.modelStatus !== 'succeeded' ? '待分析' : labels[label]}</span>
      <span className={photo.score === null ? 'score-badge pending' : 'score-badge'}>{score}</span>
      {photo.isImported && photo.clarityScore !== undefined && <span className="clarity-badge">清晰度 {photo.clarityScore}</span>}
      {photo.isImported && photo.exposureStatus && <span className={`exposure-badge ${photo.exposureStatus}`}>{exposureLabels[photo.exposureStatus]}</span>}
      {photo.isImported && photo.faceDetectionStatus === 'succeeded' && <span className="face-badge">人脸 {photo.faceCount ?? 0}</span>}
      {photo.isImported && photo.lowQuality && <span className="quality-badge">质量风险</span>}
      {photo.isImported && photo.isNearDuplicate && <span className="similarity-badge">相似组</span>}
      {kept && <span className="feedback-badge">已保留</span>}
    </div>
    <div className="photo-card-body"><div><h3>{photo.title}</h3><p>{photo.meta}{photo.isImported && photo.clarityScore !== undefined ? ` · 清晰度 ${photo.clarityScore}` : ''}{photo.isImported && photo.meanBrightness !== undefined ? ` · 亮度 ${photo.meanBrightness}` : ''}{photo.isImported && photo.faceDetectionStatus === 'succeeded' ? ` · 人脸 ${photo.faceCount ?? 0}` : ''}{photo.isImported && photo.similarityDistance !== undefined ? ` · 哈希距离 ${photo.similarityDistance}` : ''}</p></div><button className="more-button" type="button" onClick={(event) => { event.stopPropagation(); onOpen() }}>···</button></div>
    <RecommendationExplanation explanation={explanation} compact />
  </article>
}
