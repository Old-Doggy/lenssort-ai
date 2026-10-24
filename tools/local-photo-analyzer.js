import path from 'node:path'
import { readFile } from 'node:fs/promises'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import { classifyFolderCategory } from './folder-classification.js'
import { createLocalFaceDetector } from './local-face-detector.js'
import { resolveInferenceDevice } from './inference-devices.js'
import { createNpuSession } from './npu-bridge.js'
import { buildModelEvidence } from './model-evidence.js'
import { createYoloxPersonDetector } from './yolox-person-detector.js'
import { createClipSceneAnalyzer } from './clip-scene-analyzer.js'
import { createVisionLanguageExplainer } from './vision-language-explainer.js'
import { getVisionLanguageTrigger } from './vision-language-policy.js'
import { reviewPhotoDecision } from './vision-review.js'
import { analyzeSubjectQuality } from './subject-quality.js'
import { createSimilarityReviewPolicy } from './similarity-review.js'

const clamp = value => Math.max(0, Math.min(100, value))

function buildPhotoExplanation(classification, quality) {
  const clarity = quality.clarityScore >= 80 ? '细节较清晰' : quality.clarityScore >= 60 ? '细节清晰度中等' : '细节可能略显模糊'
  const light = quality.exposureStatus === '曝光均衡' ? '光线比较均衡' : quality.exposureStatus === '整体偏暗' ? '整体光线偏暗' : quality.exposureStatus === '整体偏亮' ? '亮部略亮' : '明暗反差较大'
  return `${classification.explanation ?? classification.reason ?? '已完成内容分析'} ${clarity}，${light}。`
}

function buildTechnicalExplanation(classification, quality) {
  const clarity = quality.clarityScore >= 80 ? '细节较清晰' : quality.clarityScore >= 60 ? '细节清晰度中等' : '细节可能略显模糊'
  const light = quality.exposureStatus === '曝光均衡' ? '光线比较均衡' : quality.exposureStatus === '整体偏暗' ? '整体光线偏暗' : quality.exposureStatus === '整体偏亮' ? '亮部略亮' : '明暗反差较大'
  return `${classification.explanation ?? classification.reason ?? '已完成内容分析'} ${clarity}，${light}。`
}

function shouldRunSceneAuxiliary(candidates, faces, person) {
  const topScore = Number(candidates[0]?.score ?? 0)
  const personScore = Number(person?.maxScore ?? 0)
  const personCandidate = Number(person?.candidateCount ?? 0) > 0 && personScore >= 0.25
  const facePresent = Number(faces?.faceCount ?? 0) > 0
  return !facePresent || personCandidate || topScore < 0.7
}

function calculateTechnicalQuality(data, width, height, faces) {
  const pixels = width * height
  const grayscale = new Float32Array(pixels)
  let brightnessSum = 0
  let underexposed = 0
  let overexposed = 0
  for (let index = 0; index < pixels; index++) {
    const offset = index * 3
    const luminance = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
    grayscale[index] = luminance
    brightnessSum += luminance
    if (luminance < 28) underexposed++
    if (luminance > 245) overexposed++
  }
  let edgeSum = 0
  let edgeSquaredSum = 0
  let edgeCount = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x
      const laplacian = grayscale[index - width] + grayscale[index - 1] + grayscale[index + 1] + grayscale[index + width] - grayscale[index] * 4
      edgeSum += laplacian
      edgeSquaredSum += laplacian * laplacian
      edgeCount++
    }
  }
  const variance = edgeCount ? Math.max(0, edgeSquaredSum / edgeCount - (edgeSum / edgeCount) ** 2) : 0
  const clarityScore = clamp(Math.round(12 + 11 * Math.log1p(variance)))
  const meanBrightness = brightnessSum / pixels
  const underexposureRatio = underexposed / pixels
  const overexposureRatio = overexposed / pixels
  const exposureStatus = underexposureRatio >= 0.18 && overexposureRatio >= 0.18
    ? '明暗反差大'
    : underexposureRatio >= 0.18 || meanBrightness < 78
      ? '整体偏暗'
      : overexposureRatio >= 0.18 || meanBrightness > 188
        ? '整体偏亮'
        : '曝光均衡'
  const exposureScore = exposureStatus === '曝光均衡' ? 100 : exposureStatus === '明暗反差大' ? 45 : 65
  const faceScore = faces?.faceCount > 0 ? clamp((faces.maxConfidence ?? 0) * 100) : 70
  const qualityScore = Math.round(clarityScore * 0.55 + exposureScore * 0.3 + faceScore * 0.15)
  const reasons = [`清晰度 ${clarityScore}/100`, exposureStatus]
  if (faces?.faceCount > 0) reasons.push(`检测到 ${faces.faceCount} 张人脸`)
  return { qualityScore, qualityReasons: reasons, clarityScore, meanBrightness: Math.round(meanBrightness), underexposureRatio, overexposureRatio, exposureStatus }
}

export function analyzePhotoQualityFromRgb(rgb, faces = null) {
  if (rgb.info.channels !== 3) throw new Error('Expected RGB input for quality analysis')
  return calculateTechnicalQuality(rgb.data, rgb.info.width, rgb.info.height, faces)
}

export async function analyzePhotoQuality(bytes, faces = null) {
  const rgb = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().removeAlpha().toColourspace('srgb').resize(256, 256, { fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true })
  return analyzePhotoQualityFromRgb(rgb, faces)
}

export async function createPhotoAnalyzer(root, backend = 'auto', model = 'auto', options = {}) {
  if (!['auto', 'cpu', 'dml', 'igpu', 'dgpu', 'npu'].includes(backend) && !/^gpu-\d+$/.test(backend)) throw new Error('Unsupported backend')
  const device = await resolveInferenceDevice(root, backend)
  const similarityReview = options.experimentalReview === true ? createSimilarityReviewPolicy() : null
  const modelRoot = path.join(root, 'public/models/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k')
  const config = JSON.parse(await readFile(path.join(modelRoot, 'config.json'), 'utf8'))
  const processor = JSON.parse(await readFile(path.join(modelRoot, 'preprocessor_config.json'), 'utf8'))
  let session
  let provider
  let fallbackReason = null
  let npuSession
  let verifiedNpu = false
  if (backend === 'npu') { npuSession = await createNpuSession(root); provider = 'vitisai' }
  const candidates = backend === 'npu' ? [] : backend === 'auto' ? [device.provider === 'dml' ? 'dml' : 'cpu', 'cpu'].filter((value, index, values) => values.indexOf(value) === index) : [device.provider]
  for (const candidate of candidates) {
    try {
      session = await ort.InferenceSession.create(path.join(modelRoot, 'onnx/model.onnx'), {
        executionProviders: candidate === 'dml' ? [{ name: 'dml', deviceId: device.deviceId }] : [candidate], executionMode: 'sequential', enableMemPattern: false,
        extra: candidate === 'dml' ? { session: { disable_cpu_ep_fallback: '1' } } : {},
      })
      provider = candidate
      break
    } catch (error) {
      fallbackReason = error.message
      if (backend !== 'auto' || candidate === 'cpu') throw error
    }
  }
  let faceDetector
  try { faceDetector = await createLocalFaceDetector(root) }
  catch (error) { if (session) await session.release(); if (npuSession) await npuSession.close(); throw error }
  const personDetector = await createYoloxPersonDetector(root)
  const sceneAnalyzer = await createClipSceneAnalyzer(root)
  let visionLanguageExplainer
  try { visionLanguageExplainer = await createVisionLanguageExplainer({ model, force: options.forceModel === true, onProgress: options.onProgress }) }
  catch (error) {
    await Promise.allSettled([faceDetector.close(), personDetector.close(), sceneAnalyzer.close(), session?.release(), npuSession?.close()])
    throw error
  }
  let forcedFailure = null
  return {
    backend: provider,
    device,
    get npuVerified() { return verifiedNpu },
    async analyze(bytes) {
      if (forcedFailure) throw forcedFailure
      const startedAt = performance.now()
      const image = sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().removeAlpha().toColourspace('srgb')
      const metadata = await image.metadata()
      const width = metadata.autoOrient?.width ?? metadata.width
      const height = metadata.autoOrient?.height ?? metadata.height
      const shortest = Math.min(width ?? 0, height ?? 0)
      if (!shortest) throw new Error('Image dimensions are unavailable')
      const scale = 256 / shortest
      const resizedWidth = Math.max(224, Math.floor((width ?? 0) * scale))
      const resizedHeight = Math.max(224, Math.floor((height ?? 0) * scale))
      const resized = await image.resize(resizedWidth, resizedHeight, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true })
      const rgb = await sharp(resized.data, { raw: { width: resized.info.width, height: resized.info.height, channels: 3 } }).extract({
        left: Math.floor((resized.info.width - 224) / 2),
        top: Math.floor((resized.info.height - 224) / 2),
        width: 224,
        height: 224,
      }).raw().toBuffer({ resolveWithObject: true })
      if (rgb.info.channels !== 3) throw new Error('Expected RGB input')
      const pixels = 224 * 224
      const normalized = new Float32Array(3 * pixels)
      for (let pixel = 0; pixel < pixels; pixel++) {
        for (let channel = 0; channel < 3; channel++) normalized[channel * pixels + pixel] = (rgb.data[pixel * 3 + channel] / 255 - processor.image_mean[channel]) / processor.image_std[channel]
      }
      const decodePreprocessMs = performance.now() - startedAt
      const inferenceStarted = performance.now()
      let logits
      let npuEvidence = null
      if (npuSession) {
        npuEvidence = await npuSession.run(normalized)
        logits = npuEvidence.logits
        verifiedNpu = npuEvidence.npuVerified
      } else {
        const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', normalized, [1, 3, 224, 224]) })
        logits = Array.from(output[session.outputNames[0]].data)
      }
      const classificationMs = performance.now() - inferenceStarted
      const maximum = Math.max(...logits)
      const exponentials = logits.map(value => Math.exp(value - maximum))
      const sum = exponentials.reduce((total, value) => total + value, 0)
      const candidates = exponentials.map((value, index) => ({ label: config.id2label[index], score: value / sum })).sort((left, right) => right.score - left.score).slice(0, 5)
      let faces = null
      let faceError = null
      const faceStarted = performance.now()
      try { faces = await faceDetector.detect(await sharp(bytes).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer()) }
      catch (error) { faceError = error.message }
      const faceMs = performance.now() - faceStarted
      const qualityStarted = performance.now()
      const quality = await analyzePhotoQuality(bytes, faces)
      const qualityMs = performance.now() - qualityStarted
      const auxiliaryStarted = performance.now()
      const person = await personDetector.detect(bytes)
      const scene = shouldRunSceneAuxiliary(candidates, faces, person)
        ? await sceneAnalyzer.analyze(bytes)
        : { status: 'skipped', source: 'CLIP ViT-B/32', topLabel: null, topScore: null, candidates: [], reason: 'MobileNetV4 结果已达到快速路径门槛' }
      const auxiliaryMs = performance.now() - auxiliaryStarted
      let classification = classifyFolderCategory(candidates, faces, { person, sceneCandidates: scene.candidates })
      classification.explanation = buildTechnicalExplanation(classification, quality)
      let visionExplanation = null
      const visionTrigger = getVisionLanguageTrigger({ classification, candidates, faces, person, scene })
      let visionMs = 0
      let visionCategoryApplied = false
      if (visionLanguageExplainer.status.status === 'ready' && visionTrigger.run) {
        const visionStarted = performance.now()
        try {
          const fused = await reviewPhotoDecision({ bytes, classification, faces, person, scene, enableReview: options.experimentalReview === true, similarityReview, explain: (image, settings) => visionLanguageExplainer.explain(image, settings) })
          classification = fused.classification
          visionCategoryApplied = fused.applied
          visionExplanation = { ...fused.vision, triggerReason: visionTrigger.reason }
        } catch (error) {
          if (options.forceModel === true && !['LENSSORT_VISION_OUTPUT_INVALID', 'LENSSORT_VISION_PHOTO_FAILED'].includes(error.code)) {
            forcedFailure = Object.assign(new Error(error.message), { code: 'LENSSORT_FORCED_MODEL_FAILED' })
            throw forcedFailure
          }
          visionExplanation = { generated: false, error: error.message, model: visionLanguageExplainer.status.model, provider: visionLanguageExplainer.status.provider, categoryApplied: false, triggerReason: visionTrigger.reason }
          classification = { ...classification, category: '待确认', confidence: null, reason: `本张视觉分析未完成：${error.message}`, explanation: '本张图片需要人工确认；未将基础检测或失败的视觉请求冒充确定分类。可查看原图或重新分析。' }
        }
        visionMs = performance.now() - visionStarted
      }
      const subjectStarted = performance.now()
      try { quality.subjectQuality = await analyzeSubjectQuality(bytes, { category: classification.category, faces: faces ?? {}, person, vision: visionExplanation ?? {} }) }
      catch (error) { quality.subjectQuality = { status: 'unavailable', clarityScore: null, blurRisk: 'unknown', regions: [], reason: error.message } }
      quality.subjectQualityMs = Math.round(performance.now() - subjectStarted)
      if (quality.subjectQuality.blurRisk === 'high') classification.explanation = `${classification.explanation ?? ''} 主体候选区域存在明显清晰度风险，不自动入选精选；可查看原图确认。`.trim()
      const evidence = buildModelEvidence({ classification, candidates, scene, person, faces, quality, backend: provider, device, npuVerified: verifiedNpu, npuEvidence })
      const totalMs = performance.now() - startedAt
      return { ...classification, ...quality, candidates, faces, faceError, width, height, backend: provider, device, fallbackReason, classificationMs: Math.round(classificationMs), durationMs: Math.round(totalMs), timings: { decodePreprocessMs: Number(decodePreprocessMs.toFixed(2)), classificationMs: Number(classificationMs.toFixed(2)), faceMs: Number(faceMs.toFixed(2)), qualityMs: Number(qualityMs.toFixed(2)), auxiliaryMs: Number(auxiliaryMs.toFixed(2)), visionMs: Number(visionMs.toFixed(2)), totalMs: Number(totalMs.toFixed(2)) }, visionTriggered: visionTrigger.run, visionTriggerReason: visionTrigger.reason, visionCategoryApplied, npuVerified: verifiedNpu, npuEvidence: npuEvidence ? { providers: npuEvidence.providers, profile: npuEvidence.profile, profileScope: npuEvidence.profileScope, mixedCpuAuxiliary: npuEvidence.mixedCpuAuxiliary, profileEventCount: npuEvidence.profileEventCount, npuKernelCount: npuEvidence.npuKernelCount, npuKernelMs: npuEvidence.npuKernelMs, cpuKernelCount: npuEvidence.cpuKernelCount, cpuKernelMs: npuEvidence.cpuKernelMs } : null, personDetection: person, sceneSemantics: scene, modelEvidence: evidence, visionExplanation, visionModelStatus: visionLanguageExplainer.status }
    },
    get visionModelStatus() { return visionLanguageExplainer.status },
    async close() { try { await faceDetector.close() } finally { await personDetector.close(); await sceneAnalyzer.close(); await visionLanguageExplainer.close(); if (session) await session.release(); if (npuSession) await npuSession.close() } },
  }
}
