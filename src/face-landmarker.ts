import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const FACE_LANDMARKER_MODEL_PATH = '/models/mediapipe/face_landmarker/face_landmarker.task'
const FACE_WASM_PATH = '/models/mediapipe/wasm'

export type FaceLandmarkerResult = {
  faceCount: number
  landmarkPointCounts: number[]
  blendshapeCounts: number[]
  closedEyeRisk: number
  closedEyeStatus: 'no-face' | 'insufficient-data' | 'low' | 'review'
  closedEyeFaceResults: Array<{
    risk: number
    status: 'insufficient-data' | 'low' | 'review'
    leftScore?: number
    rightScore?: number
  }>
  durationMs: number
}

export class FaceLandmarkerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FaceLandmarkerError'
  }
}

let landmarkerPromise: Promise<FaceLandmarker> | null = null

function roundScore(score: number) {
  return Math.round(score * 1000) / 1000
}

function getBlendshapeScore(categories: Array<{ categoryName: string; displayName: string; score: number }>, target: string) {
  const category = categories.find((item) => (item.categoryName || item.displayName).toLowerCase() === target)
  return category ? roundScore(category.score) : undefined
}

async function getFaceLandmarker() {
  landmarkerPromise ??= (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(FACE_WASM_PATH)
      return await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_PATH,
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numFaces: 5,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: true,
      })
    } catch (error) {
      landmarkerPromise = null
      throw new FaceLandmarkerError(`人脸关键点模型加载失败：${error instanceof Error ? error.message : String(error)}`)
    }
  })()
  return landmarkerPromise
}

export async function detectFaceLandmarks(blob: Blob): Promise<FaceLandmarkerResult> {
  const landmarker = await getFaceLandmarker()
  const image = await createImageBitmap(blob)
  const startedAt = performance.now()
  try {
    const result = landmarker.detect(image)
    const closedEyeFaceResults = result.faceBlendshapes.map((blendshapes) => {
      const leftScore = getBlendshapeScore(blendshapes.categories, 'eyeblinkleft')
      const rightScore = getBlendshapeScore(blendshapes.categories, 'eyeblinkright')
      if (leftScore === undefined || rightScore === undefined) {
        return { risk: 0, status: 'insufficient-data' as const, leftScore, rightScore }
      }
      const risk = roundScore((leftScore + rightScore) / 2)
      return {
        risk,
        status: risk < 0.35 ? 'low' as const : 'review' as const,
        leftScore,
        rightScore,
      }
    })
    const validRisks = closedEyeFaceResults.filter((face) => face.status !== 'insufficient-data').map((face) => face.risk)
    const closedEyeRisk = validRisks.length > 0 ? Math.max(...validRisks) : 0
    return {
      faceCount: result.faceLandmarks.length,
      landmarkPointCounts: result.faceLandmarks.map((landmarks) => landmarks.length),
      blendshapeCounts: result.faceBlendshapes.map((blendshapes) => blendshapes.categories.length),
      closedEyeRisk: roundScore(closedEyeRisk),
      closedEyeStatus: result.faceLandmarks.length === 0
        ? 'no-face'
        : validRisks.length === 0
          ? 'insufficient-data'
          : closedEyeRisk < 0.35 ? 'low' : 'review',
      closedEyeFaceResults,
      durationMs: Math.round(performance.now() - startedAt),
    }
  } finally {
    image.close()
  }
}
