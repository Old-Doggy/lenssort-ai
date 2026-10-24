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
  useEffect(() => {
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch('/api/models', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error('暂时无法读取资源；启动时仍会进行安全检查。')
        const next: ModelInfo = await response.json()
        if (active) { setInfo(next); setError('') }
      } catch { if (active) setError('暂时无法读取资源；启动时仍会进行安全检查。') }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 10000)
    return () => { active = false; clearInterval(timer) }
  }, [revision, value])
  const selected = info?.options.find(item => item.id === value)
  const advice = (item: ModelOption) => `${item.advice}${item.id === 'off' ? '' : ` 建议至少空闲内存 ${item.minRamGiB} GiB、独立显存 ${item.minVramGiB} GiB；速度：${item.speed ?? '以本机实测为准'}。`}${item.installed ? '' : ' 本机尚未安装，不能直接启用；应用不会自动下载。'}`
  return <section className="model-settings" aria-label="模型与资源">
    <div className="model-settings-title"><div><strong>选一个适合电脑的模型</strong><p>默认平衡模式，不自动加载最大模型；每批结束释放本批加载的模型。</p></div><button type="button" onClick={() => setRevision(current => current + 1)}>更新资源</button></div>
    <div className="model-advice-options" aria-label="模型选择建议">
      <div className="model-advice-option">
        <button type="button" aria-label="选择 自动安全选择（推荐）" aria-pressed={value === 'auto'} aria-disabled={disabled} aria-describedby="model-tip-auto" onClick={() => { if (!disabled) onChange('auto') }}>自动安全选择<span> ⓘ</span></button>
        <span className="model-choice-tooltip" role="tooltip" id="model-tip-auto">推荐日常使用：优先选择本机已安装的4B模型；资源不足或模型不可用时降级到基础分析，不自动加载9B；启动前重新检查资源。</span>
      </div>
      {info?.options.map(item => <div className="model-advice-option" key={item.id}>
        <button type="button" aria-label={'选择 ' + item.label} aria-pressed={value === item.id} aria-disabled={disabled || !item.installed} aria-describedby={'model-tip-' + item.id.replaceAll(':', '-')} onClick={() => { if (!disabled && item.installed) onChange(item.id) }}>
          {item.label.replace(/（.*）/, '')}<span>{item.installed ? ' ⓘ' : ' · 未安装 ⓘ'}</span>
        </button>
        <span className="model-choice-tooltip" role="tooltip" id={'model-tip-' + item.id.replaceAll(':', '-')}>{advice(item)}</span>
      </div>)}
    </div>
    <div className="model-option-hint" role="note" title={selected?.advice ?? '优先使用已安装的4B模型；资源不足会明确降级到基础分析，不强行加载9B。'}><strong>选择建议</strong><span>{selected?.advice ?? '优先使用已安装的4B模型；资源不足会明确降级到基础分析，不强行加载9B。'}</span>{selected && selected.id !== 'off' && <small>建议空闲：内存 {selected.minRamGiB} GiB · 显存 {selected.minVramGiB} GiB · 预计显存约 {selected.estimatedVramGiB ?? '—'} GiB · 速度：{selected.speed ?? '—'}</small>}{selected && selected.id !== 'off' && selected.installed && <button type="button" className="force-model-button" disabled={disabled} onClick={onForce}>{force ? '关闭强制使用' : '强制使用当前模型'}<span>{force ? '不会自动换小模型；失败会明确停止整批' : '跳过资源建议前会再次确认，仍需本机已安装该模型'}</span></button>}</div>
    {info && <p className="model-resource-summary">当前可用内存 {info.resources.freeRamGiB.toFixed(1)} / {info.resources.totalRamGiB.toFixed(1)} GiB · {info.resources.gpuProbe === 'verified' ? `可用独显显存 ${info.resources.freeVramGiB.toFixed(1)} / ${info.resources.totalVramGiB.toFixed(1)} GiB` : '显存余量未知，保守使用基础分析'}</p>}
    {force ? <p className="control-warning" role="status">强制模式已开启：使用当前所选模型，不自动降级。可能混合使用系统内存而变慢；空闲内存低于3GiB或模型报错时停止本批。更换模型需重新确认。</p> : info?.recommendation.fallback && <p className="control-warning" role="status">安全建议：{info.recommendation.reason}，本次预计使用 {info.options.find(item => item.id === info.recommendation.selected)?.label}。启动时会重新检查。</p>}
    {error && <p role="status">{error}</p>}
    <small>此处控制大模型看图；高级设置中的核显/NPU用于基础识别，不代表大模型也在该设备上运行。运行中不能更换模型；选择后自动保存。强制使用只取消自动降级，不会下载未安装模型。</small>
  </section>
}
