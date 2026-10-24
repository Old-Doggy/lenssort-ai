import { effectiveClarity } from './curation-ranking.js'

function similar(left, right) {
  if (left.deviation < 8 || right.deviation < 8 || !left.fingerprint?.length || left.fingerprint.length !== right.fingerprint?.length) return false
  if (Math.abs(Math.log(left.aspect / right.aspect)) > 0.03) return false
  if (left.color.some((value, index) => Math.abs(value - right.color[index]) > 12)) return false
  const matches = left.fingerprint.reduce((total, value, index) => total + Number(value === right.fingerprint[index]), 0)
  return matches / left.fingerprint.length >= 0.975
}

export function groupCurationCandidates(candidates) {
  const groups = []
  const hashes = new Set()
  const byScore = (left, right) => right.score - left.score || String(left.record.id).localeCompare(String(right.record.id))
  for (const candidate of [...candidates].sort(byScore)) {
    if (hashes.has(candidate.hash)) continue
    hashes.add(candidate.hash)
    const group = groups.find(item => similar(item.anchor, candidate))
    if (group) group.candidates.push(candidate)
    else groups.push({ anchor: candidate, candidates: [candidate] })
  }
  return groups.map(group => {
    const contenders = group.candidates.filter(candidate => group.anchor.score - candidate.score <= 5)
    const [representative] = contenders.sort((left, right) => {
      const clarityDelta = Number(right.clarityScore ?? effectiveClarity(right.record) ?? 0) - Number(left.clarityScore ?? effectiveClarity(left.record) ?? 0)
      return clarityDelta || byScore(left, right)
    })
    return { ...representative, similarityGroup: group.anchor.hash.slice(0, 24), similarityMembers: group.candidates.map(candidate => candidate.record.id) }
  }).sort(byScore)
}
