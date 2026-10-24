type Props = {
  value?: 'like' | 'dislike'
  ready: boolean
  onChange: (value: 'like' | 'dislike') => void
}

export default function PhotoSentiment({ value, ready, onChange }: Props) {
  return <fieldset className="photo-sentiment" disabled={!ready} aria-label="照片偏好">
    <button type="button" className="text-button" aria-pressed={value === 'like'} onClick={() => onChange('like')}>喜欢</button>
    <button type="button" className="text-button" aria-pressed={value === 'dislike'} onClick={() => onChange('dislike')}>不喜欢</button>
    <span role="status">{value === 'like' ? '已喜欢' : value === 'dislike' ? '已标记不喜欢' : '未表达偏好'}；偏好不改变保留或跳过状态</span>
  </fieldset>
}
