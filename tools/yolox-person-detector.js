import path from 'node:path'
import { readFile } from 'node:fs/promises'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'

const DEFAULT_MODEL = 'data/p2-candidates/yolox_tiny/yolox_tiny.onnx'
const INPUT_SIZE = 416
const PERSON_CLASS_INDEX = 0

export function createTileRegions(width, height) {
  const tileWidth = Math.min(width, Math.max(1, Math.ceil(width * 0.6)))
  const tileHeight = Math.min(height, Math.max(1, Math.ceil(height * 0.6)))
  const left = Math.max(0, width - tileWidth)
  const top = Math.max(0, height - tileHeight)
  const regions = [
    { left: 0, top: 0, width: tileWidth, height: tileHeight },
    { left, top: 0, width: tileWidth, height: tileHeight },
    { left: 0, top, width: tileWidth, height: tileHeight },
    { left, top, width: tileWidth, height: tileHeight },
  ]
  return [...new Map(regions.map(region => [Object.values(region).join(','), region])).values()]
}

export function shouldUsePersonTiles(boxes, largeImage) {
  const maxScore = Math.max(0, ...boxes.map(box => Number(box.score) || 0))
  return largeImage && maxScore < 0.4
}

function tensorToRows(tensor) {
  const dims = tensor.dims ?? []
  const values = tensor.data
  if (dims.length !== 3 || dims[0] !== 1) throw new Error(`unexpected YOLOX output dims: ${JSON.stringify(dims)}`)
  if (dims[2] >= 6 && dims[2] <= 100) return { rows: dims[1], rowSize: dims[2], get: (row, column) => values[row * dims[2] + column] }
  if (dims[1] >= 6 && dims[1] <= 100) return { rows: dims[2], rowSize: dims[1], get: (row, column) => values[column * dims[2] + row] }
  throw new Error(`unsupported YOLOX output dims: ${JSON.stringify(dims)}`)
}

function iou(left, right) {
  const x1 = Math.max(left.x, right.x)
  const y1 = Math.max(left.y, right.y)
  const x2 = Math.min(left.x + left.width, right.x + right.width)
  const y2 = Math.min(left.y + left.height, right.y + right.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

function nms(candidates, threshold = 0.45) {
  const remaining = [...candidates].sort((left, right) => right.score - left.score)
  const kept = []
  while (remaining.length) {
    const current = remaining.shift()
    kept.push(current)
    for (let index = remaining.length - 1; index >= 0; index--) if (iou(current, remaining[index]) >= threshold) remaining.splice(index, 1)
  }
  return kept
}

async function makeInput(bytes) {
  const metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().metadata()
  const width = metadata.autoOrient?.width ?? metadata.width ?? 1
  const height = metadata.autoOrient?.height ?? metadata.height ?? 1
  const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height)
  const resizedWidth = Math.max(1, Math.round(width * scale))
  const resizedHeight = Math.max(1, Math.round(height * scale))
  const rgb = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().resize(resizedWidth, resizedHeight, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer()
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE)
  chw.fill(114)
  for (let y = 0; y < resizedHeight; y++) for (let x = 0; x < resizedWidth; x++) {
    const source = (y * resizedWidth + x) * 3
    const target = y * INPUT_SIZE + x
    chw[target] = rgb[source]
    chw[INPUT_SIZE * INPUT_SIZE + target] = rgb[source + 1]
    chw[2 * INPUT_SIZE * INPUT_SIZE + target] = rgb[source + 2]
  }
  return { tensor: new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]), width, height, scale }
}

function decode(output, transform) {
  const table = tensorToRows(output)
  const candidates = []
  const grids = []
  for (const stride of [8, 16, 32]) for (let y = 0; y < INPUT_SIZE / stride; y++) for (let x = 0; x < INPUT_SIZE / stride; x++) grids.push({ x, y, stride })
  if (grids.length !== table.rows) throw new Error(`YOLOX grid rows ${grids.length} do not match output rows ${table.rows}`)
  for (let row = 0; row < table.rows; row++) {
    const grid = grids[row]
    const objectness = table.get(row, 4)
    const classScore = table.get(row, 5 + PERSON_CLASS_INDEX)
    const score = objectness * classScore
    if (!Number.isFinite(score) || score < 0.15) continue
    const centerX = (table.get(row, 0) + grid.x) * grid.stride
    const centerY = (table.get(row, 1) + grid.y) * grid.stride
    const boxWidth = Math.exp(table.get(row, 2)) * grid.stride
    const boxHeight = Math.exp(table.get(row, 3)) * grid.stride
    const x = (centerX - boxWidth / 2) / transform.scale
    const y = (centerY - boxHeight / 2) / transform.scale
    const width = boxWidth / transform.scale
    const height = boxHeight / transform.scale
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue
    candidates.push({ score, x, y, width, height, areaRatio: Math.min(1, (width * height) / (transform.width * transform.height)), objectness, classScore })
  }
  return nms(candidates)
}

function mergeBoxes(candidates) {
  const remaining = [...candidates].sort((left, right) => right.score - left.score)
  const merged = []
  while (remaining.length) {
    const current = remaining.shift()
    const overlaps = [current]
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (iou(current, remaining[index]) >= 0.45) overlaps.push(...remaining.splice(index, 1))
    }
    merged.push({ ...current, tileSupport: new Set(overlaps.map(item => item.source ?? 'full')).size })
  }
  return merged
}

export function mergePersonCandidates(fullBoxes, tileResults, regions, width, height) {
  const mapped = [...fullBoxes.map(box => ({ ...box, source: 'full', tileSupport: 1 }))]
  for (let index = 0; index < tileResults.length; index++) {
    const region = regions[index]
    for (const box of tileResults[index] ?? []) if (Number(box.score) >= 0.25) {
      const x = Math.max(0, box.x + region.left)
      const y = Math.max(0, box.y + region.top)
      const right = Math.min(width, x + box.width)
      const bottom = Math.min(height, y + box.height)
      if (right <= x || bottom <= y) continue
      mapped.push({ ...box, x, y, width: right - x, height: bottom - y, areaRatio: ((right - x) * (bottom - y)) / (width * height), source: `tile-${index}` })
    }
  }
  return mergeBoxes(mapped).map(({ source: _source, ...box }) => box)
}

export async function createYoloxPersonDetector(root) {
  const modelPath = path.join(root, DEFAULT_MODEL)
  try {
    await readFile(modelPath)
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], executionMode: 'sequential' })
    const inputName = session.inputNames[0]
    const outputName = session.outputNames[0]
    const run = async bytes => {
      const input = await makeInput(bytes)
      const output = await session.run({ [inputName]: input.tensor })
      return { input, boxes: decode(output[outputName], input) }
    }
    return {
      async detect(bytes) {
        const startedAt = performance.now()
        const full = await run(bytes)
        let boxes = full.boxes
        let tileCount = 0
        if (shouldUsePersonTiles(boxes, Math.max(full.input.width, full.input.height) >= 1600)) {
          const regions = createTileRegions(full.input.width, full.input.height)
          const tileResults = []
          for (const region of regions) {
            const tile = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().extract(region).jpeg({ quality: 90 }).toBuffer()
            tileResults.push((await run(tile)).boxes)
          }
          boxes = mergePersonCandidates(full.boxes, tileResults, regions, full.input.width, full.input.height)
          tileCount = regions.length
        }
        return { status: 'succeeded', source: 'YOLOX Tiny', imageWidth: full.input.width, imageHeight: full.input.height, candidateCount: boxes.length, maxScore: boxes[0]?.score ?? 0, boxes, tileCount, durationMs: Math.round(performance.now() - startedAt) }
      },
      async close() { await session.release() },
    }
  } catch (error) {
    return { detect: async () => ({ status: 'unavailable', source: 'YOLOX Tiny', candidateCount: null, maxScore: null, boxes: [], durationMs: 0, error: error instanceof Error ? error.message : String(error) }), close: async () => {} }
  }
}
