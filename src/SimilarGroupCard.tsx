import PhotoSentiment from './PhotoSentiment'
import RecommendationExplanation, { type RecommendationExplanationData } from './RecommendationExplanation'

type GroupPhoto = {
  id: string
  title: string
  imageUrl?: string
  recommendationScore: number
  recommendationReason: string
  recommendationExplanation: RecommendationExplanationData
}

type Props = {
  groupId: string
  photos: GroupPhoto[]
  representative: GroupPhoto
  automaticTitle: string
  expanded: boolean
  ready: boolean
  feedback: Record<string, 'keep' | 'skip'>
  sentiment: Record<string, 'like' | 'dislike'>
  onSentiment: (id: string, value?: 'like' | 'dislike') => void
  clipSucceeded: number
  clipFailed: number
  clipAverage: number | null
  clipReference: string
  onExpand: () => void
  onReset: () => void
  onChoose: (id: string) => void
  onFeedback: (id: string, value?: 'keep' | 'skip') => void
  onView: (id: string) => void
}

export default function SimilarGroupCard(props: Props) {
  const currentFeedback = props.feedback[props.representative.id]
  return (
    <section className="similar-group-card" aria-label={`相似组 ${props.groupId}`}>
      <div className="group-title-row">
        <strong>{props.groupId.replace('similar-', '#')} · {props.photos.length} 张</strong>
        <span>已保留 {props.photos.filter((photo) => props.feedback[photo.id] === 'keep').length} 张</span>
      </div>
      <button type="button" className="group-preview" onClick={() => props.onView(props.representative.id)} aria-label={`查看代表图 ${props.representative.title}`}>
        {props.representative.imageUrl && <img src={props.representative.imageUrl} alt={props.representative.title} />}
      </button>
      <p className="group-current">当前候选：{props.representative.title}</p>
      <p>系统推荐：{props.automaticTitle} · 当前评分 {props.representative.recommendationScore}/100</p>
      <RecommendationExplanation explanation={props.representative.recommendationExplanation} compact />
      <p>{props.representative.recommendationReason}</p>
      <p role="status">{currentFeedback === 'keep' ? '已保留当前照片' : currentFeedback === 'skip' ? '已跳过当前照片；原图仍保留' : '尚未确认当前照片'}</p>
      <PhotoSentiment ready={props.ready} value={props.sentiment[props.representative.id]} onChange={(value) => props.onSentiment(props.representative.id, value)} />
      {(props.clipSucceeded > 0 || props.clipFailed > 0) && <small className="clip-group-status">CLIP 成功 {props.clipSucceeded} 张 · 失败 {props.clipFailed} 张 · 平均相似度 {props.clipAverage ?? '—'}<br />分析参照：{props.clipReference}；换一张不会重新计算 CLIP。</small>}
      <fieldset className="group-controls" disabled={!props.ready}>
        <button type="button" className="primary-small" onClick={() => props.onFeedback(props.representative.id, 'keep')} disabled={currentFeedback === 'keep'}>保留这张</button>
        <button type="button" className="secondary-button compact-button" onClick={() => {
          const currentIndex = props.photos.findIndex((photo) => photo.id === props.representative.id)
          const nextPhoto = Array.from({ length: props.photos.length - 1 }, (_, offset) => props.photos[(currentIndex + offset + 1) % props.photos.length])
            .find((photo) => props.feedback[photo.id] !== 'skip')
          if (nextPhoto) props.onChoose(nextPhoto.id)
        }} disabled={!props.photos.some((photo) => photo.id !== props.representative.id && props.feedback[photo.id] !== 'skip')}>换一张</button>
        <button type="button" className="secondary-button compact-button" onClick={props.onReset}>恢复系统推荐</button>
        <button type="button" className="text-button" aria-expanded={props.expanded} aria-controls={`members-${props.groupId}`} onClick={props.onExpand}>{props.expanded ? '收起相似组' : `展开相似组 (${props.photos.length})`}</button>
      </fieldset>
      {props.expanded && <ul className="group-members" id={`members-${props.groupId}`}>
        {props.photos.map((photo) => <li className="group-member" key={photo.id}>
          <button type="button" className="group-member-image" onClick={() => props.onView(photo.id)} aria-label={`查看照片 ${photo.title}`}>{photo.imageUrl && <img src={photo.imageUrl} alt={photo.title} />}</button>
          <div className="group-member-info"><strong>{photo.title}</strong><RecommendationExplanation explanation={photo.recommendationExplanation} compact /><p>{photo.recommendationScore}/100 · {photo.recommendationReason}</p><span>{props.feedback[photo.id] === 'keep' ? '已保留' : props.feedback[photo.id] === 'skip' ? '已跳过' : '待确认'}{photo.id === props.representative.id ? ' · 当前候选' : ''}</span></div>
          <fieldset className="group-member-actions" disabled={!props.ready}>
            <button type="button" className="text-button" onClick={() => props.onChoose(photo.id)} disabled={photo.id === props.representative.id}>选为候选</button>
            <button type="button" className="text-button" onClick={() => props.onFeedback(photo.id, 'keep')} disabled={props.feedback[photo.id] === 'keep'}>保留</button>
            <button type="button" className="text-button" onClick={() => props.onFeedback(photo.id, 'skip')} disabled={props.feedback[photo.id] === 'skip'}>跳过</button>
            {props.feedback[photo.id] && <button type="button" className="text-button" onClick={() => props.onFeedback(photo.id)}>撤销选择</button>}
          </fieldset>
          <PhotoSentiment ready={props.ready} value={props.sentiment[photo.id]} onChange={(value) => props.onSentiment(photo.id, value)} />
        </li>)}
      </ul>}
    </section>
  )
}
