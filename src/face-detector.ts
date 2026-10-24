import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

const FACE_MODEL_PATH = '/models/mediapipe/face_detector/blaze_face_short_range.tflite'
const FACE_WASM_PATH = '/models/mediapipe/wasm'

export type FaceDetection = {
  score: number
  x: number
  y: number
  width: number
  height: number
}

export type FaceDetectionResult = {
  faceCount: number
  faceAreaRatio: number
  maxConfidence: number
  detections: FaceDetection[]
  durationMs: number
}

export class FaceDetectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FaceDetectionError'
  }
}

let detectorPromise: Promise<FaceDetector> | null = null

async function getFaceDetector() {
  detectorPromise ??= (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(FACE_WASM_PATH)
      return await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL_PATH },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      })
    } catch (error) {
      detectorPromise = null
      throw new FaceDetectionError(`人脸检测模型加载失败：${error instanceof Error ? error.message : String(error)}`)
    }
  })()
  return detectorPromise
}

export async function detectFaces(blob: Blob): Promise<FaceDetectionResult> {
  const detector = await getFaceDetector()
  const image = await createImageBitmap(blob)
  const startedAt = performance.now()
  try {
    const result = detector.detect(image)
    const detections = result.detections.flatMap((detection) => {
      const box = detection.boundingBox
      const category = detection.categories[0]
      if (!box || !category) return []
      return [{
        score: Math.round(category.score * 1000) / 1000,
        x: box.originX,
        y: box.originY,
        width: box.width,
        height: box.height,
      }]
    })
    const faceAreaRatio = detections.reduce((sum, detection) => sum + detection.width * detection.height, 0) / (image.width * image.height)
    return {
      faceCount: detections.length,
      faceAreaRatio: Math.round(faceAreaRatio * 1000) / 1000,
      maxConfidence: detections.length > 0 ? Math.max(...detections.map((detection) => detection.score)) : 0,
      detections,
      durationMs: Math.round(performance.now() - startedAt),
    }
  } finally {
    image.close()
  }
}
