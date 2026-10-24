const ratio = (numerator, denominator) => denominator ? Number((numerator / denominator).toFixed(4)) : null

const isGenerated = row => row.result?.visionExplanation?.generated === true && row.result.visionExplanation.model === row.model
const isAbstained = row => row.result?.category === '待确认'
const proxyRows = rows => rows.filter(row => typeof row.proxyLabel === 'string' && row.proxyLabel.length > 0)

function summarizeRows(rows) {
  const visualRows = rows.filter(isGenerated)
  const labeledRows = proxyRows(visualRows)
  const selectiveRows = labeledRows.filter(row => !isAbstained(row))
  const agreement = labeledRows.filter(row => row.result?.category === row.proxyLabel).length
  const selectiveAgreement = selectiveRows.filter(row => row.result?.category === row.proxyLabel).length
  const durations = rows.map(row => Number(row.result?.durationMs)).filter(Number.isFinite).sort((left, right) => left - right)
  const percentile = value => durations.length ? durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * value))] : null
  return {
    attempted: rows.length,
    visualSuccess: visualRows.length,
    fallback: rows.filter(row => row.result?.visionExplanation?.generated !== true).length,
    abstained: visualRows.filter(isAbstained).length,
    reviewed: visualRows.filter(row => Number(row.result?.visionExplanation?.reviewCalls) > 1).length,
    proxyLabeled: labeledRows.length,
    proxyAgreement: labeledRows.length ? agreement : null,
    proxyAgreementRate: ratio(agreement, labeledRows.length),
    proxySelectiveCount: selectiveRows.length,
    proxySelectiveAgreement: selectiveRows.length ? selectiveAgreement : null,
    proxySelectiveAgreementRate: ratio(selectiveAgreement, selectiveRows.length),
    autoCoverage: ratio(visualRows.filter(row => !isAbstained(row)).length, visualRows.length),
    durationMs: { p50: percentile(0.5), p95: percentile(0.95) },
    independentAccuracy: null,
  }
}

export function summarizeGeneralEvaluation(rows = []) {
  const models = [...new Set(rows.map(row => row.model).filter(Boolean))]
  return models.map(model => {
    const modelRows = rows.filter(row => row.model === model)
    const summary = summarizeRows(modelRows)
    const slices = Object.fromEntries([...new Set(modelRows.map(row => row.slice).filter(Boolean))].map(slice => [slice, summarizeRows(modelRows.filter(row => row.slice === slice))]))
    const substituted = modelRows.filter(row => row.result?.visionExplanation?.model && row.result.visionExplanation.model !== model).length
    return { model, ...summary, substituted, slices }
  })
}
