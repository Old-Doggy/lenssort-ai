const finite = value => typeof value === 'number' && Number.isFinite(value)
const clamp = value => Math.max(0, Math.min(100, value))

export function effectiveClarity(record) {
  const subject = record.subjectQuality
  return subject?.status === 'measured' && finite(subject.clarityScore) ? subject.clarityScore : finite(record.clarityScore) ? record.clarityScore : record.qualityScore
}

function percentile(value, samples) {
  if (!finite(value) || !samples.length) return null
  if (samples.length === 1) return 50
  const below = samples.filter(sample => sample < value).length
  const equal = samples.filter(sample => sample === value).length
  return 100 * (below + (equal - 1) / 2) / (samples.length - 1)
}

export function rankCurationRecords(records) {
  const eligible = records.filter(record => record.status === 'done' && typeof record.output === 'string'
    && finite(record.qualityScore) && effectiveClarity(record) >= 35 && record.subjectQuality?.blurRisk !== 'high')
  const unique = [...new Map(eligible.map(record => [record.hash || record.id, record])).values()]
  const laion = unique.map(record => record.aestheticScore).filter(finite)
  const musiq = unique.map(record => record.musiqScore).filter(finite)
  const modelAvailable = laion.length > 0 || musiq.length > 0
  return eligible.filter(record => !modelAvailable || finite(record.aestheticScore) || finite(record.musiqScore)).map(record => {
    const aestheticRank = percentile(record.aestheticScore, laion)
    const musiqRank = percentile(record.musiqScore, musiq)
    const clarity = clamp(effectiveClarity(record))
    const penalty = Math.min(8, Math.max(0, 55 - clarity) * 0.15)
    const basis = aestheticRank !== null ? 'aesthetic' : musiqRank !== null ? 'musiq-only' : 'technical-fallback'
    const modelScore = aestheticRank !== null && musiqRank !== null ? aestheticRank * 0.75 + musiqRank * 0.25 : aestheticRank ?? musiqRank
    const score = modelScore === null ? clamp(record.qualityScore * 0.3 + clarity * 0.7) : clamp(10 + modelScore * 0.9 - penalty)
    const reasons = [modelScore === null ? '审美模型不可用，仅按技术质量回退，不代表审美评分' : '专用审美模型相对排名优先；不是美感准确率或绝对分数']
    if (record.subjectQuality?.status === 'measured') reasons.push(`主体区域技术清晰度 ${Math.round(clarity)}/100；背景清晰不替代主体清晰`)
    if (aestheticRank !== null) reasons.push(`LAION审美相对排名 ${Math.round(aestheticRank)}/100`)
    if (musiqRank !== null) reasons.push(`MUSIQ-AVA辅助相对排名 ${Math.round(musiqRank)}/100`)
    if (penalty > 0) reasons.push('清晰度风险降低精选优先级；低于硬门槛的照片不自动入选')
    if (record.exposureStatus && record.exposureStatus !== '曝光均衡') reasons.push('保留夜景、高调和高反差；不按整体明暗一票否决')
    if (record.category === '待确认') reasons.push('分类待确认不影响参与精选')
    return { record, score: Number(score.toFixed(2)), aestheticRank, musiqRank, basis, reasons }
  }).sort((left, right) => right.score - left.score || String(left.record.name).localeCompare(String(right.record.name)))
}
