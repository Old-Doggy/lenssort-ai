import os from 'node:os'

const MIN_FREE_MEMORY = 2.5 * 1024 ** 3

export async function scoreCurationBatch({ records, validate, onProgress = () => {}, freeMemory = os.freemem, laionFactory, musiqFactory }) {
  const candidates = records.filter(record => record.status === 'done')
  const sources = []
  const warnings = []
  if (!candidates.length) return { sources, warnings }
  for (const record of candidates) {
    record.aestheticScore = null
    record.musiqScore = null
  }
  if (freeMemory() < MIN_FREE_MEMORY) {
    warnings.push('可用内存低于2.5 GiB，已跳过审美模型，改用技术质量回退。')
    return { sources, warnings }
  }
  let scorer = null
  try {
    scorer = await laionFactory?.()
    if (scorer) {
      onProgress({ phase: 'aesthetic-laion', completed: 0, total: candidates.length, message: '正在进行第一轮审美评分…' })
      for (let index = 0; index < candidates.length; index++) {
        if (freeMemory() < MIN_FREE_MEMORY) { warnings.push('可用内存不足，提前结束LAION评分，未评分照片留待人工。'); break }
        const record = candidates[index]
        try {
          const { bytes } = await validate(record)
          const result = await scorer.score(bytes)
          if (result?.status === 'succeeded' && Number.isFinite(result.score)) record.aestheticScore = result.score
          else warnings.push(`${record.name} 的LAION评分不可用。`)
        } catch (error) { warnings.push(`${record.name} 的LAION评分失败：${error.message}`) }
        onProgress({ phase: 'aesthetic-laion', completed: index + 1, total: candidates.length, message: '第一轮审美评分完成' })
      }
      if (candidates.some(record => Number.isFinite(record.aestheticScore))) sources.push('LAION')
    } else warnings.push('LAION评分器未安装或不可用。')
  } catch (error) { warnings.push('LAION评分器不可用：' + error.message) }
  finally { if (scorer?.close) await scorer.close().catch(error => warnings.push('LAION释放失败：' + error.message)) }
  scorer = null
  if (freeMemory() < MIN_FREE_MEMORY) {
    warnings.push('第一轮评分后可用内存不足，已跳过MUSIQ，保留LAION结果。')
    return { sources, warnings }
  }
  try {
    scorer = await musiqFactory?.()
    if (scorer) {
      onProgress({ phase: 'aesthetic-musiq', completed: 0, total: candidates.length, message: '正在进行第二轮审美复核…' })
      const items = []
      for (const record of candidates) {
        try { const { source } = await validate(record); items.push({ id: record.id, path: source }) }
        catch (error) { warnings.push(`${record.name} 无法进入MUSIQ评分：${error.message}`) }
      }
      const report = await scorer.scoreBatch(items, progress => onProgress({ phase: 'aesthetic-musiq', ...progress, message: '第二轮审美复核进行中…' }))
      const results = new Map((report?.results ?? []).filter(item => Number.isFinite(item.score)).map(item => [item.id, item]))
      for (const record of candidates) {
        const result = results.get(record.id)
        if (result && (!record.hash || result.sha256 === record.hash)) record.musiqScore = result.score
      }
      if (results.size) sources.push('MUSIQ-AVA')
      if (report?.status === 'unavailable') warnings.push('MUSIQ评分器不可用，已保留其他评分结果。')
      if (results.size < candidates.length) warnings.push('部分照片未完成MUSIQ复核，采用已有评分，不伪造分数。')
    } else warnings.push('MUSIQ评分器未安装或不可用，保留已有评分。')
  } catch (error) { warnings.push('MUSIQ评分失败，已保留其他评分结果：' + error.message) }
  finally { if (scorer?.close) await scorer.close().catch(error => warnings.push('MUSIQ释放失败：' + error.message)) }
  return { sources, warnings }
}
