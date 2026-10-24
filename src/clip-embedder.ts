import { env, pipeline } from '@huggingface/transformers'

export const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch32'
const CLIP_MODEL_ROOT = `/models/${CLIP_MODEL_ID}`
const CLIP_REQUIRED_FILES = ['config.json', 'preprocessor_config.json', 'onnx/vision_model_quantized.onnx'] as const

env.allowLocalModels = true
env.localModelPath = '/models/'

export type ClipEmbeddingResult = {
  vector: number[]
  dimension: number
  durationMs: number
}

export type ClipPreflight = {
  status: 'available' | 'missing' | 'invalid' | 'unavailable'
  details: string
}

export class ClipEmbeddingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClipEmbeddingError'
  }
}

type FeatureTensor = {
  data: Float32Array | ArrayLike<number>
  dims?: number[]
}

type ImageFeatureExtractor = (image: string) => Promise<FeatureTensor>

let extractorPromise: Promise<ImageFeatureExtractor> | null = null

function getLocalPath(fileName: string) {
  return `${CLIP_MODEL_ROOT}/${fileName}`
}

export async function preflightClipModel(): Promise<ClipPreflight> {
  const failures: string[] = []
  let validFiles = 0

  for (const fileName of CLIP_REQUIRED_FILES) {
    try {
      const response = await fetch(getLocalPath(fileName), {
        method: fileName.endsWith('.onnx') ? 'HEAD' : 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        failures.push(`${fileName} HTTP ${response.status}`)
        continue
      }
      if (fileName.endsWith('.json')) {
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
        const body = await response.text()
        const bodyPrefix = body.trimStart().slice(0, 20).toLowerCase()
        if (contentType.includes('text/html') || bodyPrefix.startsWith('<!doctype') || bodyPrefix.startsWith('<html')) {
          failures.push(`${fileName} 返回 HTML`)
          continue
        }
        if (!contentType.includes('json')) {
          failures.push(`${fileName} Content-Type 不是 JSON`)
          continue
        }
        try {
          JSON.parse(body)
        } catch {
          failures.push(`${fileName} 不是有效 JSON`)
          continue
        }
      } else {
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
        const contentLength = Number(response.headers.get('content-length'))
        if (contentType.includes('text/html') || contentLength <= 0) {
          failures.push(`${fileName} 不是有效的模型权重响应`)
          continue
        }
      }
      validFiles += 1
    } catch (error) {
      failures.push(`${fileName} 请求失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (validFiles === CLIP_REQUIRED_FILES.length) return { status: 'available', details: '本地 CLIP 配置与视觉权重预检通过' }
  if (validFiles > 0) return { status: 'invalid', details: `本地 CLIP 资源不完整：${failures.join('；')}` }
  if (failures.every((failure) => failure.includes('HTTP 404') || failure.includes('返回 HTML'))) {
    return { status: 'missing', details: `本地 CLIP 文件不存在：${failures.join('；')}` }
  }
  return { status: 'unavailable', details: `本地 CLIP 资源无法访问：${failures.join('；')}` }
}

async function getExtractor() {
  extractorPromise ??= (async () => {
    const preflight = await preflightClipModel()
    if (preflight.status !== 'available') throw new ClipEmbeddingError(preflight.details)
    return pipeline('image-feature-extraction', CLIP_MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      local_files_only: true,
    }) as unknown as Promise<ImageFeatureExtractor>
  })()
  try {
    return await extractorPromise
  } catch (error) {
    extractorPromise = null
    throw new ClipEmbeddingError(`CLIP 模型加载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function normalizeVector(data: ArrayLike<number>) {
  const vector = Array.from(data, Number)
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(norm) || norm === 0) throw new ClipEmbeddingError('CLIP 返回了无效的 embedding 向量')
  return vector.map((value) => value / norm)
}

export async function embedImage(blob: Blob): Promise<ClipEmbeddingResult> {
  const extractor = await getExtractor()
  const imageUrl = URL.createObjectURL(blob)
  const startedAt = performance.now()
  try {
    const output = await extractor(imageUrl)
    const vector = normalizeVector(output.data)
    return {
      vector,
      dimension: vector.length,
      durationMs: Math.round(performance.now() - startedAt),
    }
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) return null
  const similarity = left.reduce((sum, value, index) => sum + value * right[index], 0)
  return Math.round(Math.max(-1, Math.min(1, similarity)) * 1000) / 1000
}
