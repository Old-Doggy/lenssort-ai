const categories = ['单人', '多人', '人物与风景', '风景', '动物', '其他', '待确认']
const generated = row => row.result?.visionExplanation?.generated === true && row.result.visionExplanation.model === row.model
const accepted = row => [row.expected, ...(row.alternatives ?? [])].filter(value => categories.includes(value))
const matchesReference = row => accepted(row).includes(row.result?.category)
const isAmbiguous = row => row.ambiguous === true || (row.alternatives ?? []).length > 0
const ratio = (value, total) => total ? Number((value / total).toFixed(4)) : null

function summarizeRows(rows) {
  const valid = rows.filter(generated)
  const labeled = valid.filter(row => accepted(row).length > 0)
  const strict = labeled.filter(row => !isAmbiguous(row))
  const acceptedRows = labeled.filter(matchesReference)
  const strictMatches = strict.filter(matchesReference)
  const automatic = valid.filter(row => row.result?.category !== '待确认')
  const automaticStrict = strict.filter(row => row.result?.category !== '待确认')
  const durations = valid.map(row => Number(row.result?.durationMs)).filter(Number.isFinite).sort((a, b) => a - b)
  const percentile = level => durations.length ? durations[Math.floor((durations.length - 1) * level)] : null
  const confusion = {}
  const supported = [...new Set(strict.map(row => row.expected))]
  const perClass = Object.fromEntries(supported.map(category => {
    const tp = strict.filter(row => row.expected === category && row.result.category === category).length
    const fp = strict.filter(row => row.expected !== category && row.result.category === category).length
    const fn = strict.filter(row => row.expected === category && row.result.category !== category).length
    return [category, { support: tp + fn, tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0 }]
  }))
  for (const row of labeled) {
    const key = `${row.expected} -> ${row.result?.category}`
    confusion[key] = (confusion[key] ?? 0) + 1
  }
  return {
    attempted: rows.length,
    visualSuccess: valid.length,
    fallback: rows.length - valid.length,
    labeled: labeled.length,
    ambiguous: labeled.filter(isAmbiguous).length,
    strictLabeled: strict.length,
    referenceAgreement: acceptedRows.length,
    referenceAgreementRate: ratio(acceptedRows.length, labeled.length),
    strictAgreement: strictMatches.length,
    strictAgreementRate: ratio(strictMatches.length, strict.length),
    autoCoverage: ratio(automatic.length, valid.length),
    strictAutoCoverage: ratio(automaticStrict.length, strict.length),
    falseDefiniteReference: strict.filter(row => row.result?.category !== '待确认' && !matchesReference(row)).length,
    falseDefiniteReferenceRate: ratio(strict.filter(row => row.result?.category !== '待确认' && !matchesReference(row)).length, strict.length),
    strictMacroF1: supported.length ? Number((Object.values(perClass).reduce((total, item) => total + item.f1, 0) / supported.length).toFixed(4)) : null,
    perClass,
    reviewed: valid.filter(row => Number(row.result?.visionExplanation?.reviewCalls) > 1).length,
    durationMs: { p50: percentile(0.5), p95: percentile(0.95) },
    confusion,
    independentAccuracy: null,
  }
}

export function summarizeG2Evaluation(rows = []) {
  return [...new Set(rows.map(row => row.model).filter(Boolean))].map(model => {
    const modelRows = rows.filter(row => row.model === model)
    const slices = Object.fromEntries([...new Set(modelRows.map(row => row.split).filter(Boolean))].map(split => [split, summarizeRows(modelRows.filter(row => row.split === split))]))
    return { model, ...summarizeRows(modelRows), slices }
  })
}
