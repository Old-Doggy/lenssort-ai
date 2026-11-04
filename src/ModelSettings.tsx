import { useEffect, useState } from 'react'

type ModelOption = { id: string; label: string; installed: boolean; minRamGiB: number; minVramGiB: number; advice: string; speed?: string; estimatedVramGiB?: number }
type ModelInfo = {
  resources: { totalRamGiB: number; freeRamGiB: number; totalVramGiB: number; freeVramGiB: number; gpuProbe?: string }
  options: ModelOption[]
  serviceMessage: string
  recommendation: { selected: string; reason: string; fallback: boolean }
}

export default function ModelSettings({ value, force, disabled, onChange, onForce }: { value: string; force: boolean; disabled: boolean; onChange: (model: string) => void; onForce: () => void }) {
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [openTip, setOpenTip] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch('/api/models', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error('暂时无法读取资源；启动时仍会进行安全检查')
        const next: ModelInfo = await response.json()
        if (active) { setInfo(next); setError('') }
      } catch { if (active) setError('暂时无法读取资源；启动时仍会进行安全检查') }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 10000)
    return () => { active = false; clearInterval(timer) }
  }, [revision, value])
  const selected = info?.options.find(item => item.id === value)
  const automaticSelection = value === 'auto' ? info?.options.find(item => item.id === info.recommendation.selected) : undefined
  const activeProfile = selected ?? automaticSelection
  const resourceWarning = selected && selected.id !== 'off' && info && (info.resources.freeRamGiB < selected.minRamGiB || (info.resources.gpuProbe === 'verified' && info.resources.freeVramGiB < selected.minVramGiB))
  const serviceAvailable = Boolean(info?.serviceMessage && !info.serviceMessage.includes('未连接'))
  const advice = (item: ModelOption) => `${item.advice}${item.id === 'off' ? '' : ` 建议至少空闲内存 ${item.minRamGiB} GiB、独立显存 ${item.minVramGiB} GiB；速度：${item.speed ?? '以本机实测为准'}`}${item.installed ? '' : ' 本机尚未安装，不能直接启用；应用不会自动下载'}`
  return <section className="model-settings" aria-label="模型与资源">
    <div className="model-settings-title"><div><strong>选一个适合电脑的模型</strong><p className="two-line-copy"><span>按钮旁的提示说明适合的电脑和速度</span><span>选择后自动保存，每批结束释放本批加载的模型</span></p></div><button type="button" disabled={disabled} onClick={() => setRevision(current => current + 1)}>更新资源</button></div>
    <div className={info ? `model-service-state ${serviceAvailable ? 'available' : 'unavailable'}` : 'model-service-state checking'} role="status"><span className="model-service-dot" aria-hidden="true" /><div><strong>{info?.serviceMessage ?? '正在检查本地视觉模型服务'}</strong><span>{serviceAvailable ? '自然语言解释可按选择的模型运行' : '基础分类不依赖 Ollama；服务未启动时仍可完成分类'}</span></div></div>
    <div className="model-advice-options" aria-label="模型选择建议">
      <div className="model-advice-option" onFocusCapture={() => setOpenTip('auto')} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenTip(null) }}>
        <button type="button" disabled={disabled} aria-label="选择 自动安全选择（推荐）" aria-pressed={value === 'auto'} aria-describedby="model-tip-auto" onClick={() => onChange('auto')}>自动安全选择<span aria-hidden="true"> ⓘ</span></button>
        <span className={openTip === 'auto' ? 'model-choice-tooltip two-line-copy is-open' : 'model-choice-tooltip two-line-copy'} role="tooltip" id="model-tip-auto"><span>推荐日常使用：优先选择本机已安装的4B模型</span><span>资源不足时使用基础分析，不自动加载9B</span></span>
      </div>
      {info?.options.map(item => <div className="model-advice-option" key={item.id} onFocusCapture={() => setOpenTip(item.id)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenTip(null) }}>
        <button type="button" disabled={disabled} aria-disabled={disabled || !item.installed} aria-label={'选择 ' + item.label} aria-pressed={value === item.id} aria-describedby={'model-tip-' + item.id.replaceAll(':', '-')} onClick={() => { if (!disabled && item.installed) onChange(item.id) }}>
          {item.label.replace(/（.*）/, '')}<span className="model-option-status" aria-hidden="true">{item.installed ? '已安装' : '未安装'}</span><span aria-hidden="true"> ⓘ</span>
        </button>
        <span className={openTip === item.id ? 'model-choice-tooltip is-open' : 'model-choice-tooltip'} role="tooltip" id={'model-tip-' + item.id.replaceAll(':', '-')}>{advice(item)}</span>
      </div>)}
    </div>
    <div className="model-option-hint" role="note" title={activeProfile?.advice ?? '优先使用已安装的4B模型；资源不足会明确降级到基础分析，不强行加载9B'}><strong>{value === 'auto' ? '当前自动建议' : '当前选择'}</strong><span>{activeProfile?.advice ?? '优先使用已安装的4B模型；资源不足会明确降级到基础分析，不强行加载9B'}</span>{activeProfile && activeProfile.id !== 'off' && <small>建议空闲：内存 {activeProfile.minRamGiB} GiB · 显存 {activeProfile.minVramGiB} GiB · 预计显存约 {activeProfile.estimatedVramGiB ?? '—'} GiB · 速度：{activeProfile.speed ?? '—'}</small>}{value === 'auto' && automaticSelection && <small className="model-auto-result">本次资源检查建议：{automaticSelection.label}</small>}{selected && selected.id !== 'off' && selected.installed && <button type="button" className="force-model-button" disabled={disabled} onClick={onForce}>{force ? '关闭强制使用' : '强制使用当前模型'}<span>{force ? '不会自动换小模型；失败会明确停止整批' : '跳过资源建议前会再次确认，仍需本机已安装该模型'}</span></button>}</div>
    {info && !info.options.some(item => item.id !== 'off' && item.installed) && <p className="model-install-hint two-line-copy" role="note"><span>当前只有基础分类可用，自然语言图片解释尚未安装本地视觉模型</span><span>首次安装后双击“安装本地视觉模型.cmd”，默认准备 Qwen 3.5 4B</span></p>}
    {info && <div className="model-resource-summary" role="status"><span>可用内存 <b>{info.resources.freeRamGiB.toFixed(1)} / {info.resources.totalRamGiB.toFixed(1)} GiB</b></span><span>{info.resources.gpuProbe === 'verified' ? <>可用独显显存 <b>{info.resources.freeVramGiB.toFixed(1)} / {info.resources.totalVramGiB.toFixed(1)} GiB</b></> : '独显显存暂未测得'}</span></div>}
    {resourceWarning && <p className="model-resource-warning two-line-copy" role="alert"><span>当前空闲资源低于“{selected?.label}”的建议值</span><span>可以继续尝试，也可以切换基础分析或4B模型；强制使用不会自动降级</span></p>}
    {force ? <p className="control-warning two-line-copy" role="status"><span>强制模式已开启：使用当前所选模型，不自动降级</span><span>可能混合使用系统内存而变慢；资源不足或模型报错时停止本批</span></p> : info?.recommendation.fallback && <p className="control-warning two-line-copy" role="status"><span>安全建议：{info.recommendation.reason}</span><span>本次预计使用 {info.options.find(item => item.id === info.recommendation.selected)?.label}，启动时会重新检查</span></p>}
    {error && <p role="status">{error}</p>}
    <small className="two-line-copy model-boundary-note"><span>此处控制大模型看图；上方的推理设备用于基础分类</span><span>大模型的实际设备由本地视觉服务决定</span><span>强制使用只取消自动降级，不会下载未安装模型</span></small>
  </section>
}
