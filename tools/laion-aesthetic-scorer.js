import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { env, pipeline } from '@huggingface/transformers'

export async function createLaionAestheticScorer(root) {
  const weights = JSON.parse(await readFile(path.join(root, 'artifacts', 'p2-laion-aesthetic-weights.json'), 'utf8'))
  if (weights.weightDimension !== 512 || weights.weight.length !== 512 || !Number.isFinite(weights.bias)) throw new Error('LAION 审美权重无效')
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.localModelPath = path.join(root, 'public', 'models')
  let extractorPromise
  const load = async () => {
    extractorPromise ??= pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', { device: 'cpu', dtype: 'q8', local_files_only: true })
    return extractorPromise
  }
  return {
    async score(bytes) {
      try {
        const extractor = await load()
        const output = await extractor(new Blob([bytes]))
        const values = Array.from(output.data, Number)
        const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
        if (!Number.isFinite(norm) || norm === 0 || values.length !== 512) throw new Error('CLIP embedding 无效')
        const embedding = values.map(value => value / norm)
        const score = embedding.reduce((sum, value, index) => sum + value * weights.weight[index], weights.bias)
        return { status: 'succeeded', source: 'LAION aesthetic V1', score, normalizedScore: null, durationMs: 0 }
      } catch (error) {
        return { status: 'unavailable', source: 'LAION aesthetic V1', score: null, normalizedScore: null, durationMs: 0, error: error instanceof Error ? error.message : String(error) }
      }
    },
    async close() {
      if (!extractorPromise) return
      try { const extractor = await extractorPromise; if (typeof extractor.dispose === 'function') await extractor.dispose() }
      finally { extractorPromise = null }
    },
  }
}
