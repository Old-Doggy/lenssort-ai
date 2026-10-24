import http from 'node:http'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'

export function mapDetectionToBase(detection, angle, baseWidth, baseHeight) {
  const box = detection.box ?? {}
  const x = Number(box.originX ?? 0)
  const y = Number(box.originY ?? 0)
  const width = Number(box.width ?? 0)
  const height = Number(box.height ?? 0)
  if (angle === 90) return { ...detection, box: { originX: y, originY: baseHeight - x - width, width: height, height: width } }
  if (angle === 180) return { ...detection, box: { originX: baseWidth - x - width, originY: baseHeight - y - height, width, height } }
  if (angle === 270) return { ...detection, box: { originX: baseWidth - y - height, originY: x, width: height, height: width } }
  return { ...detection, box: { originX: x, originY: y, width, height } }
}

export function shouldTryRotatedFaceVariants(result = {}) {
  return Number(result.faceCount ?? 0) === 0 || Number(result.maxConfidence ?? 0) < 0.65
}

export async function createLocalFaceDetector(root) {
  const assets = new Map([
    ['/vision.mjs', path.join(root, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')],
    ['/model', path.join(root, 'public/models/mediapipe/face_detector/blaze_face_short_range.tflite')],
  ])
  for (const variant of ['internal', 'module_internal', 'nosimd_internal']) {
    for (const extension of ['js', 'wasm']) {
      const name = 'vision_wasm_' + variant + '.' + extension
      assets.set('/wasm/' + name, path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm', name))
    }
  }
  const server = http.createServer(async (request, response) => {
    const route = new URL(request.url, 'http://127.0.0.1').pathname
    if (route === '/') { response.setHeader('content-type', 'text/html'); response.end('<html></html>'); return }
    const file = assets.get(route)
    if (!file) { response.writeHead(404); response.end(); return }
    try {
      const body = await readFile(file)
      response.setHeader('content-type', file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream')
      response.end(body)
    } catch { response.writeHead(500); response.end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  let browser
  const close = async () => {
    try { if (browser) await browser.close() }
    finally { await new Promise(resolve => server.close(resolve)) }
  }
  try {
    try { browser = await chromium.launch({ headless: true }) }
    catch (error) {
      if (process.platform !== 'win32') throw new Error(`本地浏览器运行时未安装，请运行 npx playwright install chromium：${error.message}`)
      browser = await chromium.launch({ channel: 'msedge', headless: true })
    }
    const page = await browser.newPage({ serviceWorkers: 'block' })
    const origin = 'http://127.0.0.1:' + server.address().port
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
    await page.goto(origin)
    await page.evaluate(async () => {
      const { FilesetResolver, FaceDetector } = await import('/vision.mjs')
      window.detector = await FaceDetector.createFromOptions(await FilesetResolver.forVisionTasks('/wasm'), {
        baseOptions: { modelAssetPath: '/model', delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      })
    })
    const detectOne = async bytes => page.evaluate(async base64 => {
          const binary = atob(base64)
          const pixels = Uint8Array.from(binary, character => character.charCodeAt(0))
          const bitmap = await createImageBitmap(new Blob([pixels], { type: 'image/jpeg' }))
          try {
            const detections = window.detector.detect(bitmap).detections.map(face => ({ score: face.categories?.[0]?.score ?? 0, box: face.boundingBox }))
            const area = detections.reduce((total, face) => total + ((face.box?.width ?? 0) * (face.box?.height ?? 0)), 0)
            return { faceCount: detections.length, imageWidth: bitmap.width, imageHeight: bitmap.height, maxConfidence: Math.max(0, ...detections.map(face => face.score)), faceAreaRatio: Math.min(1, area / (bitmap.width * bitmap.height)), detections }
          } finally { bitmap.close() }
        }, Buffer.from(bytes).toString('base64'))
    return {
      async detect(bytes) {
        const startedAt = performance.now()
        const base = await detectOne(bytes)
        const variants = [base]
        if (shouldTryRotatedFaceVariants(base)) {
          for (const angle of [90, 180, 270]) {
            const rotated = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate(angle).jpeg({ quality: 92 }).toBuffer()
            const result = await detectOne(rotated)
            variants.push({ ...result, detections: result.detections.map(detection => mapDetectionToBase(detection, angle, base.imageWidth, base.imageHeight)), rotation: angle })
          }
        }
        const result = variants.sort((left, right) => Number(right.faceCount) - Number(left.faceCount) || Number(right.maxConfidence) - Number(left.maxConfidence))[0]
        return { ...result, imageWidth: base.imageWidth, imageHeight: base.imageHeight, rotation: result.rotation ?? 0, rotationVariants: variants.length, durationMs: Math.round(performance.now() - startedAt) }
      },
      close,
    }
  } catch (error) { await close(); throw error }
}
