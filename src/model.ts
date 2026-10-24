import { env, pipeline } from '@huggingface/transformers'

export const MOBILE_NET_MODEL_ID = 'onnx-community/mobilenetv4_conv_small.e2400_r224_in1k'
const LOCAL_MODEL_ROOT = `/models/${MOBILE_NET_MODEL_ID}`
const LOCAL_MODEL_REQUIRED_FILES = ['config.json', 'preprocessor_config.json'] as const

env.allowLocalModels = true
env.localModelPath = '/models/'

export type ModelDevice = 'webgpu' | 'wasm'

export type ImageClassificationResult = {
  label: string
  score: number
  device: ModelDevice
  modelId: string
  topK: Array<{ label: string; score: number }>
  durationMs: number
}

export class ModelInferenceError extends Error {
  readonly attemptedDevices: ModelDevice[]
  readonly causeByDevice: Partial<Record<ModelDevice, string>>

  constructor(attemptedDevices: ModelDevice[], causeByDevice: Partial<Record<ModelDevice, string>>) {
    super('MobileNetV4 模型文件未能加载，请检查网络或将已获许可的模型文件放入 public/models/。')
    this.name = 'ModelInferenceError'
    this.attemptedDevices = attemptedDevices
    this.causeByDevice = causeByDevice
  }
}

type LocalModelPreflight = {
  status: 'available' | 'missing' | 'invalid' | 'unavailable'
  details: string
}

type ImageClassifier = (image: string, options?: { top_k?: number }) => Promise<Array<{ label: string; score: number }>>

let webGpuClassifier: Promise<ImageClassifier> | null = null
let wasmClassifier: Promise<ImageClassifier> | null = null

function createClassifier(device: ModelDevice) {
  return pipeline('image-classification', MOBILE_NET_MODEL_ID, {
    device,
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
  }) as unknown as Promise<ImageClassifier>
}

function getClassifier(device: ModelDevice) {
  if (device === 'webgpu') {
    webGpuClassifier ??= createClassifier(device)
    return webGpuClassifier
  }
  wasmClassifier ??= createClassifier(device)
  return wasmClassifier
}

function supportsWebGpu() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

async function preflightLocalModel(): Promise<LocalModelPreflight> {
  const results: string[] = []
  let validFiles = 0

  for (const fileName of LOCAL_MODEL_REQUIRED_FILES) {
    const path = `${LOCAL_MODEL_ROOT}/${fileName}`
    try {
      const response = await fetch(path, { cache: 'no-store' })
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      const bodyPrefix = (await response.clone().text()).trimStart().slice(0, 20).toLowerCase()
      const isHtml = contentType.includes('text/html') || bodyPrefix.startsWith('<!doctype') || bodyPrefix.startsWith('<html')

      if (!response.ok) {
        results.push(`${fileName} HTTP ${response.status}`)
        continue
      }
      if (isHtml) {
        results.push(`${fileName} 返回了 HTML 而不是 JSON`)
        continue
      }
      if (!contentType.includes('json')) {
        results.push(`${fileName} Content-Type 不是 JSON`)
        continue
      }
      validFiles += 1
    } catch (error) {
      results.push(`${fileName} 请求失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (validFiles === LOCAL_MODEL_REQUIRED_FILES.length) {
    return { status: 'available', details: '本地配置文件预检通过' }
  }
  if (validFiles > 0) {
    return { status: 'invalid', details: `本地模型配置不完整：${results.join('；')}` }
  }
  if (results.every((result) => result.includes('HTTP 404') || result.includes('返回了 HTML'))) {
    return { status: 'missing', details: `本地模型文件不存在：${results.join('；')}` }
  }
  return { status: 'unavailable', details: `本地模型资源无法访问：${results.join('；')}` }
}

function describeInferenceFailure(error: unknown, preflight: LocalModelPreflight) {
  const message = error instanceof Error ? error.message : String(error)
  const normalizedMessage = message.includes('<!doctype') || message.includes('Unexpected token')
    ? '模型资源返回了网页内容，通常表示本地文件缺失或开发服务器回退到了 index.html'
    : message
  return `${preflight.details}；推理错误：${normalizedMessage}`
}

async function classifyWithDevice(blob: Blob, device: ModelDevice): Promise<ImageClassificationResult> {
  const classifier = await getClassifier(device)
  const imageUrl = URL.createObjectURL(blob)
  const startedAt = performance.now()
  try {
    const output = await classifier(imageUrl, { top_k: 3 })
    const topK = output.map((item) => ({ label: item.label, score: item.score }))
    const first = topK[0]
    if (!first) throw new Error('模型没有返回分类结果')
    return {
      label: first.label,
      score: first.score,
      device,
      modelId: MOBILE_NET_MODEL_ID,
      topK,
      durationMs: Math.round(performance.now() - startedAt),
    }
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

export async function classifyPhoto(blob: Blob) {
  const preflight = await preflightLocalModel()
  const devices: ModelDevice[] = supportsWebGpu() ? ['webgpu', 'wasm'] : ['wasm']
  const causeByDevice: Partial<Record<ModelDevice, string>> = {}
  for (const device of devices) {
    try {
      return await classifyWithDevice(blob, device)
    } catch (error) {
      causeByDevice[device] = describeInferenceFailure(error, preflight)
      if (device === 'webgpu') webGpuClassifier = null
    }
  }
  throw new ModelInferenceError(devices, causeByDevice)
}
