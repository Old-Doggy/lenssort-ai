import sharp from 'sharp'
import { normalizeVision, semanticCategory, visionPrompt, visionSchema, visionReviewPrompt } from './vision-output.js'
import { chooseSafeModel } from './model-resource-policy.js'
import { inspectResources, ollamaRequest } from './model-resources.js'

const activeModels = new Set()

export async function createVisionLanguageExplainer({ model = process.env.LENSSORT_VLM_MODEL || 'auto', force = false, request = ollamaRequest, resources = inspectResources, onProgress = () => {} } = {}) {
  let selectedModel = 'off'
  let owned = false
  let digest = null
  let closed = false
  let inFlight = null
  let installed = []
  let installedDetails = []
  let reservedModel = null
  let status = { status: 'disabled', model: null, requestedModel: model, provider: 'ollama', device: null, message: '基础分析：不加载视觉大模型。' }
  const runningModels = async () => (await request('/api/ps', {}, 3000)).models ?? []
  const findModel = (items, name) => items.find(item => item.name === name || item.model === name)
  const release = async () => {
    const releasing = selectedModel
    try {
      if (owned) {
        const loaded = findModel(await runningModels(), releasing)
        if (loaded && digest && loaded.digest === digest) {
          await request('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: releasing, keep_alive: 0, stream: false }) }, 10000)
          status = { ...status, resident: false, message: `${status.message} 本批加载的模型已释放。` }
        }
      }
    } catch (error) { status = { ...status, releaseWarning: `释放确认失败：${error.message}；本批模型已设置30秒短驻留。` } }
    finally { if (reservedModel) activeModels.delete(reservedModel); reservedModel = null; owned = false; digest = null }
  }
  const select = async requested => {
    let tags
    let resident
    let available
    try {
      [tags, resident, available] = await Promise.all([request('/api/tags', {}, 3000), runningModels(), resources()])
    } catch (error) {
      if (force) throw new Error(`强制模型初始化失败：${error.message}`)
      throw error
    }
    installedDetails = tags.models ?? []
    installed = installedDetails.map(item => item.name || item.model)
    if (force && !installed.includes(requested)) throw new Error('强制模型初始化失败：所选模型未安装，不会自动换用其他模型')
    const decision = chooseSafeModel({ requested, installed, installedDetails, resident, resources: available, force })
    selectedModel = decision.selected
    if (selectedModel !== 'off' && activeModels.size > 0) {
      if (force) throw new Error('已有视觉模型任务正在运行，强制模式不会并发加载；请等待上一批结束后重试')
      selectedModel = 'off'
      decision.fallback = true
      decision.reason = '另一个本项目任务正在使用视觉模型，本批改用基础分析，避免多模型叠加。'
    }
    if (selectedModel !== 'off') { activeModels.add(selectedModel); reservedModel = selectedModel }
    status = { ...status, model: selectedModel === 'off' ? null : selectedModel, status: selectedModel === 'off' ? 'disabled' : 'ready', forced: decision.forced === true, fallback: decision.fallback, message: selectedModel === 'off' ? `${decision.reason}；本批使用基础分析。` : `${decision.reason}；本批使用 ${selectedModel}，结束释放本批加载的模型。` }
  }
  if (model !== 'off') {
    try { await select(model) }
    catch (error) {
      if (force) { await release(); throw error }
      status = { ...status, status: 'unavailable', message: `视觉模型不可用：${error.message}；使用基础分析。` }
    }
  }
  const explainOnce = async (bytes, { review = false } = {}) => {
    const [available, resident] = await Promise.all([resources(), runningModels()])
    if (available.freeRamGiB < 3 || (!force && available.freeVramGiB < 0.75)) throw new Error('资源安全保护：空闲内存低于3GiB或显存余量过低，停止请求而非换模型')
    const decision = chooseSafeModel({ requested: selectedModel, installed, installedDetails, resident, resources: available, force })
    if (decision.selected !== selectedModel) throw new Error('资源安全保护：当前资源不足以继续运行所选模型')
    const existing = findModel(resident, selectedModel)
    if (!existing) {
      owned = true
      status = { ...status, phase: 'loading-model', message: `正在加载 ${selectedModel}，首次加载最多等待120秒；尚未开始照片推理。` }
      onProgress({ phase: status.phase, message: status.message })
      try {
        await request('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: selectedModel, stream: false, keep_alive: '30s' }) }, 120000)
      } catch (cause) {
        throw Object.assign(new Error(`模型加载失败：${cause.message}`), { code: 'LENSSORT_VISION_PHOTO_FAILED', cause })
      } finally {
        const loaded = findModel(await runningModels().catch(() => []), selectedModel)
        if (loaded) digest = loaded.digest
      }
    }
    status = { ...status, phase: 'analyzing-photo', message: '模型已加载，正在分析照片；单次推理最多等待45秒。' }
    onProgress({ phase: status.phase, message: status.message })
    const edge = review ? 1536 : 1152
    const image = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().resize(edge, edge, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: review ? 92 : 90 }).toBuffer()
    let result
    try {
      result = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: selectedModel, stream: false, format: visionSchema, think: false, ...(owned ? { keep_alive: '30s' } : {}), messages: [{ role: 'user', content: review ? visionReviewPrompt : visionPrompt, images: [image.toString('base64')] }], options: { temperature: 0, seed: 42, num_ctx: 4096, num_predict: 420 } }) }, 45000)
    } catch (cause) {
      if (cause.name === 'TimeoutError' || cause.name === 'AbortError' || /timeout|timed out/i.test(cause.message)) throw Object.assign(new Error(`本张照片推理超时：${cause.message}`), { code: 'LENSSORT_VISION_PHOTO_FAILED', cause })
      throw cause
    } finally {
      try {
        const loaded = findModel(await runningModels(), selectedModel)
        if (owned && loaded) digest = loaded.digest
        const vramBytes = Number(loaded?.size_vram ?? 0)
        const modelBytes = Number(loaded?.size ?? 0)
        const fullyGpuResident = Boolean(loaded) && vramBytes > 0 && (!modelBytes || vramBytes >= modelBytes * 0.9)
        status = { ...status, resident: Boolean(loaded), fullyGpuResident, device: vramBytes > 0 ? `${fullyGpuResident ? 'GPU' : 'GPU/CPU 混合'} · Ollama 显存 ${Math.round(vramBytes / 1024 ** 2)} MB` : loaded ? 'CPU · 未检测到GPU驻留' : null }
      } catch {}
    }
    if (status.fullyGpuResident !== true && !force) throw new Error('资源安全保护：未确认模型完整驻留GPU，停止系统内存回退')
    let parsed
    try {
      if (result.done_reason === 'length') throw new Error('视觉描述被截断，未采用不完整输出')
      parsed = normalizeVision(result.message?.content || result.response)
    } catch (error) {
      error.code = 'LENSSORT_VISION_OUTPUT_INVALID'
      throw error
    }
    parsed.rawCategoryCandidate = parsed.categoryCandidate
    parsed.categoryCandidate = semanticCategory(parsed) || parsed.categoryCandidate
    parsed.explanation = `${parsed.summary} ${parsed.compositionComment} ${parsed.qualityComment}`.trim()
    status = { ...status, status: 'ready', message: `${status.fallback ? '已安全降级。' : ''}已由 ${selectedModel} 生成图片解释。` }
    return { ...parsed, model: selectedModel, provider: 'ollama', generated: true }
  }
  const explain = async (bytes, options) => {
    if (closed || selectedModel === 'off') throw new Error('当前使用基础分析，视觉大模型未启用')
    try { return await explainOnce(bytes, options) }
    catch (failure) {
      let currentError = failure
      if (currentError.code === 'LENSSORT_VISION_OUTPUT_INVALID') {
        try {
          const repaired = await explainOnce(bytes, { ...options, review: true })
          return { ...repaired, outputRepairCalls: 1, outputRepairReason: currentError.message }
        } catch (retryError) {
          if (retryError.code === 'LENSSORT_VISION_OUTPUT_INVALID') {
            status = { ...status, status: 'ready', lastPhotoError: retryError.message, message: `本张视觉输出两次无效：${retryError.message}；后续照片仍继续视觉复核。` }
            throw retryError
          }
          currentError = retryError
        }
      }
      if (currentError.code === 'LENSSORT_VISION_PHOTO_FAILED') {
        status = { ...status, status: 'ready', phase: 'photo-failed', lastPhotoError: currentError.message, message: `${currentError.message}；本张待确认，下一张仍使用原模型，不自动切换。` }
        onProgress({ phase: status.phase, message: status.message })
        throw currentError
      }
      const error = currentError
      const failedModel = selectedModel
      await release()
      if (!force && failedModel === 'qwen3.5:9b' && /memory|alloc|oom|timeout|timed out|资源安全/i.test(error.message)) {
        try {
          await select('auto')
          status = { ...status, fallback: true, message: `9B运行失败，已尝试安全降级：${error.message}` }
          if (selectedModel !== 'off') return await explainOnce(bytes, options)
        } catch { await release() }
      }
      selectedModel = 'off'
      status = { ...status, status: force ? 'failed' : 'disabled', model: null, fallback: !force, message: force ? `强制模型运行失败：${error.message}；本张照片未使用大模型描述。` : `大模型已保护性停用：${error.message}；后续照片继续基础分析，不伪造大模型描述。` }
      const terminalError = new Error(status.message)
      if (force) terminalError.code = 'LENSSORT_FORCED_MODEL_FAILED'
      throw terminalError
    }
  }
  return {
    get status() { return status },
    async explain(bytes, options = {}) {
      if (inFlight) throw new Error('本地视觉模型正在处理上一张照片')
      inFlight = explain(bytes, options)
      try { return await inFlight } finally { inFlight = null }
    },
    async close() {
      closed = true
      if (inFlight) await inFlight.catch(() => {})
      await release()
    },
  }
}
