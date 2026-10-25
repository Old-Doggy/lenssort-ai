import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, DragEvent } from 'react'
import './App.css'
import { clearPhotos, loadCurationState, loadPhotos, saveCurationState, savePhotos } from './storage'
import type { CurationState, FeedbackEvent, FeedbackEventType, StoredPhoto } from './storage'
import SimilarGroupCard from './SimilarGroupCard'
import PhotoSentiment from './PhotoSentiment'
import { classifyPhoto, ModelInferenceError } from './model'
import { mapModelLabelToProductLabel } from './product-labels'
import { detectFaces, FaceDetectionError } from './face-detector'
import { detectFaceLandmarks, FaceLandmarkerError } from './face-landmarker'
import { ClipEmbeddingError, cosineSimilarity, embedImage } from './clip-embedder'
import RecommendationExplanation, { type RecommendationExplanationData } from './RecommendationExplanation'
import PhotoCard from './PhotoCard'

type ProductLabel = 'person' | 'landscape' | 'other' | 'review'
type Filter = 'all' | ProductLabel | 'quality' | 'similar'
type Mode = 'travel' | 'people' | 'landscape'

type ClipEvalCase = {
  id: string
  title: string
  relation: 'similar' | 'different'
  path: string
}

type ClipEvalResult = {
  status: 'idle' | 'running' | 'succeeded' | 'failed'
  dimension?: number
  durationMs?: number
  vector?: number[]
  error?: string
}

type PhotoItem = {
  id: string
  title: string
  label: ProductLabel
  score: number | null
  reason: string
  gradient?: string
  meta: string
  clarityScore?: number
  clarityVariance?: number
  meanBrightness?: number
  underexposureRatio?: number
  overexposureRatio?: number
  exposureStatus?: 'balanced' | 'underexposed' | 'overexposed' | 'mixed'
  lowQuality?: boolean
  qualityReasons?: string[]
  dHash?: string
  pHash?: string
  similarityGroupId?: string
  similarityDistance?: number
  isNearDuplicate?: boolean
  clipSimilarityToRepresentative?: number
  clipSimilarityStatus?: 'not-run' | 'running' | 'succeeded' | 'failed'
  clipSimilarityDurationMs?: number
  clipSimilarityError?: string
  clipRepresentativeId?: string
  clipRepresentativeTitle?: string
  normalizedWidth?: number
  normalizedHeight?: number
  normalizationMode?: 'letterbox'
  normalizationScale?: number
  normalizationOffsetX?: number
  normalizationOffsetY?: number
  modelLabel?: string
  modelScore?: number
  modelDevice?: 'webgpu' | 'wasm'
  modelId?: string
  modelTopK?: Array<{ label: string; score: number }>
  modelDurationMs?: number
  modelStatus?: 'not-run' | 'succeeded' | 'failed'
  modelError?: string
  productLabel?: ProductLabel
  productLabelConfidence?: number
  productLabelReason?: string
  faceCount?: number
  faceAreaRatio?: number
  faceMaxConfidence?: number
  faceDetections?: Array<{ score: number; x: number; y: number; width: number; height: number }>
  faceDetectionDurationMs?: number
  faceDetectionStatus?: 'not-run' | 'succeeded' | 'failed'
  faceDetectionError?: string
  faceLandmarkCount?: number
  faceLandmarkPointCounts?: number[]
  faceBlendshapeCounts?: number[]
  closedEyeRisk?: number
  closedEyeStatus?: 'not-run' | 'no-face' | 'insufficient-data' | 'low' | 'review'
  closedEyeFaceResults?: Array<{ risk: number; status: 'insufficient-data' | 'low' | 'review'; leftScore?: number; rightScore?: number }>
  faceLandmarkerDurationMs?: number
  faceLandmarkerStatus?: 'not-run' | 'succeeded' | 'failed'
  faceLandmarkerError?: string
  imageUrl?: string
  isImported?: boolean
  width?: number
  height?: number
  thumbnail?: Blob
}

const GROUP_CLIP_TIMEOUT_MS = 15_000

let feedbackEventSequence = 0

function createFeedbackEvent(details: Omit<FeedbackEvent, 'id' | 'createdAt' | 'sequence'>): FeedbackEvent {
  const createdAt = Date.now()
  const sequence = feedbackEventSequence++
  const randomId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}-${sequence}`
  return { ...details, id: `${createdAt}-${sequence}-${randomId}`, createdAt, sequence }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ClipEmbeddingError(message)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function toStoredPhoto(photo: PhotoItem): StoredPhoto | null {
  if (!photo.thumbnail) return null
  return {
    id: photo.id,
    title: photo.title,
    label: photo.label,
    score: photo.score,
    reason: photo.reason,
    meta: photo.meta,
    clarityScore: photo.clarityScore ?? 0,
    clarityVariance: photo.clarityVariance ?? 0,
    meanBrightness: photo.meanBrightness ?? 0,
    underexposureRatio: photo.underexposureRatio ?? 0,
    overexposureRatio: photo.overexposureRatio ?? 0,
    exposureStatus: photo.exposureStatus ?? 'balanced',
    lowQuality: photo.lowQuality ?? false,
    qualityReasons: photo.qualityReasons ?? [],
    dHash: photo.dHash,
    pHash: photo.pHash,
    similarityGroupId: photo.similarityGroupId,
    similarityDistance: photo.similarityDistance,
    isNearDuplicate: photo.isNearDuplicate ?? false,
    clipSimilarityToRepresentative: photo.clipSimilarityToRepresentative,
    clipSimilarityStatus: photo.clipSimilarityStatus ?? 'not-run',
    clipSimilarityDurationMs: photo.clipSimilarityDurationMs,
    clipSimilarityError: photo.clipSimilarityError,
    clipRepresentativeId: photo.clipRepresentativeId,
    clipRepresentativeTitle: photo.clipRepresentativeTitle,
    normalizedWidth: photo.normalizedWidth,
    normalizedHeight: photo.normalizedHeight,
    normalizationMode: photo.normalizationMode,
    normalizationScale: photo.normalizationScale,
    normalizationOffsetX: photo.normalizationOffsetX,
    normalizationOffsetY: photo.normalizationOffsetY,
    modelLabel: photo.modelLabel,
    modelScore: photo.modelScore,
    modelDevice: photo.modelDevice,
    modelId: photo.modelId,
    modelTopK: photo.modelTopK,
    modelDurationMs: photo.modelDurationMs,
    modelStatus: photo.modelStatus ?? (photo.modelLabel ? 'succeeded' : 'not-run'),
    modelError: photo.modelError,
    productLabel: photo.productLabel,
    productLabelConfidence: photo.productLabelConfidence,
    productLabelReason: photo.productLabelReason,
    faceCount: photo.faceCount,
    faceAreaRatio: photo.faceAreaRatio,
    faceMaxConfidence: photo.faceMaxConfidence,
    faceDetections: photo.faceDetections,
    faceDetectionDurationMs: photo.faceDetectionDurationMs,
    faceDetectionStatus: photo.faceDetectionStatus ?? 'not-run',
    faceDetectionError: photo.faceDetectionError,
    faceLandmarkCount: photo.faceLandmarkCount,
    faceLandmarkPointCounts: photo.faceLandmarkPointCounts,
    faceBlendshapeCounts: photo.faceBlendshapeCounts,
    closedEyeRisk: photo.closedEyeRisk,
    closedEyeStatus: photo.closedEyeStatus ?? 'not-run',
    closedEyeFaceResults: photo.closedEyeFaceResults,
    faceLandmarkerDurationMs: photo.faceLandmarkerDurationMs,
    faceLandmarkerStatus: photo.faceLandmarkerStatus ?? 'not-run',
    faceLandmarkerError: photo.faceLandmarkerError,
    width: photo.width ?? 0,
    height: photo.height ?? 0,
    thumbnail: photo.thumbnail,
    createdAt: Date.now(),
  }
}

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const NORMALIZED_ANALYSIS_SIZE = 256

const clipEvalCases: ClipEvalCase[] = [
  { id: 'case11-a', title: '相似图 A · case11_rotate5_a', relation: 'similar', path: '/data/eval/similarity_cases_extra/case11_rotate5_a.png' },
  { id: 'case11-b', title: '相似图 B · case11_rotate5_b', relation: 'similar', path: '/data/eval/similarity_cases_extra/case11_rotate5_b.png' },
  { id: 'case19-a', title: '不同图 · case19_alt_scene_a_a', relation: 'different', path: '/data/eval/similarity_cases_extra/case19_alt_scene_a_a.png' },
]

const samplePhotos: PhotoItem[] = [
  { id: 'p1', title: '山谷日落', label: 'landscape', score: 96, reason: '风景主体完整，光线自然，重复度较低', gradient: 'photo-sunset', meta: '风景 · 1.8 MB' },
  { id: 'p2', title: '湖边人像', label: 'person', score: 94, reason: '人物清晰，环境光均衡，适合分享', gradient: 'photo-lake', meta: '单人 · 2.1 MB' },
  { id: 'p3', title: '山路合影', label: 'person', score: 91, reason: '检测到 3 张脸，人物状态良好', gradient: 'photo-trail', meta: '多人 · 2.4 MB' },
  { id: 'p4', title: '海边连拍 03', label: 'review', score: 82, reason: '与同组照片相似，建议人工确认', gradient: 'photo-sea', meta: '待确认 · 1.6 MB' },
  { id: 'p5', title: '城市夜景', label: 'landscape', score: 88, reason: '构图稳定，但暗部细节较少', gradient: 'photo-city', meta: '风景 · 1.9 MB' },
  { id: 'p6', title: '咖啡馆肖像', label: 'person', score: 86, reason: '人物清晰，检测到轻微闭眼风险', gradient: 'photo-cafe', meta: '单人 · 1.5 MB' },
]

const filterLabels: Record<Filter, string> = { all: '全部照片', person: '人物', landscape: '风景', other: '其他', review: '待确认', quality: '质量风险', similar: '相似照片' }
const productLabelLabels: Record<ProductLabel, string> = { person: '人物', landscape: '风景', other: '其他', review: '待确认' }
const modeLabels: Record<Mode, string> = { travel: '旅行记录', people: '人物精选', landscape: '风景精选' }
const MODE_STORAGE_KEY = 'lenssort-active-mode'
const FEEDBACK_SCORE_ADJUSTMENT = 8

function loadActiveMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY)
    return saved === 'travel' || saved === 'people' || saved === 'landscape' ? saved : 'travel'
  } catch {
    return 'travel'
  }
}

async function createStablePhotoId(file: File) {
  const source = `${file.name}|${file.size}|${file.lastModified}|${file.type}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `photo-${hash.slice(0, 16)}`
}

function calculateClarityScore(canvas: HTMLCanvasElement) {
  const maxSampleDimension = 320
  const scale = Math.min(1, maxSampleDimension / Math.max(canvas.width, canvas.height))
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = Math.max(3, Math.round(canvas.width * scale))
  sampleCanvas.height = Math.max(3, Math.round(canvas.height * scale))
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) throw new Error('无法创建清晰度分析画布')
  sampleContext.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height)
  const { data } = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height)
  const grayscale = new Float32Array(sampleCanvas.width * sampleCanvas.height)

  for (let index = 0; index < grayscale.length; index += 1) {
    const pixelIndex = index * 4
    grayscale[index] = data[pixelIndex] * 0.299 + data[pixelIndex + 1] * 0.587 + data[pixelIndex + 2] * 0.114
  }

  let sum = 0
  let squaredSum = 0
  let count = 0
  for (let y = 1; y < sampleCanvas.height - 1; y += 1) {
    for (let x = 1; x < sampleCanvas.width - 1; x += 1) {
      const index = y * sampleCanvas.width + x
      const laplacian = 4 * grayscale[index]
        - grayscale[index - 1]
        - grayscale[index + 1]
        - grayscale[index - sampleCanvas.width]
        - grayscale[index + sampleCanvas.width]
      sum += laplacian
      squaredSum += laplacian * laplacian
      count += 1
    }
  }

  const mean = sum / count
  const variance = Math.max(0, squaredSum / count - mean * mean)
  const clarityScore = Math.round(Math.min(100, Math.max(0, 12 + 11 * Math.log1p(variance))))
  return { clarityScore, clarityVariance: Math.round(variance * 100) / 100 }
}

function calculateExposureStats(canvas: HTMLCanvasElement): {
  meanBrightness: number
  underexposureRatio: number
  overexposureRatio: number
  exposureStatus: 'balanced' | 'underexposed' | 'overexposed' | 'mixed'
} {
  const maxSampleDimension = 320
  const scale = Math.min(1, maxSampleDimension / Math.max(canvas.width, canvas.height))
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = Math.max(1, Math.round(canvas.width * scale))
  sampleCanvas.height = Math.max(1, Math.round(canvas.height * scale))
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) throw new Error('无法创建曝光分析画布')
  sampleContext.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height)
  const { data } = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height)
  const pixelCount = sampleCanvas.width * sampleCanvas.height
  let brightnessSum = 0
  let underexposedPixels = 0
  let overexposedPixels = 0

  for (let index = 0; index < pixelCount; index += 1) {
    const pixelIndex = index * 4
    const brightness = data[pixelIndex] * 0.299 + data[pixelIndex + 1] * 0.587 + data[pixelIndex + 2] * 0.114
    brightnessSum += brightness
    if (brightness < 30) underexposedPixels += 1
    if (brightness > 245) overexposedPixels += 1
  }

  const meanBrightness = Math.round(brightnessSum / pixelCount)
  const underexposureRatio = Math.round((underexposedPixels / pixelCount) * 1000) / 1000
  const overexposureRatio = Math.round((overexposedPixels / pixelCount) * 1000) / 1000
  const hasSignificantUnderexposure = underexposureRatio >= 0.18
  const hasSignificantOverexposure = overexposureRatio >= 0.18
  const exposureStatus = hasSignificantUnderexposure && hasSignificantOverexposure
    ? 'mixed'
    : hasSignificantUnderexposure || meanBrightness < 78
      ? 'underexposed'
      : hasSignificantOverexposure || meanBrightness > 188
        ? 'overexposed'
        : 'balanced'

  return { meanBrightness, underexposureRatio, overexposureRatio, exposureStatus }
}

const exposureStatusLabels: Record<NonNullable<PhotoItem['exposureStatus']>, string> = {
  balanced: '曝光均衡',
  underexposed: '整体偏暗',
  overexposed: '整体偏亮',
  mixed: '明暗反差大',
}

function getExposureReason(stats: Pick<PhotoItem, 'meanBrightness' | 'underexposureRatio' | 'overexposureRatio' | 'exposureStatus'>) {
  const status = stats.exposureStatus ? exposureStatusLabels[stats.exposureStatus] : '待分析'
  const brightness = stats.meanBrightness ?? 0
  const underexposure = Math.round((stats.underexposureRatio ?? 0) * 100)
  const overexposure = Math.round((stats.overexposureRatio ?? 0) * 100)
  return `${status}，平均亮度 ${brightness}/255；欠曝区域约 ${underexposure}%，过曝区域约 ${overexposure}%`
}

function calculateQualityAssessment(photo: Pick<PhotoItem, 'clarityScore' | 'exposureStatus'>) {
  const qualityReasons: string[] = []
  if (photo.clarityScore !== undefined && photo.clarityScore < 45) qualityReasons.push('清晰度偏低')
  if (photo.exposureStatus === 'underexposed') qualityReasons.push('整体偏暗')
  if (photo.exposureStatus === 'overexposed') qualityReasons.push('整体偏亮')
  if (photo.exposureStatus === 'mixed') qualityReasons.push('明暗反差大')
  return { lowQuality: qualityReasons.length > 0, qualityReasons }
}

function getQualityReason(photo: Pick<PhotoItem, 'lowQuality' | 'qualityReasons'>) {
  if (!photo.lowQuality) return '未发现明显的清晰度或曝光风险'
  return `质量风险：${photo.qualityReasons?.join('、') ?? '需要人工复核'}`
}

function getClosedEyeReason(photo: Pick<PhotoItem, 'closedEyeStatus' | 'closedEyeRisk'>) {
  const risk = Math.round((photo.closedEyeRisk ?? 0) * 100)
  if (!photo.closedEyeStatus || photo.closedEyeStatus === 'not-run') return '闭眼风险尚未分析。'
  if (photo.closedEyeStatus === 'no-face') return '未检测到人脸，无法判断闭眼风险。'
  if (photo.closedEyeStatus === 'insufficient-data') return '眼部 blendshape 数据不足，建议人工确认。'
  if (photo.closedEyeStatus === 'review') return `闭眼风险评分约 ${risk}%，建议人工确认；静态照片不能替代连续视频判断。`
  if (photo.closedEyeStatus === 'low') return `闭眼风险评分约 ${risk}%，未发现明显闭眼风险；静态照片不能替代连续视频判断。`
  return '闭眼风险尚未分析。'
}

function getNormalizationReason(photo: Pick<PhotoItem, 'normalizedWidth' | 'normalizedHeight' | 'normalizationMode' | 'normalizationScale'>) {
  if (!photo.normalizedWidth || !photo.normalizedHeight) return '尺寸归一化待分析'
  const scale = photo.normalizationScale ? `，缩放比例 ${Math.round(photo.normalizationScale * 1000) / 1000}` : ''
  return `分析输入已统一为 ${photo.normalizedWidth} × ${photo.normalizedHeight}，保持比例补边${scale}`
}

function clampScore(value: number) {
  return Math.round(Math.min(100, Math.max(0, value)))
}

function getQualitySignal(photo: PhotoItem) {
  const clarity = photo.clarityScore ?? photo.score ?? 0
  const exposure = photo.exposureStatus === 'balanced' ? 100 : photo.exposureStatus === 'mixed' ? 45 : photo.exposureStatus ? 65 : 75
  const modelSignal = photo.modelStatus === 'succeeded' ? 10 : 0
  const qualityPenalty = photo.lowQuality ? 15 : 0
  return clampScore(clarity * 0.65 + exposure * 0.25 + modelSignal - qualityPenalty)
}

function getPersonSignal(photo: PhotoItem) {
  if (photo.faceDetectionStatus === 'succeeded') {
    return clampScore((photo.faceCount ?? 0) > 0 ? 55 + (photo.faceAreaRatio ?? 0) * 45 : 0)
  }
  return (photo.productLabel ?? photo.label) === 'person' ? 72 : 0
}

function getLandscapeSignal(photo: PhotoItem) {
  const label = photo.productLabel ?? photo.label
  if (label === 'landscape') return 100
  if (label === 'person') return 25
  if (label === 'other') return 45
  return 35
}

function getEyeSignal(photo: PhotoItem) {
  if (photo.closedEyeStatus === 'low') return 100
  if (photo.closedEyeStatus === 'review') return 45
  if (photo.closedEyeStatus === 'no-face') return 0
  if (photo.closedEyeRisk !== undefined) return clampScore((1 - photo.closedEyeRisk) * 100)
  return getPersonSignal(photo) > 0 ? 70 : 100
}

function getModeFitSignal(photo: PhotoItem, mode: Mode) {
  const label = photo.productLabel ?? photo.label
  const personSignal = getPersonSignal(photo)
  if (mode === 'people') return clampScore(personSignal * 0.75 + getEyeSignal(photo) * 0.25)
  if (mode === 'landscape') return getLandscapeSignal(photo)
  if (label === 'landscape' && personSignal > 0) return 100
  if (label === 'landscape' || label === 'person') return 88
  return 48
}

function getFeedbackAdjustment(photo: PhotoItem, sentiment: Record<string, 'like' | 'dislike'>) {
  if (sentiment[photo.id] === 'like') return FEEDBACK_SCORE_ADJUSTMENT
  if (sentiment[photo.id] === 'dislike') return -FEEDBACK_SCORE_ADJUSTMENT
  return 0
}

function calculateRecommendationScore(photo: PhotoItem, mode: Mode, sentiment: Record<string, 'like' | 'dislike'>) {
  return clampScore(getQualitySignal(photo) * 0.62 + getModeFitSignal(photo, mode) * 0.38 + getFeedbackAdjustment(photo, sentiment))
}

type ExportEligibility = {
  eligible: boolean
  state: 'demo' | 'auto' | 'manual-keep' | 'needs-review' | 'skipped'
  reason: string
}

function getExportEligibility(photo: PhotoItem, feedback: Record<string, 'keep' | 'skip'>, isDemo: boolean): ExportEligibility {
  const selection = feedback[photo.id]
  if (selection === 'skip') return { eligible: false, state: 'skipped', reason: '已按你的选择跳过，不会导出' }
  if (selection === 'keep') return { eligible: true, state: 'manual-keep', reason: '用户手动保留，覆盖自动筛选条件' }
  if (isDemo) return { eligible: true, state: 'demo', reason: '演示数据可用于展示导出流程' }
  const blockers: string[] = []
  if (photo.isNearDuplicate) blockers.push('属于相似组，尚未确认保留版本')
  if (photo.lowQuality) blockers.push('存在清晰度或曝光质量风险')
  if (photo.modelStatus !== 'succeeded') blockers.push('模型分析尚未成功完成')
  if (blockers.length > 0) return { eligible: false, state: 'needs-review', reason: `尚未自动导出：${blockers.join('；')}` }
  return { eligible: true, state: 'auto', reason: '已满足自动导出条件' }
}

function getBaseRecommendationReason(photo: PhotoItem) {
  const reasons: string[] = []
  if ((photo.clarityScore ?? 0) >= 70) reasons.push(`清晰度 ${photo.clarityScore}/100`)
  else if (photo.clarityScore !== undefined) reasons.push(`清晰度 ${photo.clarityScore}/100，建议与同组照片比较`)
  if (photo.exposureStatus === 'balanced') reasons.push('曝光均衡')
  else if (photo.exposureStatus) reasons.push(exposureStatusLabels[photo.exposureStatus])
  if (photo.faceDetectionStatus === 'succeeded' && (photo.faceCount ?? 0) > 0) reasons.push(`检测到 ${photo.faceCount} 张人脸`)
  if (photo.modelStatus === 'succeeded') reasons.push('模型分析已完成')
  if (reasons.length === 0) reasons.push('已有本地基础分析结果，建议人工确认')
  return reasons.join(' · ')
}

function getModeRecommendationReason(photo: PhotoItem, mode: Mode, sentiment: Record<string, 'like' | 'dislike'>) {
  const baseReason = getBaseRecommendationReason(photo)
  const label = photo.productLabel ?? photo.label
  const feedbackReason = sentiment[photo.id] === 'like'
    ? `用户偏好：已喜欢（+${FEEDBACK_SCORE_ADJUSTMENT}）`
    : sentiment[photo.id] === 'dislike'
      ? `用户偏好：不喜欢（-${FEEDBACK_SCORE_ADJUSTMENT}）`
      : ''
  if (mode === 'people') {
    const peopleReason = photo.faceDetectionStatus === 'succeeded'
      ? `人物精选：检测到 ${photo.faceCount ?? 0} 张人脸`
      : label === 'person' ? '人物精选：人物标签匹配' : '人物精选：未发现明确人物信号'
    const eyeReason = photo.closedEyeStatus === 'review' ? '闭眼风险需人工确认' : photo.closedEyeStatus === 'low' ? '未发现明显闭眼风险' : ''
    return [baseReason, peopleReason, eyeReason, feedbackReason].filter(Boolean).join(' · ')
  }
  if (mode === 'landscape') {
    return [baseReason, label === 'landscape' ? '风景精选：风景标签匹配' : '风景精选：非风景标签，排序靠后', feedbackReason].filter(Boolean).join(' · ')
  }
  return [baseReason, label === 'landscape' || label === 'person' ? '旅行记录：兼顾人物与风景' : '旅行记录：待确认照片排序靠后', feedbackReason].filter(Boolean).join(' · ')
}

function getRecommendationExplanation(photo: PhotoItem, mode: Mode, sentiment: Record<string, 'like' | 'dislike'>, curationFeedback: Record<string, 'keep' | 'skip'> = {}, isDemo = false): RecommendationExplanationData {
  const quality = getQualitySignal(photo)
  const modeFit = getModeFitSignal(photo, mode)
  const feedbackAdjustment = getFeedbackAdjustment(photo, sentiment)
  const total = calculateRecommendationScore(photo, mode, sentiment)
  const label = photo.productLabel ?? photo.label
  const eligibility = getExportEligibility(photo, curationFeedback, isDemo)
  const strengths: string[] = []
  const cautions: string[] = []

  if (isDemo) cautions.push('演示数据用于展示流程，不代表真实测量或模型精度')
  if (photo.clarityScore !== undefined) {
    if (photo.clarityScore >= 70) strengths.push(`清晰度 ${photo.clarityScore}/100（传统图像规则）`)
    else cautions.push(`清晰度 ${photo.clarityScore}/100，建议人工比较`)
  } else if (isDemo && photo.score !== null) {
    strengths.push(`演示基础评分 ${photo.score}/100，非实测清晰度`)
  } else {
    cautions.push('清晰度未知：尚未获得分析结果，评分使用已有基础值回退')
  }
  if (photo.exposureStatus === 'balanced') strengths.push('曝光均衡（传统像素统计）')
  else if (photo.exposureStatus) cautions.push(exposureStatusLabels[photo.exposureStatus])
  else if (!isDemo) cautions.push('曝光未知：尚未获得分析结果，评分使用默认回退值')

  if (photo.modelStatus === 'succeeded') strengths.push('分类模型分析已完成，不代表标签必然正确')
  else if (!isDemo) cautions.push(photo.modelStatus === 'failed' ? '模型分析失败，传统图像分析仍可使用' : '模型分析尚未完成，标签与模式匹配待确认')
  if (label === 'review') cautions.push('标签仍待确认：分类置信信号不足，需人工确认')
  if (photo.lowQuality) cautions.push(`质量风险：${photo.qualityReasons?.join('、') || '需要人工确认'}`)
  if (photo.isNearDuplicate) cautions.push('属于相似组；当前候选不等于已保留，需人工选择保留版本')

  if (photo.faceDetectionStatus === 'succeeded' && (photo.faceCount ?? 0) > 0) strengths.push(`检测到 ${photo.faceCount} 张人脸`)
  if (photo.faceDetectionStatus === 'failed') cautions.push('人脸检测失败：人脸状态未知，标签回退不等于实测')
  if (mode === 'people') {
    if (photo.faceDetectionStatus === 'succeeded' && (photo.faceCount ?? 0) === 0) cautions.push('当前未检测到人脸，不能据此断言照片没有人物')
    else if (!photo.faceDetectionStatus || photo.faceDetectionStatus === 'not-run') cautions.push('人脸检测尚未运行：人物信号未知，评分可能使用标签回退')
  }
  const shouldExplainEyes = mode === 'people' || label === 'person' || (photo.faceCount ?? 0) > 0
  if (!isDemo && shouldExplainEyes) {
    if (photo.faceLandmarkerStatus === 'failed') cautions.push('闭眼分析失败：眼部状态未知，需人工确认')
    else if (photo.closedEyeStatus === 'low') strengths.push('未发现明显闭眼风险；静态照片判断仍有局限')
    else if (photo.closedEyeStatus === 'review') cautions.push('存在闭眼风险，需要人工确认；不是闭眼事实判定')
    else if (photo.closedEyeStatus === 'insufficient-data') cautions.push('眼部数据不足：闭眼风险未知')
    else if (photo.closedEyeStatus === 'no-face') cautions.push('未检测到人脸：闭眼风险无法判断')
    else cautions.push('闭眼风险尚未分析：评分使用回退值，不代表眼睛正常')
  }

  if (mode === 'people' && label === 'person') strengths.push('人物标签与人物精选匹配')
  if (mode === 'landscape' && label === 'landscape') strengths.push('风景标签与风景精选匹配')
  if (mode === 'travel' && (label === 'person' || label === 'landscape')) strengths.push('人物或风景信号与旅行记录匹配')
  if (mode === 'landscape' && label !== 'landscape') cautions.push('非风景标签，风景模式匹配项较低；不是构图质量判断')
  if (sentiment[photo.id] === 'like') strengths.push(`已喜欢，偏好调整 +${FEEDBACK_SCORE_ADJUSTMENT}，不会自动确认保留`)
  if (sentiment[photo.id] === 'dislike') cautions.push(`已标记不喜欢，偏好调整 -${FEEDBACK_SCORE_ADJUSTMENT}，不会自动跳过`)
  if (eligibility.state === 'manual-keep') strengths.push('用户手动保留，覆盖自动筛选条件；风险记录仍保留')
  if (!eligibility.eligible) cautions.push(eligibility.reason)

  const needsReview = cautions.length > 0
  const status: RecommendationExplanationData['status'] = eligibility.state === 'skipped'
    ? 'skipped'
    : !eligibility.eligible || needsReview || isDemo
      ? 'review'
      : total >= 70 ? 'recommended' : total >= 55 ? 'review' : 'lower-priority'
  const statusLabel = eligibility.state === 'manual-keep'
    ? '已手动保留'
    : status === 'skipped' ? '已跳过' : isDemo ? '演示数据' : status === 'recommended' ? '规则推荐' : status === 'review' ? '建议人工确认' : '规则分偏低'
  const prefix = `当前${modeLabels[mode]}规则评分 ${total}/100`
  const summary = `${prefix}；${eligibility.reason}。${needsReview ? '仍有风险或未知项需要人工确认。' : '可结合实际观感复核。'}不会删除原图。`
  const reason = [summary, strengths.length > 0 ? `支持：${strengths.join('、')}` : '支持：暂无足够的已确认支持因素', cautions.length > 0 ? `注意：${cautions.join('、')}` : '注意：现有规则未提示风险，不代表已排除所有问题'].join(' · ')

  return { status, statusLabel, summary, reason, strengths, cautions, exportEligible: eligibility.eligible, exportState: eligibility.state, exportReason: eligibility.reason, scoreBreakdown: { quality, modeFit, feedback: feedbackAdjustment, total } }
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function toCsvCell(value: unknown) {
  const raw = value === null || value === undefined
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value)
  return `"${(raw ?? '').replaceAll('"', '""')}"`
}

function createNormalizedCanvas(source: HTMLCanvasElement, size = NORMALIZED_ANALYSIS_SIZE) {
  const normalizedCanvas = document.createElement('canvas')
  normalizedCanvas.width = size
  normalizedCanvas.height = size
  const context = normalizedCanvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建尺寸归一化画布')
  context.fillStyle = '#808080'
  context.fillRect(0, 0, size, size)
  const scale = Math.min(size / source.width, size / source.height)
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const offsetX = Math.floor((size - width) / 2)
  const offsetY = Math.floor((size - height) / 2)
  context.drawImage(source, offsetX, offsetY, width, height)
  return { canvas: normalizedCanvas, normalizedWidth: size, normalizedHeight: size, normalizationMode: 'letterbox' as const, normalizationScale: scale, normalizationOffsetX: offsetX, normalizationOffsetY: offsetY }
}

function grayscalePixels(canvas: HTMLCanvasElement, width: number, height: number) {
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = width
  sampleCanvas.height = height
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建相似度分析画布')
  context.drawImage(canvas, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  const grayscale = new Float32Array(width * height)
  for (let index = 0; index < grayscale.length; index += 1) {
    const pixelIndex = index * 4
    grayscale[index] = data[pixelIndex] * 0.299 + data[pixelIndex + 1] * 0.587 + data[pixelIndex + 2] * 0.114
  }
  return grayscale
}

function bitsToHex(bits: boolean[]) {
  let result = ''
  for (let index = 0; index < bits.length; index += 4) {
    let value = 0
    for (let offset = 0; offset < 4; offset += 1) value = value * 2 + (bits[index + offset] ? 1 : 0)
    result += value.toString(16)
  }
  return result
}

function calculatePerceptualHashes(normalizedCanvas: HTMLCanvasElement) {
  const dHashPixels = grayscalePixels(normalizedCanvas, 9, 8)
  const dHashBits: boolean[] = []
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) dHashBits.push(dHashPixels[y * 9 + x] > dHashPixels[y * 9 + x + 1])
  }

  const pHashSize = 32
  const pHashPixels = grayscalePixels(normalizedCanvas, pHashSize, pHashSize)
  const lowFrequency: number[] = []
  const coefficientSize = 8
  for (let v = 0; v < coefficientSize; v += 1) {
    for (let u = 0; u < coefficientSize; u += 1) {
      let sum = 0
      for (let y = 0; y < pHashSize; y += 1) {
        for (let x = 0; x < pHashSize; x += 1) {
          sum += pHashPixels[y * pHashSize + x]
            * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * pHashSize))
            * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * pHashSize))
        }
      }
      lowFrequency.push(sum)
    }
  }
  const median = [...lowFrequency.slice(1)].sort((a, b) => a - b)[Math.floor((lowFrequency.length - 2) / 2)]
  const pHashBits = lowFrequency.slice(1).map((value) => value > median)
  return { dHash: bitsToHex(dHashBits), pHash: bitsToHex(pHashBits) }
}

function hammingDistance(left?: string, right?: string) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY
  let distance = 0
  for (let index = 0; index < left.length; index += 1) {
    const xor = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16)
    distance += xor.toString(2).split('1').length - 1
  }
  return distance
}

function assignSimilarityGroups(photos: PhotoItem[]) {
  const parent = photos.map((_, index) => index)
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index])
    return parent[index]
  }
  const union = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }

  const pairDistances = new Map<string, number>()
  for (let left = 0; left < photos.length; left += 1) {
    for (let right = left + 1; right < photos.length; right += 1) {
      const dDistance = hammingDistance(photos[left].dHash, photos[right].dHash)
      const pDistance = hammingDistance(photos[left].pHash, photos[right].pHash)
      if (dDistance <= 6 && pDistance <= 12) {
        union(left, right)
        pairDistances.set(`${left}:${right}`, dDistance)
      }
    }
  }

  const components = new Map<number, number[]>()
  photos.forEach((_, index) => {
    const root = find(index)
    components.set(root, [...(components.get(root) ?? []), index])
  })
  const result: PhotoItem[] = photos.map((photo) => ({ ...photo, isNearDuplicate: false }))
  components.forEach((indexes) => {
    if (indexes.length < 2) return
    const groupId = `similar-${[...indexes].map((index) => photos[index].id).sort()[0].slice(-8)}`
    indexes.forEach((index) => {
      const distances = indexes
        .filter((other) => other !== index)
        .map((other) => pairDistances.get(`${Math.min(index, other)}:${Math.max(index, other)}`) ?? hammingDistance(photos[index].dHash, photos[other].dHash))
      result[index] = { ...result[index], similarityGroupId: groupId, similarityDistance: Math.min(...distances), isNearDuplicate: true }
    })
  })
  return result
}

async function createThumbnail(file: File) {
  const bitmap = await createImageBitmap(file)
  const maxDimension = 960
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('无法创建图片画布')
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const width = bitmap.width
  const height = bitmap.height
  bitmap.close()
  const normalized = createNormalizedCanvas(canvas)
  const { clarityScore, clarityVariance } = calculateClarityScore(canvas)
  const exposureStats = calculateExposureStats(canvas)
  const perceptualHashes = calculatePerceptualHashes(normalized.canvas)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
  if (!blob) throw new Error('无法生成缩略图')
  return {
    thumbnailUrl: URL.createObjectURL(blob),
    thumbnail: blob,
    width,
    height,
    clarityScore,
    clarityVariance,
    exposureStats,
    perceptualHashes,
    normalization: {
      normalizedWidth: normalized.normalizedWidth,
      normalizedHeight: normalized.normalizedHeight,
      normalizationMode: normalized.normalizationMode,
      normalizationScale: normalized.normalizationScale,
      normalizationOffsetX: normalized.normalizationOffsetX,
      normalizationOffsetY: normalized.normalizationOffsetY,
    },
  }
}

function App() {
  const [activeFilter, setActiveFilter] = useState<Filter>('all')
  const [activeMode, setActiveMode] = useState<Mode>(loadActiveMode)
  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, activeMode)
    } catch {
    }
  }, [activeMode])
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null)
  const [modelPhoto, setModelPhoto] = useState<PhotoItem | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [importedPhotos, setImportedPhotos] = useState<PhotoItem[]>([])
  const [rejectedCount, setRejectedCount] = useState(0)
  const [importError, setImportError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, 'keep' | 'skip'>>({})
  const [sentiment, setSentiment] = useState<Record<string, 'like' | 'dislike'>>({})
  const getRecommendationScore = useCallback((photo: PhotoItem, mode: Mode = activeMode) => calculateRecommendationScore(photo, mode, sentiment), [activeMode, sentiment])
  const getRecommendationExplanationForPhoto = useCallback((photo: PhotoItem) => getRecommendationExplanation(photo, activeMode, sentiment, feedback, !photo.isImported), [activeMode, feedback, sentiment])
  const getRecommendationReason = useCallback((photo: PhotoItem) => getRecommendationExplanationForPhoto(photo).reason, [getRecommendationExplanationForPhoto])
  const compareRecommendation = useCallback((left: PhotoItem, right: PhotoItem, mode: Mode = activeMode) => calculateRecommendationScore(right, mode, sentiment) - calculateRecommendationScore(left, mode, sentiment) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id), [activeMode, sentiment])
  const [groupChoices, setGroupChoices] = useState<Record<string, string>>({})
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [curationReady, setCurationReady] = useState(false)
  const [curationStatus, setCurationStatus] = useState('正在恢复本地选择…')
  const [curationError, setCurationError] = useState<string | null>(null)
  const curationRef = useRef<CurationState>({ feedback: {}, groupChoices: {}, sentiment: {} })
  const curationSaveRef = useRef<Promise<void>>(Promise.resolve())
  const pendingCurationRef = useRef<Array<{ state: CurationState; event?: FeedbackEvent }>>([])

  useEffect(() => {
    let cancelled = false
    loadCurationState().then((state) => {
      if (cancelled) return
      curationRef.current = state
      setFeedback(state.feedback)
      setSentiment(state.sentiment)
      setGroupChoices(state.groupChoices)
      setCurationStatus('本地选择已恢复')
    }).catch(() => {
      if (!cancelled) setCurationError('本地选择读取失败；本次操作可能无法保存')
    }).finally(() => {
      if (!cancelled) setCurationReady(true)
    })
    return () => { cancelled = true }
  }, [])
  const [modelLoadingId, setModelLoadingId] = useState<string | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [faceLoadingId, setFaceLoadingId] = useState<string | null>(null)
  const [faceError, setFaceError] = useState<string | null>(null)
  const [faceLandmarkerLoadingId, setFaceLandmarkerLoadingId] = useState<string | null>(null)
  const [faceLandmarkerError, setFaceLandmarkerError] = useState<string | null>(null)
  const [clipEvalRunning, setClipEvalRunning] = useState(false)
  const [clipEvalResults, setClipEvalResults] = useState<Record<string, ClipEvalResult>>(() => Object.fromEntries(clipEvalCases.map((item) => [item.id, { status: 'idle' }])))
  const [clipEvalError, setClipEvalError] = useState<string | null>(null)
  const [batchAnalysisRunning, setBatchAnalysisRunning] = useState(false)
  const [batchAnalysisCompleted, setBatchAnalysisCompleted] = useState(0)
  const [batchAnalysisError, setBatchAnalysisError] = useState<string | null>(null)
  const [groupClipRunning, setGroupClipRunning] = useState(false)
  const [groupClipCompleted, setGroupClipCompleted] = useState(0)
  const [groupClipTotal, setGroupClipTotal] = useState(0)
  const [groupClipCurrentTitle, setGroupClipCurrentTitle] = useState<string | null>(null)
  const [groupClipError, setGroupClipError] = useState<string | null>(null)

  const importedPhotosRef = useRef<PhotoItem[]>([])

  useEffect(() => {
    importedPhotosRef.current = importedPhotos
  }, [importedPhotos])

  useEffect(() => {
    let cancelled = false
    loadPhotos().then((storedPhotos) => {
      if (cancelled || storedPhotos.length === 0) return
      const restoredPhotos = assignSimilarityGroups(storedPhotos.map((photo) => ({
        id: photo.id,
        title: photo.title,
        label: photo.label,
        score: photo.score,
        reason: photo.reason,
        meta: photo.meta,
        clarityScore: photo.clarityScore,
        clarityVariance: photo.clarityVariance,
        meanBrightness: photo.meanBrightness ?? 0,
        underexposureRatio: photo.underexposureRatio ?? 0,
        overexposureRatio: photo.overexposureRatio ?? 0,
        exposureStatus: photo.exposureStatus ?? 'balanced',
        lowQuality: photo.lowQuality ?? false,
        qualityReasons: photo.qualityReasons ?? [],
        dHash: photo.dHash,
        pHash: photo.pHash,
         similarityGroupId: photo.similarityGroupId,
         similarityDistance: photo.similarityDistance,
         isNearDuplicate: photo.isNearDuplicate ?? false,
         clipSimilarityToRepresentative: photo.clipSimilarityToRepresentative,
         clipSimilarityStatus: photo.clipSimilarityStatus ?? 'not-run',
         clipSimilarityDurationMs: photo.clipSimilarityDurationMs,
         clipSimilarityError: photo.clipSimilarityError,
         clipRepresentativeId: photo.clipRepresentativeId,
         clipRepresentativeTitle: photo.clipRepresentativeTitle,
         normalizedWidth: photo.normalizedWidth,
        normalizedHeight: photo.normalizedHeight,
        normalizationMode: photo.normalizationMode,
        normalizationScale: photo.normalizationScale,
        normalizationOffsetX: photo.normalizationOffsetX,
        normalizationOffsetY: photo.normalizationOffsetY,
        modelLabel: photo.modelLabel,
        modelScore: photo.modelScore,
        modelDevice: photo.modelDevice,
        modelId: photo.modelId,
        modelTopK: photo.modelTopK,
        modelDurationMs: photo.modelDurationMs,
        modelStatus: photo.modelStatus ?? (photo.modelLabel ? 'succeeded' : 'not-run'),
        modelError: photo.modelError,
        productLabel: photo.productLabel ?? photo.label,
        productLabelConfidence: photo.productLabelConfidence,
        productLabelReason: photo.productLabelReason,
        faceCount: photo.faceCount,
        faceAreaRatio: photo.faceAreaRatio,
        faceMaxConfidence: photo.faceMaxConfidence,
        faceDetections: photo.faceDetections,
        faceDetectionDurationMs: photo.faceDetectionDurationMs,
        faceDetectionStatus: photo.faceDetectionStatus ?? 'not-run',
        faceDetectionError: photo.faceDetectionError,
        faceLandmarkCount: photo.faceLandmarkCount,
        faceLandmarkPointCounts: photo.faceLandmarkPointCounts,
        faceBlendshapeCounts: photo.faceBlendshapeCounts,
        closedEyeRisk: photo.closedEyeRisk,
        closedEyeStatus: photo.closedEyeStatus ?? 'not-run',
        closedEyeFaceResults: photo.closedEyeFaceResults,
        faceLandmarkerDurationMs: photo.faceLandmarkerDurationMs,
        faceLandmarkerStatus: photo.faceLandmarkerStatus ?? 'not-run',
        faceLandmarkerError: photo.faceLandmarkerError,
        imageUrl: URL.createObjectURL(photo.thumbnail),
        isImported: true,
        width: photo.width,
        height: photo.height,
        thumbnail: photo.thumbnail,
      })))
      setImportedPhotos(restoredPhotos)
      setBatchAnalysisCompleted(restoredPhotos.filter((photo) => photo.modelStatus === 'succeeded' || photo.modelStatus === 'failed').length)
    }).catch(() => {
      if (!cancelled) setImportError('无法恢复上次的本地照片，本次仍可继续导入')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => {
    importedPhotosRef.current.forEach((photo) => {
      if (photo.imageUrl) URL.revokeObjectURL(photo.imageUrl)
    })
  }, [])

  const photos = importedPhotos.length > 0 ? importedPhotos : samplePhotos
  const isDemo = importedPhotos.length === 0
  const visiblePhotos = useMemo(() => {
    const filteredPhotos = activeFilter === 'all'
      ? photos
      : activeFilter === 'quality'
        ? photos.filter((photo) => photo.lowQuality)
        : activeFilter === 'similar'
          ? photos.filter((photo) => photo.isNearDuplicate)
          : photos.filter((photo) => (photo.productLabel ?? photo.label) === activeFilter)
    return [...filteredPhotos].sort((left, right) => compareRecommendation(left, right, activeMode))
  }, [activeFilter, activeMode, compareRecommendation, photos])
  const filterCounts = useMemo(() => ({
    all: photos.length,
    person: photos.filter((photo) => (photo.productLabel ?? photo.label) === 'person').length,
    landscape: photos.filter((photo) => (photo.productLabel ?? photo.label) === 'landscape').length,
    other: photos.filter((photo) => (photo.productLabel ?? photo.label) === 'other').length,
    review: photos.filter((photo) => (photo.productLabel ?? photo.label) === 'review').length,
    quality: photos.filter((photo) => photo.lowQuality).length,
    similar: photos.filter((photo) => photo.isNearDuplicate).length,
  }), [photos])

  const [isDragging, setIsDragging] = useState(false)

  const importFiles = async (files: File[]) => {
    if (!curationReady) return
    if (files.length === 0) return
    setIsAnalyzing(true)
    setImportError(null)
    setRejectedCount(0)
    const nextPhotos: PhotoItem[] = []
    let rejected = 0

    for (const file of files) {
      try {
        if (!ACCEPTED_TYPES.has(file.type)) throw new Error('格式不支持')
        if (file.size > MAX_FILE_SIZE) throw new Error('文件超过 20 MB')
        const { thumbnailUrl, thumbnail, width, height, clarityScore, clarityVariance, exposureStats, perceptualHashes, normalization } = await createThumbnail(file)
        const qualityAssessment = calculateQualityAssessment({ clarityScore, exposureStatus: exposureStats.exposureStatus })
        const id = await createStablePhotoId(file)
        nextPhotos.push({
          id,
          title: file.name,
          label: 'review',
          score: null,
          reason: `已完成本地读取、缩略图生成、清晰度和曝光分析；清晰度 ${clarityScore}/100；${getExposureReason(exposureStats)}；等待 AI 分析`,
          meta: `待分析 · ${width} × ${height}`,
          clarityScore,
          clarityVariance,
          ...exposureStats,
          ...qualityAssessment,
          ...perceptualHashes,
          ...normalization,
          imageUrl: thumbnailUrl,
          isImported: true,
          width,
          height,
          thumbnail,
          modelStatus: 'not-run',
          productLabel: 'review',
          faceDetectionStatus: 'not-run',
          faceLandmarkerStatus: 'not-run',
        })
      } catch {
        rejected += 1
      }
    }

    const existingIds = new Set(importedPhotosRef.current.map((photo) => photo.id))
    const uniquePhotos = nextPhotos.filter((photo) => {
      if (existingIds.has(photo.id)) {
        if (photo.imageUrl) URL.revokeObjectURL(photo.imageUrl)
        return false
      }
      existingIds.add(photo.id)
      return true
    })

    if (uniquePhotos.length === 0 && rejected === 0) {
      setImportError('这些照片已经在当前列表中。')
    } else if (uniquePhotos.length === 0) {
      setImportError('没有成功读取可用图片，请选择 JPG、PNG 或 WebP 文件。')
    } else if (rejected > 0) {
      setImportError(`${rejected} 个文件未能读取，已加入 ${uniquePhotos.length} 张新照片。`)
    }
    if (uniquePhotos.length > 0) {
      const groupedPhotos = assignSimilarityGroups([...importedPhotosRef.current, ...uniquePhotos])
      const groupedNewPhotos = groupedPhotos.filter((photo) => uniquePhotos.some((newPhoto) => newPhoto.id === photo.id))
      setImportedPhotos(groupedPhotos)
      try {
        await savePhotos(groupedPhotos.flatMap((photo) => {
          const storedPhoto = toStoredPhoto(photo)
          return storedPhoto ? [storedPhoto] : []
        }))
        if (groupedNewPhotos.some((photo) => photo.isNearDuplicate)) setImportError('已完成相似照片检测：发现近重复照片，请人工确认保留版本')
      } catch {
        setImportError('照片已显示，但本地持久化失败；刷新页面后可能需要重新导入')
      }
    }
    setRejectedCount(rejected)
    setIsAnalyzing(false)
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    await importFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setIsDragging(false)
    await importFiles(Array.from(event.dataTransfer.files))
  }

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }

  const clearLibrary = () => {
    if (isAnalyzing || batchAnalysisRunning || groupClipRunning || modelLoadingId || faceLoadingId || faceLandmarkerLoadingId) {
      setCurationError('请等待当前分析结束后再清除，避免分析结果重新写入。')
      return
    }
    setCurationReady(false)
    importedPhotosRef.current.forEach((photo) => {
      if (photo.imageUrl) URL.revokeObjectURL(photo.imageUrl)
    })
    setImportedPhotos([])
    importedPhotosRef.current = []
    setRejectedCount(0)
    setImportError(null)
    setActiveFilter('all')
    setFeedback({})
    setSentiment({})
    setGroupChoices({})
    setExpandedGroups({})
    curationRef.current = { feedback: {}, groupChoices: {}, sentiment: {} }
    setCurationError(null)
    setCurationStatus('正在清除本地选择…')
    setSelectedPhoto(null)
    setModelPhoto(null)
    setIsDragging(false)
    setBatchAnalysisRunning(false)
    setBatchAnalysisCompleted(0)
    setBatchAnalysisError(null)
    curationSaveRef.current = curationSaveRef.current.then(clearPhotos)
      .then(() => {
        pendingCurationRef.current = []
        setCurationStatus('照片和本地选择已清除')
      })
      .catch(() => setCurationError('照片已从当前页面移除，但本地存储清除失败；刷新前请重试清除'))
      .finally(() => setCurationReady(true))
  }

  const updateCuration = (state: CurationState, event?: FeedbackEvent) => {
    curationRef.current = state
    setFeedback(state.feedback)
    setSentiment(state.sentiment)
    setGroupChoices(state.groupChoices)
    if (importedPhotosRef.current.length === 0) {
      setCurationStatus('演示选择仅在本页生效')
      return
    }
    setCurationError(null)
    setCurationStatus('正在保存本地选择…')
    if (event || pendingCurationRef.current.length === 0) pendingCurationRef.current.push({ state, event })
    curationSaveRef.current = curationSaveRef.current.then(async () => {
      while (pendingCurationRef.current.length > 0) {
        const pending = pendingCurationRef.current[0]
        await saveCurationState(pending.state, pending.event)
        pendingCurationRef.current.shift()
      }
    })
      .then(() => {
        if (pendingCurationRef.current.length === 0) {
          setCurationError(null)
          setCurationStatus('本地选择已保存')
        }
      })
      .catch(() => {
        setCurationError('本地选择保存失败；当前页面仍可操作，但刷新后可能丢失，请重试选择')
        setCurationStatus('选择暂未保存')
      })
  }

  const setPhotoFeedback = (id: string, value?: 'keep' | 'skip') => {
    if (!curationReady) return
    const previousValue = curationRef.current.feedback[id]
    const nextFeedback = { ...curationRef.current.feedback }
    if (value) nextFeedback[id] = value
    else delete nextFeedback[id]
    const photo = importedPhotosRef.current.find((item) => item.id === id) ?? photos.find((item) => item.id === id)
    const event = createFeedbackEvent({
      photoId: id,
      photoTitle: photo?.title,
      groupId: photo?.similarityGroupId,
      type: value ?? 'clear-feedback',
      previousValue,
      nextValue: value,
    })
    updateCuration({ ...curationRef.current, feedback: nextFeedback }, event)
  }

  const setPhotoSentiment = (id: string, value?: 'like' | 'dislike') => {
    if (!curationReady) return
    const previousValue = curationRef.current.sentiment[id]
    const nextValue = previousValue === value ? undefined : value
    const nextSentiment = { ...curationRef.current.sentiment }
    if (nextValue) nextSentiment[id] = nextValue
    else delete nextSentiment[id]
    const photo = importedPhotosRef.current.find((item) => item.id === id) ?? photos.find((item) => item.id === id)
    const event = createFeedbackEvent({
      photoId: id,
      photoTitle: photo?.title,
      groupId: photo?.similarityGroupId,
      type: nextValue ?? 'clear-sentiment',
      previousValue,
      nextValue,
    })
    updateCuration({ ...curationRef.current, sentiment: nextSentiment }, event)
  }

  const resetPreferences = () => {
    if (!curationReady) return
    const affectedPhotoIds = Object.keys(curationRef.current.sentiment)
    if (affectedPhotoIds.length === 0) return
    const confirmed = window.confirm('恢复默认偏好？这会清除喜欢/不喜欢并恢复默认排序权重，但不会删除照片、分析结果、保留/跳过选择或相似组候选。')
    if (!confirmed) return
    const event = createFeedbackEvent({
      photoId: 'preferences',
      photoTitle: '全部照片',
      type: 'reset-preferences',
      previousValue: `${affectedPhotoIds.length} 张照片存在喜欢/不喜欢偏好`,
      nextValue: 'default',
      affectedPhotoIds,
    })
    updateCuration({ ...curationRef.current, sentiment: {} }, event)
  }

  const chooseGroupPhoto = (groupId: string, photoId?: string) => {
    if (!curationReady) return
    const group = photos.filter((photo) => photo.similarityGroupId === groupId).sort((left, right) => compareRecommendation(left, right, activeMode))
    const automatic = group[0]
    if (!automatic || (photoId && !group.some((photo) => photo.id === photoId))) return
    const previousValue = curationRef.current.groupChoices[groupId] ?? automatic.id
    const nextChoices = { ...curationRef.current.groupChoices }
    if (photoId) nextChoices[groupId] = photoId
    else delete nextChoices[groupId]
    const chosenPhotoId = photoId ?? automatic.id
    const photo = importedPhotosRef.current.find((item) => item.id === chosenPhotoId) ?? photos.find((item) => item.id === chosenPhotoId)
    const eventType: FeedbackEventType = photoId ? 'choose-candidate' : 'reset-candidate'
    const event = createFeedbackEvent({
      photoId: chosenPhotoId,
      photoTitle: photo?.title,
      groupId,
      type: eventType,
      previousValue,
      nextValue: chosenPhotoId,
    })
    updateCuration({ ...curationRef.current, groupChoices: nextChoices }, event)
  }


  const formatModelError = (error: unknown) => {
    if (error instanceof ModelInferenceError) {
      const causes = Object.entries(error.causeByDevice)
        .map(([device, message]) => `${device}: ${message}`)
        .join('；')
      return `${error.message} 本次尝试：${causes}`
    }
    return error instanceof Error ? error.message : 'MobileNetV4 推理失败'
  }

  const savePhotoCollection = async (photos: PhotoItem[]) => {
    await savePhotos(photos.flatMap((photo) => {
      const storedPhoto = toStoredPhoto(photo)
      return storedPhoto ? [storedPhoto] : []
    }))
  }

  const runModelClassification = async () => {
    if (!modelPhoto?.isImported || !modelPhoto.thumbnail) return
    const photoId = modelPhoto.id
    setModelLoadingId(photoId)
    setModelError(null)
    try {
      const result = await classifyPhoto(modelPhoto.thumbnail)
      const productMapping = mapModelLabelToProductLabel(result.topK)
      const updatedPhotos = importedPhotosRef.current.map((photo) => photo.id === photoId
        ? {
            ...photo,
            label: productMapping.label,
            productLabel: productMapping.label,
            productLabelConfidence: productMapping.confidence,
            productLabelReason: productMapping.reason,
            meta: `${productLabelLabels[productMapping.label]} · ${photo.width} × ${photo.height}`,
            reason: `${photo.reason.split('；等待 AI 分析')[0]}；${productMapping.reason}`,
            modelLabel: result.label,
            modelScore: result.score,
            modelDevice: result.device,
            modelId: result.modelId,
            modelTopK: result.topK,
            modelDurationMs: result.durationMs,
            modelStatus: 'succeeded' as const,
            modelError: undefined,
          }
        : photo)
      const updatedPhoto = updatedPhotos.find((photo) => photo.id === photoId)
      setImportedPhotos(updatedPhotos)
      if (updatedPhoto) setSelectedPhoto(updatedPhoto)
      if (updatedPhoto) setModelPhoto(updatedPhoto)
      await savePhotos(updatedPhotos.flatMap((photo) => {
        const storedPhoto = toStoredPhoto(photo)
        return storedPhoto ? [storedPhoto] : []
      }))
    } catch (error) {
      if (error instanceof ModelInferenceError) {
        const message = formatModelError(error)
        const updatedPhotos = importedPhotosRef.current.map((photo) => photo.id === photoId
          ? { ...photo, modelStatus: 'failed' as const, modelError: message }
          : photo)
        const updatedPhoto = updatedPhotos.find((photo) => photo.id === photoId)
        setImportedPhotos(updatedPhotos)
        if (updatedPhoto) setModelPhoto(updatedPhoto)
        if (updatedPhoto) setSelectedPhoto(updatedPhoto)
        setModelError(message)
        try {
          await savePhotoCollection(updatedPhotos)
        } catch {
          setModelError(`${message}；模型失败状态暂未成功保存到本地`)
        }
      } else {
        setModelError(error instanceof Error ? error.message : 'MobileNetV4 推理失败')
      }
    } finally {
      setModelLoadingId(null)
    }
  }

  const runBatchModelClassification = async () => {
    if (batchAnalysisRunning || importedPhotosRef.current.length === 0) return
    const batchPhotos = importedPhotosRef.current.filter((photo) => photo.isImported && photo.thumbnail)
    if (batchPhotos.length === 0) return
    setBatchAnalysisRunning(true)
    setBatchAnalysisCompleted(0)
    setBatchAnalysisError(null)
    let workingPhotos = importedPhotosRef.current.map((photo) => photo.modelStatus === 'succeeded' || photo.modelStatus === 'failed'
      ? { ...photo, modelStatus: 'not-run' as const, modelError: undefined, faceDetectionStatus: 'not-run' as const, faceDetectionError: undefined }
      : photo)
    importedPhotosRef.current = workingPhotos
    setImportedPhotos(workingPhotos)

    for (const photo of batchPhotos) {
      if (!photo.thumbnail) continue
      let nextPhoto: PhotoItem
      try {
        const result = await classifyPhoto(photo.thumbnail)
        const productMapping = mapModelLabelToProductLabel(result.topK)
        nextPhoto = {
          ...photo,
          label: productMapping.label,
          productLabel: productMapping.label,
          productLabelConfidence: productMapping.confidence,
          productLabelReason: productMapping.reason,
          meta: `${productLabelLabels[productMapping.label]} · ${photo.width} × ${photo.height}`,
          reason: `${photo.reason.split('；等待 AI 分析')[0]}；${productMapping.reason}`,
          modelLabel: result.label,
          modelScore: result.score,
          modelDevice: result.device,
          modelId: result.modelId,
          modelTopK: result.topK,
          modelDurationMs: result.durationMs,
          modelStatus: 'succeeded',
          modelError: undefined,
        }
      } catch (error) {
        nextPhoto = { ...photo, modelStatus: 'failed', modelError: formatModelError(error) }
      }
      try {
        const faceResult = await detectFaces(photo.thumbnail)
        nextPhoto = {
          ...nextPhoto,
          faceCount: faceResult.faceCount,
          faceAreaRatio: faceResult.faceAreaRatio,
          faceMaxConfidence: faceResult.maxConfidence,
          faceDetections: faceResult.detections,
          faceDetectionDurationMs: faceResult.durationMs,
          faceDetectionStatus: 'succeeded',
          faceDetectionError: undefined,
        }
      } catch (error) {
        const message = error instanceof FaceDetectionError
          ? error.message
          : error instanceof Error ? error.message : '人脸检测失败'
        nextPhoto = { ...nextPhoto, faceDetectionStatus: 'failed', faceDetectionError: message }
      }
      workingPhotos = workingPhotos.map((item) => item.id === nextPhoto.id ? nextPhoto : item)
      importedPhotosRef.current = workingPhotos
      setImportedPhotos(workingPhotos)
      if (modelPhoto?.id === nextPhoto.id) setModelPhoto(nextPhoto)
      if (selectedPhoto?.id === nextPhoto.id) setSelectedPhoto(nextPhoto)
      try {
        await savePhotoCollection(workingPhotos)
      } catch (error) {
        setBatchAnalysisError(error instanceof Error ? `批量分析结果保存失败：${error.message}` : '批量分析结果保存失败')
      }
      setBatchAnalysisCompleted((current) => current + 1)
    }
    setBatchAnalysisRunning(false)
  }

  const runFaceDetection = async () => {
    if (!modelPhoto?.isImported || !modelPhoto.thumbnail) return
    const photoId = modelPhoto.id
    setFaceLoadingId(photoId)
    setFaceError(null)
    try {
      const result = await detectFaces(modelPhoto.thumbnail)
      const updatedPhotos = importedPhotosRef.current.map((photo) => photo.id === photoId
        ? {
            ...photo,
            faceCount: result.faceCount,
            faceAreaRatio: result.faceAreaRatio,
            faceMaxConfidence: result.maxConfidence,
            faceDetections: result.detections,
            faceDetectionDurationMs: result.durationMs,
            faceDetectionStatus: 'succeeded' as const,
            faceDetectionError: undefined,
          }
        : photo)
      const updatedPhoto = updatedPhotos.find((photo) => photo.id === photoId)
      setImportedPhotos(updatedPhotos)
      if (updatedPhoto) setSelectedPhoto(updatedPhoto)
      if (updatedPhoto) setModelPhoto(updatedPhoto)
      await savePhotos(updatedPhotos.flatMap((photo) => {
        const storedPhoto = toStoredPhoto(photo)
        return storedPhoto ? [storedPhoto] : []
      }))
    } catch (error) {
      const message = error instanceof FaceDetectionError
        ? error.message
        : error instanceof Error ? error.message : '人脸检测失败'
      const updatedPhotos = importedPhotosRef.current.map((photo) => photo.id === photoId
        ? { ...photo, faceDetectionStatus: 'failed' as const, faceDetectionError: message }
        : photo)
      const updatedPhoto = updatedPhotos.find((photo) => photo.id === photoId)
      setImportedPhotos(updatedPhotos)
      if (updatedPhoto) setModelPhoto(updatedPhoto)
      if (updatedPhoto) setSelectedPhoto(updatedPhoto)
      setFaceError(message)
      try {
        await savePhotos(updatedPhotos.flatMap((photo) => {
          const storedPhoto = toStoredPhoto(photo)
          return storedPhoto ? [storedPhoto] : []
        }))
      } catch {
        setFaceError(`${message}；人脸检测失败状态暂未成功保存到本地`)
      }
    } finally {
      setFaceLoadingId(null)
    }
  }

  const runFaceLandmarker = async () => {
    if (!modelPhoto?.isImported || !modelPhoto.thumbnail) return
    const photoId = modelPhoto.id
    setFaceLandmarkerLoadingId(photoId)
    setFaceLandmarkerError(null)
    try {
      const result = await detectFaceLandmarks(modelPhoto.thumbnail)
      const updatedPhotos = importedPhotosRef.current.map((photo) => photo.id === photoId
        ? {
            ...photo,
            faceLandmarkCount: result.faceCount,
            faceLandmarkPointCounts: result.landmarkPointCounts,
            faceBlendshapeCounts: result.blendshapeCounts,
            closedEyeRisk: result.closedEyeRisk,
            closedEyeStatus: result.closedEyeStatus,
            closedEyeFaceResults: result.closedEyeFaceResults,
            faceLandmarkerDurationMs: result.durationMs,
            faceLandmarkerStatus: 'succeeded' as const,
            faceLandmarkerError: undefined,
          }
        : photo)
      const updatedPhoto = updatedPhotos.find((photo) => photo.id === photoId)
      setImportedPhotos(updatedPhotos)
      if (updatedPhoto) setSelectedPhoto(updatedPhoto)
      if (updatedPhoto) setModelPhoto(updatedPhoto)
      await savePhotos(updatedPhotos.flatMap((photo) => {
        const storedPhoto = toStoredPhoto(photo)
        return storedPhoto ? [storedPhoto] : []
      }))
    } catch (error) {
      const message = error instanceof FaceLandmarkerError
        ? error.message
        : error instanceof Error ? error.message : '人脸关键点检测失败'
      const updatedPhotos = importedPhotosRef.current.map((photo) => photo.id === photoId
        ? { ...photo, faceLandmarkerStatus: 'failed' as const, faceLandmarkerError: message }
        : photo)
      const updatedPhoto = updatedPhotos.find((photo) => photo.id === photoId)
      setImportedPhotos(updatedPhotos)
      if (updatedPhoto) setModelPhoto(updatedPhoto)
      if (updatedPhoto) setSelectedPhoto(updatedPhoto)
      setFaceLandmarkerError(message)
      try {
        await savePhotos(updatedPhotos.flatMap((photo) => {
          const storedPhoto = toStoredPhoto(photo)
          return storedPhoto ? [storedPhoto] : []
        }))
      } catch {
        setFaceLandmarkerError(`${message}；人脸关键点失败状态暂未成功保存到本地`)
      }
    } finally {
      setFaceLandmarkerLoadingId(null)
    }
  }

  const runClipEvaluation = async () => {
    if (clipEvalRunning) return
    setClipEvalRunning(true)
    setClipEvalError(null)
    setClipEvalResults(Object.fromEntries(clipEvalCases.map((item) => [item.id, { status: 'running' }])))
    try {
      const results: Record<string, ClipEvalResult> = {}
      for (const evaluationCase of clipEvalCases) {
        try {
          const response = await fetch(evaluationCase.path, { cache: 'no-store' })
          if (!response.ok) throw new Error(`评测图片 HTTP ${response.status}`)
          const embedding = await embedImage(await response.blob())
          results[evaluationCase.id] = { status: 'succeeded', ...embedding }
        } catch (error) {
          const message = error instanceof ClipEmbeddingError
            ? error.message
            : error instanceof Error ? error.message : 'CLIP embedding 失败'
          results[evaluationCase.id] = { status: 'failed', error: message }
        }
        setClipEvalResults({ ...results })
      }
    } catch (error) {
      setClipEvalError(error instanceof Error ? error.message : 'CLIP 三图验证失败')
    } finally {
      setClipEvalRunning(false)
    }
  }

  const clipEvalSimilarity = cosineSimilarity(clipEvalResults['case11-a']?.vector ?? [], clipEvalResults['case11-b']?.vector ?? [])
  const clipEvalDifference = cosineSimilarity(clipEvalResults['case11-a']?.vector ?? [], clipEvalResults['case19-a']?.vector ?? [])
  const similarGroups = useMemo(() => {
    const groups = new Map<string, PhotoItem[]>()
    photos.filter((photo) => photo.isNearDuplicate && photo.similarityGroupId).forEach((photo) => {
      const group = groups.get(photo.similarityGroupId!) ?? []
      group.push(photo)
      groups.set(photo.similarityGroupId!, group)
    })
    return [...groups.entries()].map(([groupId, groupPhotos]) => {
      const rankedPhotos = [...groupPhotos].sort((left, right) => compareRecommendation(left, right, activeMode))
      const automatic = rankedPhotos[0]
      const representative = rankedPhotos.find((photo) => photo.id === groupChoices[groupId]) ?? automatic
      const clipResults = groupPhotos
        .filter((photo) => photo.clipSimilarityStatus === 'succeeded')
        .map((photo) => photo.clipSimilarityToRepresentative)
        .filter((similarity): similarity is number => similarity !== undefined)
      const clipSucceeded = groupPhotos.filter((photo) => photo.clipSimilarityStatus === 'succeeded').length
      const clipFailed = groupPhotos.filter((photo) => photo.clipSimilarityStatus === 'failed').length
      const clipAverage = clipResults.length > 0
        ? Math.round((clipResults.reduce((sum, value) => sum + value, 0) / clipResults.length) * 1000) / 1000
        : null
      const clipReason = clipAverage === null
        ? ''
        : `CLIP 组内平均相似度 ${clipAverage}`
      return {
        groupId,
        photos: rankedPhotos,
        representative,
        automatic,
        clipReference: [...new Set(groupPhotos.filter((photo) => photo.clipSimilarityStatus === 'succeeded').map((photo) => photo.clipRepresentativeTitle ?? '旧结果未记录参照图；需重新运行验证'))].join('、'),
        reason: [getModeRecommendationReason(representative, activeMode, sentiment), clipReason].filter(Boolean).join(' · '),
        clipSucceeded,
        clipFailed,
        clipAverage,
      }
    })
  }, [activeMode, compareRecommendation, photos, groupChoices, sentiment])

  const runGroupClipAnalysis = async () => {
    if (groupClipRunning) return
    const candidates = importedPhotosRef.current.filter((photo) => photo.isNearDuplicate && photo.similarityGroupId && photo.thumbnail)
    if (candidates.length < 2) {
      setGroupClipError('当前没有至少包含两张照片的相似组，暂不运行 CLIP 组内验证。')
      return
    }
    const groups = new Map<string, PhotoItem[]>()
    candidates.forEach((photo) => {
      const group = groups.get(photo.similarityGroupId!) ?? []
      group.push(photo)
      groups.set(photo.similarityGroupId!, group)
    })
    const workItems = [...groups.values()].flatMap((groupPhotos) => {
      const representative = [...groupPhotos].sort((left, right) => compareRecommendation(left, right, activeMode))[0]
      return groupPhotos.filter((photo) => photo.id !== representative.id).map((photo) => ({ photo, representative }))
    })
    setGroupClipRunning(true)
    setGroupClipCompleted(0)
    setGroupClipTotal(workItems.length)
    setGroupClipCurrentTitle(null)
    setGroupClipError(null)
    let workingPhotos = importedPhotosRef.current
    try {
      const representativeVectors = new Map<string, number[] | null>()
      const representativeErrors = new Map<string, string>()
      for (const { photo, representative } of workItems) {
        setGroupClipCurrentTitle(photo.title)
        workingPhotos = workingPhotos.map((item) => item.id === photo.id
          ? { ...item, clipSimilarityToRepresentative: undefined, clipSimilarityDurationMs: undefined, clipSimilarityStatus: 'running' as const, clipSimilarityError: undefined }
          : item)
        importedPhotosRef.current = workingPhotos
        setImportedPhotos(workingPhotos)
        try {
          if (representativeErrors.has(representative.id)) {
            throw new ClipEmbeddingError(representativeErrors.get(representative.id)!)
          }
          let representativeVector = representativeVectors.get(representative.id)
          if (representativeVector === undefined) {
            try {
              const representativeResult = await withTimeout(
                embedImage(representative.thumbnail!),
                GROUP_CLIP_TIMEOUT_MS,
                `CLIP 推理超时：${representative.title}`,
              )
              representativeVector = representativeResult.vector
              representativeVectors.set(representative.id, representativeVector)
            } catch (error) {
              const message = error instanceof ClipEmbeddingError
                ? error.message
                : error instanceof Error ? error.message : 'CLIP 代表图推理失败'
              representativeErrors.set(representative.id, message)
              representativeVectors.set(representative.id, null)
              throw new ClipEmbeddingError(message)
            }
          }
          if (!representativeVector) throw new ClipEmbeddingError('CLIP 代表图没有返回有效向量')
          const startedAt = performance.now()
          const photoResult = await withTimeout(
            embedImage(photo.thumbnail!),
            GROUP_CLIP_TIMEOUT_MS,
            `CLIP 推理超时：${photo.title}`,
          )
          const similarity = cosineSimilarity(representativeVector, photoResult.vector)
          if (similarity === null) throw new Error('CLIP 向量维度不一致')
          const durationMs = Math.round(performance.now() - startedAt)
          workingPhotos = workingPhotos.map((item) => item.id === photo.id
            ? { ...item, clipSimilarityToRepresentative: similarity, clipSimilarityStatus: 'succeeded' as const, clipSimilarityDurationMs: durationMs, clipSimilarityError: undefined, clipRepresentativeId: representative.id, clipRepresentativeTitle: representative.title }
            : item)
        } catch (error) {
          const message = error instanceof ClipEmbeddingError
            ? error.message
            : error instanceof Error ? error.message : 'CLIP 组内相似度计算失败'
          workingPhotos = workingPhotos.map((item) => item.id === photo.id
            ? { ...item, clipSimilarityToRepresentative: undefined, clipSimilarityDurationMs: undefined, clipSimilarityStatus: 'failed' as const, clipSimilarityError: message }
            : item)
          setGroupClipError(`部分相似组未完成 CLIP 验证：${message}`)
        }
        importedPhotosRef.current = workingPhotos
        setImportedPhotos(workingPhotos)
        try {
          await savePhotoCollection(workingPhotos)
        } catch (error) {
          setGroupClipError(error instanceof Error ? `CLIP 结果保存失败：${error.message}` : 'CLIP 结果保存失败')
        }
        setGroupClipCompleted((current) => current + 1)
      }
    } finally {
      setGroupClipCurrentTitle(null)
      setGroupClipRunning(false)
    }
  }

  const exportSelection = (format: 'json' | 'csv') => {
    const selected = photos
      .filter((photo) => getExportEligibility(photo, feedback, isDemo).eligible)
      .sort(compareRecommendation)
      .map((photo) => {
        const explanation = getRecommendationExplanation(photo, activeMode, sentiment, feedback, isDemo)
        const eligibility = getExportEligibility(photo, feedback, isDemo)
        return {
          id: photo.id,
          title: photo.title,
          label: productLabelLabels[photo.productLabel ?? photo.label],
          recommendationScore: getRecommendationScore(photo, activeMode),
          reason: explanation.reason,
          recommendationStatus: explanation.status,
          recommendationStatusLabel: explanation.statusLabel,
          recommendationSummary: explanation.summary,
          exportState: eligibility.state,
          exportReason: eligibility.reason,
          supportingFactors: explanation.strengths,
          cautionFactors: explanation.cautions,
          scoreBreakdown: explanation.scoreBreakdown,
          clarityScore: photo.clarityScore ?? null,
          exposureStatus: photo.exposureStatus ? exposureStatusLabels[photo.exposureStatus] : null,
          faceCount: photo.faceCount ?? null,
          similarityGroupId: photo.similarityGroupId ?? null,
        }
      })
    if (format === 'json') {
      downloadTextFile('lenssort-selection.json', `${JSON.stringify({ exportedAt: new Date().toISOString(), mode: activeMode, modeLabel: modeLabels[activeMode], count: selected.length, photos: selected }, null, 2)}\n`, 'application/json;charset=utf-8')
      return
    }
    const headers = ['mode', 'modeLabel', 'id', 'title', 'label', 'recommendationScore', 'reason', 'recommendationStatus', 'recommendationStatusLabel', 'recommendationSummary', 'exportState', 'exportReason', 'supportingFactors', 'cautionFactors', 'scoreBreakdown', 'clarityScore', 'exposureStatus', 'faceCount', 'similarityGroupId']
    const csvRows = selected.map((item) => ({ mode: activeMode, modeLabel: modeLabels[activeMode], ...item }))
    const csv = [headers.join(','), ...csvRows.map((item) => headers.map((header) => toCsvCell(item[header as keyof typeof item])).join(','))].join('\n')
    downloadTextFile('lenssort-selection.csv', `\ufeff${csv}\n`, 'text/csv;charset=utf-8')
  }

  const imageStyle = (photo: PhotoItem): CSSProperties | undefined => photo.imageUrl
    ? { backgroundImage: `url("${photo.imageUrl}")` }
    : undefined

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">L</div>
          <div>
            <div className="brand-name">LensSort <span>AI</span></div>
            <div className="brand-caption">本地优先的照片分类工具</div>
          </div>
        </div>
        <div className="privacy-pill"><span className="status-dot" /> 图片默认只在本地处理</div>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">AI PHOTO CURATION · MVP</p>
          <h1>从一堆照片里，<br /><em>先挑出值得看的。</em></h1>
          <p className="hero-description">选择一批旅行或活动照片，LensSort 会先找出值得优先确认的照片，再把相似照片和需要检查的地方整理出来。</p>
          <div className="hero-actions">
          <label className={`import-button ${importedPhotos.length > 0 ? 'has-library' : ''} ${isDragging ? 'drag-active' : ''}`} onDragOver={handleDragOver} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImport} />
            <span className="button-icon">＋</span>
            {isAnalyzing ? '正在准备照片…' : importedPhotos.length > 0 ? '重新选择照片' : '选择照片开始'}
          </label>
          {importedPhotos.length > 0 && <a className="hero-next-action" href="#photo-workspace">查看推荐照片 <span>→</span></a>}
          </div>
          {importedPhotos.length > 0 && <p className="hero-ready-note">已准备好 {importedPhotos.length} 张照片，先从推荐列表开始。</p>}
          <p className="microcopy">支持 JPG、PNG、WebP · 不上传原图 · 单张不超过 20 MB</p>
          {importError && <p className="import-error" role="alert">{importError}</p>}
        </div>
        <div className="hero-visual" aria-label="照片精选预览">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-card card-main"><div className="visual-photo photo-mountain" /><div className="visual-card-footer"><span>AI 推荐</span><strong>96</strong></div></div>
          <div className="floating-card card-small card-top"><div className="visual-photo photo-person" /></div>
          <div className="floating-card card-small card-bottom"><div className="visual-photo photo-water" /></div>
          <div className="scan-line" />
        </div>
        </section>

      <section className="workspace-section" id="photo-workspace">
        <div className="section-heading">
          <div><p className="eyebrow">YOUR LIBRARY</p><h2>照片总览 <span className="demo-tag">{isDemo ? '演示数据' : '本地照片'}</span></h2></div>
          <div className="heading-actions"><span className="analysis-status"><span className="status-dot" /> {isAnalyzing ? '正在生成缩略图' : batchAnalysisRunning ? `正在批量分析 ${batchAnalysisCompleted}/${importedPhotos.length}` : isDemo ? '演示数据已就绪' : `${importedPhotos.length} 张本地照片已完成预分析`}</span><button className="secondary-button compact-button" type="button" onClick={() => exportSelection('json')}>导出 JSON</button><button className="secondary-button compact-button" type="button" onClick={() => exportSelection('csv')}>导出 CSV</button><button className="ghost-button" type="button" onClick={clearLibrary}>清除本次数据</button></div>
        </div>
        {rejectedCount > 0 && <p className="import-summary">已跳过 {rejectedCount} 个无法读取的文件；当前列表只展示成功生成缩略图的照片。</p>}
        <p className="curation-status" role="status">{curationStatus}</p>
        <div className="preference-reset-panel"><div><strong>推荐偏好</strong><p>喜欢/不喜欢只影响当前排序权重；恢复默认后不会删除照片、分析结果、保留/跳过选择或相似组候选。</p></div><button type="button" className="secondary-button compact-button" onClick={resetPreferences} disabled={!curationReady || Object.keys(sentiment).length === 0}>恢复默认偏好</button></div>
        {curationError && <div role="alert"><p className="import-error">{curationError}</p><button className="secondary-button compact-button" type="button" onClick={() => updateCuration(curationRef.current)} disabled={!curationReady || isDemo}>重试保存选择</button></div>}
        {!isDemo && <details className="analysis-details">
          <summary><strong>分析详情</strong><span>{batchAnalysisRunning ? `正在分析 ${batchAnalysisCompleted}/${importedPhotos.length}` : batchAnalysisCompleted > 0 ? `${batchAnalysisCompleted}/${importedPhotos.length} 张完成` : '可选：运行更完整的模型分析'}</span></summary>
          <div className="batch-analysis-card"><div><strong>补充人物与场景分析</strong><p>照片已经可以直接整理；展开这里可以逐张运行 MobileNetV4 与人脸检测，补充人物、风景和人脸信息。</p></div><div className="batch-analysis-actions"><span>{batchAnalysisCompleted}/{importedPhotos.length} 已完成 · {importedPhotos.filter((photo) => photo.modelStatus === 'succeeded').length} 张成功 · {importedPhotos.filter((photo) => photo.modelStatus === 'failed').length} 张失败</span><button type="button" className="secondary-button" onClick={() => void runBatchModelClassification()} disabled={batchAnalysisRunning}>{batchAnalysisRunning ? `分析中 ${batchAnalysisCompleted}/${importedPhotos.length}` : batchAnalysisCompleted > 0 ? '重新运行分析' : '运行分析'}</button></div></div>
          {batchAnalysisError && <p className="import-error" role="alert">{batchAnalysisError}</p>}
          {importedPhotos.some((photo) => photo.modelStatus === 'failed') && <p className="import-summary">部分照片的模型分析失败；清晰度、曝光和相似照片分析仍可用。</p>}
        </details>}

        <div className="metrics-row">
          <div className="metric-card"><span className="metric-label">已读取照片</span><strong>{isDemo ? 128 : importedPhotos.length}</strong><span className="metric-note">{isDemo ? '+18 张待处理' : importedPhotos.length > 0 ? `质量风险 ${importedPhotos.filter((photo) => photo.lowQuality).length} 张` : '等待 AI 分析'}</span></div>
          <div className="metric-card"><span className="metric-label">AI 推荐保留</span><strong>{isDemo ? 42 : 0}</strong><span className="metric-note positive">{isDemo ? '接受率 84%' : '分析完成后显示'}</span></div>
          <div className="metric-card"><span className="metric-label">相似照片组</span><strong>{isDemo ? 16 : new Set(importedPhotos.filter((photo) => photo.similarityGroupId).map((photo) => photo.similarityGroupId)).size}</strong><span className="metric-note">{isDemo ? '减少 63% 浏览' : importedPhotos.some((photo) => photo.isNearDuplicate) ? '请人工确认保留版本' : '暂未发现近重复'}</span></div>
          <div className="metric-card accent-metric"><span className="metric-label">预计节省时间</span><strong>{isDemo ? '21' : '—'}<span>{isDemo ? 'min' : ''}</span></strong><span className="metric-note">{isDemo ? '示例指标' : '分析完成后显示'}</span></div>
        </div>

        <div className="toolbar">
          <div className="filter-tabs">{(Object.keys(filterLabels) as Filter[]).map((filter) => <button key={filter} type="button" className={activeFilter === filter ? 'filter-tab active' : 'filter-tab'} onClick={() => setActiveFilter(filter)}>{filterLabels[filter]}<span>{filterCounts[filter]}</span></button>)}</div>
          <button className="sort-button" type="button">{isDemo ? '推荐优先' : '导入顺序'} <span>⌄</span></button>
        </div>

        {visiblePhotos.length > 0 ? <div className="photo-grid">{visiblePhotos.map((photo) => <PhotoCard key={photo.id} photo={photo} score={getRecommendationScore(photo)} explanation={getRecommendationExplanationForPhoto(photo)} kept={feedback[photo.id] === 'keep'} imageStyle={imageStyle(photo)} onOpen={() => { setSelectedPhoto(photo); if (photo.isImported) setModelPhoto(photo) }} />)}</div> : <div className="empty-state"><strong>当前筛选没有照片</strong><span>{activeFilter === 'quality' ? '当前没有照片触发清晰度或曝光风险规则。' : activeFilter === 'similar' ? '当前没有检测到视觉上接近的照片。' : '本地照片完成 AI 分析后，会在这里出现对应标签。'}</span></div>}
         {similarGroups.length > 0 && <div className="similar-groups-panel"><div className="section-heading compact-heading"><div><p className="eyebrow">SIMILAR GROUPS</p><h3>相似组推荐</h3></div><div className="similar-group-actions"><p className="section-note">先用 dHash/pHash 预筛候选，再按需运行本地 CLIP；不会自动删除照片。</p>{!isDemo && <button type="button" className="secondary-button compact-button" onClick={() => void runGroupClipAnalysis()} disabled={groupClipRunning}>{groupClipRunning ? `CLIP 分析中 ${groupClipCompleted}/${groupClipTotal}` : '运行组内 CLIP 验证'}</button>}</div></div>{!curationReady && <p className="clip-group-status">{curationStatus}</p>}{curationStatus === '本地选择已保存' && <p className="curation-status" role="status">选择已保存到本地；不会自动删除照片。</p>}{groupClipRunning && groupClipCurrentTitle && <p className="clip-group-status">当前处理：{groupClipCurrentTitle}；单张最长等待 {GROUP_CLIP_TIMEOUT_MS / 1000} 秒，超时会记录失败并继续。</p>}{groupClipError && <p className="import-error" role="alert">{groupClipError}</p>}<div className="similar-group-grid">{similarGroups.map((group) => <SimilarGroupCard key={group.groupId} groupId={group.groupId} photos={group.photos.map((photo) => ({ id: photo.id, title: photo.title, imageUrl: photo.imageUrl, recommendationScore: getRecommendationScore(photo), recommendationReason: getRecommendationReason(photo), recommendationExplanation: getRecommendationExplanationForPhoto(photo) }))} representative={{ id: group.representative.id, title: group.representative.title, imageUrl: group.representative.imageUrl, recommendationScore: getRecommendationScore(group.representative), recommendationReason: getRecommendationReason(group.representative), recommendationExplanation: getRecommendationExplanationForPhoto(group.representative) }} automaticTitle={group.automatic.title} ready={curationReady} expanded={expandedGroups[group.groupId] ?? false} feedback={feedback} sentiment={sentiment} onSentiment={setPhotoSentiment} clipSucceeded={group.clipSucceeded} clipFailed={group.clipFailed} clipAverage={group.clipAverage} clipReference={group.clipReference || '尚未记录'} onExpand={() => setExpandedGroups((current) => ({ ...current, [group.groupId]: !(current[group.groupId] ?? false) }))} onReset={() => chooseGroupPhoto(group.groupId)} onChoose={(id) => chooseGroupPhoto(group.groupId, id)} onFeedback={setPhotoFeedback} onView={(id) => { const photo = group.photos.find((item) => item.id === id); if (photo) { setSelectedPhoto(photo); if (photo.isImported) setModelPhoto(photo) } }} />)}</div></div>}
        {isDemo && <div className="load-more"><button type="button" className="secondary-button">查看全部照片 <span>→</span></button></div>}
      </section>

      <section className="curation-section">
        <div className="section-heading"><div><p className="eyebrow">CURATION MODE</p><h2>选择你的精选方式</h2></div><p className="section-note">AI 会根据目标调整排序，不会删除任何照片。</p></div>
        <div className="mode-row">{(Object.keys(modeLabels) as Mode[]).map((mode) => <button key={mode} type="button" className={activeMode === mode ? 'mode-card active' : 'mode-card'} onClick={() => setActiveMode(mode)}><span className="mode-icon">{mode === 'travel' ? '✦' : mode === 'people' ? '◉' : '△'}</span><span><strong>{modeLabels[mode]}</strong><small>{mode === 'travel' ? '人物与风景平衡' : mode === 'people' ? '突出人物状态' : '突出构图与场景'}</small></span><span className="mode-arrow">→</span></button>)}</div>
        <div className="explain-strip"><span className="sparkle">✦</span><div><strong>当前模式：{modeLabels[activeMode]}</strong><p>当前模式会改变排序权重，并把原因展示给你；不会删除任何照片。</p></div><button type="button" className="text-button">查看评分逻辑 →</button></div>
      </section>

      <section className="model-validation-section">
        <div className="section-heading"><div><p className="eyebrow">MODEL VALIDATION · T4.1–T4.5</p><h2>现成模型与产品标签验证</h2></div><p className="section-note">保留 MobileNetV4 原始分类，再用白名单和置信度门槛生成可解释的产品标签；人脸检测与关键点检测独立运行。</p></div>
        <div className="model-validation-card">
          <div><strong>{modelPhoto?.isImported ? modelPhoto.title : '请先点击一张本地照片'}</strong><p>{modelPhoto?.isImported ? '模型输入使用本地缩略图，不上传原图。' : '选择照片后即可验证单图推理链路。'}</p></div>
           <button type="button" className="secondary-button" onClick={() => void runModelClassification()} disabled={!modelPhoto?.isImported || modelLoadingId === modelPhoto.id}>{modelLoadingId === modelPhoto?.id ? '模型推理中…' : modelPhoto?.modelStatus === 'failed' ? '重新尝试模型' : '运行 MobileNetV4'}</button>
            <button type="button" className="secondary-button" onClick={() => void runFaceDetection()} disabled={!modelPhoto?.isImported || faceLoadingId === modelPhoto.id}>{faceLoadingId === modelPhoto?.id ? '人脸检测中…' : modelPhoto?.faceDetectionStatus === 'failed' ? '重新尝试人脸检测' : '运行人脸检测'}</button>
            <button type="button" className="secondary-button" onClick={() => void runFaceLandmarker()} disabled={!modelPhoto?.isImported || faceLandmarkerLoadingId === modelPhoto.id}>{faceLandmarkerLoadingId === modelPhoto?.id ? '关键点检测中…' : modelPhoto?.faceLandmarkerStatus === 'failed' ? '重新尝试关键点' : '运行人脸关键点'}</button>
         </div>
        {modelPhoto?.modelLabel && <div className="model-result-card"><div><strong>{modelPhoto.modelLabel}</strong><span>置信度 {Math.round((modelPhoto.modelScore ?? 0) * 100)}%</span></div><p>{modelPhoto.modelDevice?.toUpperCase()} · {modelPhoto.modelDurationMs} ms · {modelPhoto.modelId}</p><ul className="model-topk">{modelPhoto.modelTopK?.map((item) => <li key={item.label}><span>{item.label}</span><strong>{Math.round(item.score * 100)}%</strong></li>)}</ul></div>}
        {modelPhoto?.modelLabel && modelPhoto.productLabel && <div className="model-mapping-card"><div><strong>产品标签：{productLabelLabels[modelPhoto.productLabel]}</strong><span>映射置信度 {Math.round((modelPhoto.productLabelConfidence ?? 0) * 100)}%</span></div><p>{modelPhoto.productLabelReason}</p></div>}
        {modelPhoto?.faceDetectionStatus === 'succeeded' && <div className="model-mapping-card"><div><strong>人脸检测：{modelPhoto.faceCount ?? 0} 张</strong><span>最高置信度 {Math.round((modelPhoto.faceMaxConfidence ?? 0) * 100)}%</span></div><p>人脸面积占比 {Math.round((modelPhoto.faceAreaRatio ?? 0) * 1000) / 10}% · {modelPhoto.faceDetectionDurationMs} ms · 使用本地 MediaPipe Face Detector。</p></div>}
         {modelPhoto?.faceDetectionStatus === 'failed' && <div className="model-fallback-card"><strong>人脸检测未完成</strong><p>照片质量分析和 MobileNetV4 产品标签仍然可用；可以修复资源后重新尝试人脸检测。</p></div>}
         {modelPhoto?.faceLandmarkerStatus === 'succeeded' && <div className="model-mapping-card"><div><strong>人脸关键点：{modelPhoto.faceLandmarkCount ?? 0} 张</strong><span>{modelPhoto.faceLandmarkCount ? `${modelPhoto.faceLandmarkPointCounts?.join('、')} 点/脸` : '—'}</span></div><p>{modelPhoto.faceLandmarkCount ? `检测到 ${modelPhoto.faceLandmarkCount} 张脸；关键点运行耗时 ${modelPhoto.faceLandmarkerDurationMs} ms。` : `未检测到人脸；关键点运行耗时 ${modelPhoto.faceLandmarkerDurationMs} ms。`} 使用本地 MediaPipe Face Landmarker。</p></div>}
         {modelPhoto?.faceLandmarkerStatus === 'succeeded' && <div className={`model-mapping-card ${modelPhoto.closedEyeStatus === 'review' ? 'risk' : ''}`}><div><strong>闭眼风险：{modelPhoto.closedEyeStatus === 'review' ? '建议人工确认' : modelPhoto.closedEyeStatus === 'low' ? '未发现明显风险' : modelPhoto.closedEyeStatus === 'no-face' ? '无可判断人脸' : modelPhoto.closedEyeStatus === 'insufficient-data' ? '数据不足' : '待分析'}</strong><span>{modelPhoto.closedEyeStatus === 'low' || modelPhoto.closedEyeStatus === 'review' ? `${Math.round((modelPhoto.closedEyeRisk ?? 0) * 100)}%` : '—'}</span></div><p>{getClosedEyeReason(modelPhoto)}</p></div>}
         {modelPhoto?.faceLandmarkerStatus === 'failed' && <div className="model-fallback-card"><strong>人脸关键点未完成</strong><p>人脸数量检测、照片质量分析和 MobileNetV4 产品标签仍然可用；可以修复资源后重新尝试关键点检测。</p></div>}
        {modelPhoto?.modelStatus === 'failed' && <div className="model-fallback-card"><strong>已回退到传统图像分析</strong><p>清晰度、曝光、质量风险和相似照片检测仍然可用；模型失败不会阻塞照片整理，也不会自动删除照片。</p></div>}
        {(modelError || modelPhoto?.modelError) && <p className="import-error" role="alert">{modelError ?? modelPhoto?.modelError}</p>}
         {(faceError || modelPhoto?.faceDetectionError) && <p className="import-error" role="alert">{faceError ?? modelPhoto?.faceDetectionError}</p>}
         {(faceLandmarkerError || modelPhoto?.faceLandmarkerError) && <p className="import-error" role="alert">{faceLandmarkerError ?? modelPhoto?.faceLandmarkerError}</p>}
       </section>

      <section className="model-validation-section clip-evaluation-section">
        <div className="section-heading"><div><p className="eyebrow">MODEL VALIDATION · T4.7</p><h2>CLIP 三图 embedding 验证</h2></div><p className="section-note">固定两张相似图和一张不同图，验证本地视觉向量、维度、耗时与余弦相似度；结果仅用于工程验证，不等同于最终筛选准确率。</p></div>
        <div className="model-validation-card">
          <div><strong>本地量化 CLIP · WASM q8</strong><p>模型资源来自项目本地目录；本验证不会上传评测图片。</p></div>
          <button type="button" className="secondary-button" onClick={() => void runClipEvaluation()} disabled={clipEvalRunning}>{clipEvalRunning ? '三图验证中…' : '运行三图验证'}</button>
        </div>
        <div className="clip-eval-grid">
          {clipEvalCases.map((evaluationCase) => {
            const result = clipEvalResults[evaluationCase.id]
            return <div className="clip-eval-card" key={evaluationCase.id}><div><strong>{evaluationCase.title}</strong><span className={evaluationCase.relation}>{evaluationCase.relation === 'similar' ? '相似组' : '不同图'}</span></div><p>{result?.status === 'succeeded' ? `成功 · ${result.dimension} 维 · ${result.durationMs} ms` : result?.status === 'failed' ? `失败 · ${result.error}` : result?.status === 'running' ? '运行中…' : '尚未运行'}</p></div>
          })}
        </div>
        {(clipEvalSimilarity !== null || clipEvalDifference !== null) && <div className="model-mapping-card"><div><strong>余弦相似度结果</strong><span>实验性记录</span></div><p>相似图 A / B：{clipEvalSimilarity ?? '—'} · 相似图 A / 不同图：{clipEvalDifference ?? '—'}。仅据本组三张图记录，不设置产品阈值。</p></div>}
        {clipEvalError && <p className="import-error" role="alert">{clipEvalError}</p>}
      </section>

      <footer className="footer"><span>LensSort AI · 项目原型 v0.1</span><span>Local-first · Explainable · Human-in-the-loop</span></footer>

      {selectedPhoto && <div className="modal-backdrop" role="presentation" onClick={() => setSelectedPhoto(null)}><div className="detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setSelectedPhoto(null)}>×</button><div className={`detail-image ${selectedPhoto.gradient ?? ''}`} style={imageStyle(selectedPhoto)}><span className={selectedPhoto.score === null ? 'score-badge large pending' : 'score-badge large'}>{getRecommendationScore(selectedPhoto)}</span></div><div className="detail-content"><p className="eyebrow">{selectedPhoto.isImported ? 'LOCAL PHOTO' : 'AI RECOMMENDATION'}</p><h2>{selectedPhoto.title}</h2><RecommendationExplanation explanation={getRecommendationExplanationForPhoto(selectedPhoto)} /><p className="detail-reason">原始分析：{selectedPhoto.reason}</p>{selectedPhoto.isImported && selectedPhoto.clarityScore !== undefined && <p className="detail-score">本地清晰度评分：<strong>{selectedPhoto.clarityScore}/100</strong></p>}{selectedPhoto.isImported && selectedPhoto.exposureStatus && <p className="detail-exposure">{getExposureReason(selectedPhoto)}</p>}{selectedPhoto.isImported && <p className={selectedPhoto.lowQuality ? 'detail-quality risk' : 'detail-quality'}>{getQualityReason(selectedPhoto)}</p>}{selectedPhoto.isImported && <p className="detail-normalization">{getNormalizationReason(selectedPhoto)}</p>}{selectedPhoto.isImported && <p className={selectedPhoto.isNearDuplicate ? 'detail-similarity risk' : 'detail-similarity'}>{selectedPhoto.isNearDuplicate ? `视觉相似提醒：与相似组中的其他照片接近，dHash 距离 ${selectedPhoto.similarityDistance ?? '—'}；建议人工选择保留版本，不会自动删除。` : '暂未发现视觉上接近的本地照片'}</p>}<div className="detail-stats"><span>清晰度 <strong>{selectedPhoto.isImported && selectedPhoto.clarityScore !== undefined ? `${selectedPhoto.clarityScore}/100` : selectedPhoto.isImported ? '待分析' : '良好'}</strong></span><span>曝光 <strong>{selectedPhoto.isImported && selectedPhoto.exposureStatus ? exposureStatusLabels[selectedPhoto.exposureStatus] : selectedPhoto.isImported ? '待分析' : '正常'}</strong></span><span>相似组 <strong>{selectedPhoto.isImported && selectedPhoto.similarityGroupId ? selectedPhoto.similarityGroupId.replace('similar-', '#') : selectedPhoto.isImported ? '未分组' : '第 4 组'}</strong></span></div><PhotoSentiment ready={curationReady} value={sentiment[selectedPhoto.id]} onChange={(value) => setPhotoSentiment(selectedPhoto.id, value)} /><div className="detail-actions"><button type="button" className="secondary-button" disabled={!curationReady} onClick={() => setPhotoFeedback(selectedPhoto.id, 'skip')}>跳过</button><button type="button" className="primary-small" disabled={!curationReady} onClick={() => setPhotoFeedback(selectedPhoto.id, 'keep')}>保留这张</button></div></div></div></div>}
    </main>
  )
}

export default App
