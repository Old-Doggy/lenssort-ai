type CurationDetail = { selectionBasis: string; aestheticRank?: number | null; musiqRank?: number | null; qualityReasons: string[] }
export type CurationRecord = { id: string; name: string; curated?: boolean; curationDetails?: CurationDetail | null; subjectQuality?: { status: string; clarityScore: number | null; blurRisk: string } | null }

function SubjectQuality({ record }: { record: CurationRecord }) {
  const quality = record.subjectQuality
  if (!quality || quality.status === 'not-applicable') return null
  return <section className="photo-curation-explanation" aria-label="主体清晰度提示"><strong>主体清晰度</strong><p>{quality.status !== 'measured' ? '主体区域太小或证据不足，暂时无法可靠判断；不会把未知结果当成清晰。' : quality.blurRisk === 'high' ? '主体候选区域存在明显虚焦风险，不自动推荐。背景清晰不能代替主体清晰，建议查看原图确认。' : `主体区域清晰度参考 ${quality.clarityScore}/100。这里只检查局部技术质量，不代表审美评分或主体识别一定正确。`}</p></section>
}

export default function CurationResults({ record }: { record: CurationRecord }) {
  if (!record.curated || !record.curationDetails) return <SubjectQuality record={record} />
  const detail = record.curationDetails
  return <><SubjectQuality record={record} /><section className="photo-curation-explanation" aria-label="辅助推荐依据">
    <div className="photo-curation-title"><strong>为什么推荐这张照片</strong><span>仅供参考，不代表最符合你的审美</span></div>
    <p>{detail.selectionBasis === 'technical-fallback' ? '审美模型不可用，本张按技术质量回退保留，不代表模型认为它一定好看。' : '这张照片在本批中获得较高的专用审美模型相对排名，并通过技术风险与相似照片筛选。'}</p>
    <div className="photo-curation-ranks">{detail.aestheticRank !== null && detail.aestheticRank !== undefined && <span>LAION 审美排名：{Math.round(detail.aestheticRank)}/100</span>}{detail.musiqRank !== null && detail.musiqRank !== undefined && <span>MUSIQ 辅助排名：{Math.round(detail.musiqRank)}/100</span>}</div>
    <ul>{detail.qualityReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
  </section></>
}
