export type RecommendationExplanationData = {
  status: 'recommended' | 'review' | 'lower-priority' | 'skipped'
  statusLabel: string
  summary: string
  reason: string
  strengths: string[]
  cautions: string[]
  exportEligible: boolean
  exportState: 'demo' | 'auto' | 'manual-keep' | 'needs-review' | 'skipped'
  exportReason: string
  scoreBreakdown: {
    quality: number
    modeFit: number
    feedback: number
    total: number
  }
}

type Props = {
  explanation: RecommendationExplanationData
  compact?: boolean
}

export default function RecommendationExplanation({ explanation, compact = false }: Props) {
  return <div className={`recommendation-explanation ${compact ? 'compact' : ''}`} aria-label="推荐解释">
    <div className="recommendation-explanation-heading">
      <span className={`recommendation-status ${explanation.status}`}>{explanation.statusLabel}</span>
      <span className="recommendation-score-note">评分 {explanation.scoreBreakdown.total}/100</span>
    </div>
    <p className="recommendation-summary">{explanation.summary}</p>
    {compact && <p className="recommendation-export-note">{explanation.exportReason}</p>}
    {!compact && <>
      {explanation.strengths.length > 0 && <div className="recommendation-factor-group positive"><strong>支持因素</strong><ul>{explanation.strengths.map((factor) => <li key={factor}>{factor}</li>)}</ul></div>}
      {explanation.cautions.length > 0 && <div className="recommendation-factor-group caution"><strong>需要确认</strong><ul>{explanation.cautions.map((factor) => <li key={factor}>{factor}</li>)}</ul></div>}
      <div className="recommendation-breakdown"><span>质量 {explanation.scoreBreakdown.quality}</span><span>模式匹配 {explanation.scoreBreakdown.modeFit}</span><span>偏好调整 {explanation.scoreBreakdown.feedback > 0 ? `+${explanation.scoreBreakdown.feedback}` : explanation.scoreBreakdown.feedback}</span></div>
    </>}
  </div>
}
