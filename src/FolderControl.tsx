import { useEffect, useState } from 'react'
import './FolderControl.css'
import ModelSettings from './ModelSettings'
import CurationResults, { type CurationRecord } from './CurationResults'

type Config = { input: string; output: string; backend: string; model: string; forceModel?: boolean }
type VisionExplanation = { summary?: string; subjects?: string[]; scene?: string; qualityComment?: string; recommendation?: string; confidence?: number; categoryCandidate?: string | null; categoryApplied?: boolean; categoryDecision?: string; triggerReason?: string; cautions?: string[]; model?: string; generated?: boolean; error?: string }
type RecordItem = { id: string; name: string; status: string; manualAction?: string | null; manualCategory?: string | null; manualCategoryAt?: string | null; category?: string; sceneLabel?: string | null; reason?: string; explanation?: string | null; qualityScore?: number; qualityReasons?: string[]; clarityScore?: number; exposureStatus?: string; faceCount?: number; curated?: boolean; error?: string; durationMs?: number; device?: { name: string }; npuVerified?: boolean; npuEvidence?: { npuKernelCount?: number | null; npuKernelMs?: number | null; profileScope?: string | null; cpuKernelCount?: number | null; cpuKernelMs?: number | null; mixedCpuAuxiliary?: boolean } | null; imageUrl?: string; visionTriggered?: boolean; visionTriggerReason?: string; visionCategoryApplied?: boolean; visionExplanation?: VisionExplanation | null }
type Progress = { phase: string; completed: number; total: number; pending: number; currentFile?: string | null; message: string }
type CurationStatus = { phase: string; sources: string[]; warnings: string[]; considered: number; selected: number }
type Status = { token: string; config: Config; configWarning?: string | null; phase: string; error?: string; device?: { name: string }; devices: Array<{ id: string; name: string }>; records: RecordItem[]; npuVerified: boolean; progress: Progress; curation?: CurationStatus; visionModelStatus?: { status: string; model?: string; message?: string; device?: string | null } | null }
const categories = ['全部', '辅助推荐', '单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认', '失败']

export default function FolderControl() {
  const [status, setStatus] = useState<Status | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('全部')
  const [notice, setNotice] = useState('')
  const [selectedPhoto, setSelectedPhoto] = useState<RecordItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [rescanBusy, setRescanBusy] = useState(false)
  useEffect(() => {
    if (!selectedPhoto) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedPhoto(null) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedPhoto])
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' })
        if (!response.ok) throw new Error('本地服务尚未启动：请使用“启动网页控制.cmd”')
        const next: Status = await response.json()
        if (active) { setStatus(next); setConfig(current => current ?? next.config) }
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : '无法连接本地服务') }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const control = async (route: string, body = {}) => {
    if (!status) throw new Error('服务未连接')
    const response = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lenssort-token': status.token }, body: JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? '操作失败')
    return result
  }
  const operate = async (start: boolean) => {
    if (!config || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (start) { await control('/api/config', config); await control('/api/start') }
      else await control('/api/stop')
      const next: Status = await (await fetch('/api/status')).json()
      setStatus(next)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败') }
    finally { setBusy(false) }
  }
  const changeModel = async (model: string) => {
    if (!config || busy) return
    setBusy(true); setError('')
    try {
      const next = { ...config, model, forceModel: false }
      await control('/api/config', next)
      setConfig(next)
      setNotice('模型选择已保存；下一次筛选生效。')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '模型设置保存失败') }
    finally { setBusy(false) }
  }
  const forceModel = async () => {
    if (!config || busy || config.model === 'auto' || config.model === 'off') return
    if (!config.forceModel && !window.confirm('强制使用会跳过模型资源建议，不会自动换小模型；显存不足时可能混合使用系统内存，速度变慢或运行失败。空闲内存低于3GiB仍会停止整批。确认继续？')) return
    setBusy(true); setError('')
    try {
      const next = { ...config, forceModel: !config.forceModel }
      await control('/api/config', next)
      setConfig(next)
      setNotice(next.forceModel ? '已开启强制使用；不会自动换小模型，运行失败会明确停止本批。' : '已关闭强制使用；恢复自动资源保护。')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '强制模型设置保存失败') }
    finally { setBusy(false) }
  }
  const curate = async () => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/curate')
      const sourceText = result.curation?.sources?.length ? `评分来源：${result.curation.sources.join(' + ')}。` : '审美评分器不可用，已使用技术质量回退。'
      setNotice(result.selected.length ? `已挑出 ${result.selected.length} 张（评估 ${result.considered} 张）。${sourceText}原图未改动。` : `没有生成辅助推荐。${sourceText}原图未改动。`)
      const next: Status = await (await fetch('/api/status')).json()
      setStatus(next); setFilter('辅助推荐')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '辅助推荐失败') }
    finally { setBusy(false) }
  }
  const pickFolder = async (kind: 'input' | 'output') => {
    if (!config || busy || !status || running) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/pick-folder', { kind, current: kind === 'input' ? config.input : config.output }) as { selected: string | null }
      if (result.selected) setConfig(current => current ? { ...current, [kind]: result.selected } : null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法选择文件夹') }
    finally { setBusy(false) }
  }
  const openPhoto = async (record: RecordItem) => {
    setSelectedPhoto(record); setDetailLoading(true); setError('')
    try {
      const response = await fetch('/api/photo/' + record.id, { cache: 'no-store' })
      const details: RecordItem & { error?: string } = await response.json()
      if (!response.ok) throw new Error(details.error ?? '无法读取照片详情')
      setSelectedPhoto(current => current?.id === record.id ? details : current)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法读取照片详情') }
    finally { setDetailLoading(false) }
  }
  const deleteOutput = async (record: RecordItem) => {
    if (busy || record.status !== 'done') return
    if (!window.confirm(`只删除“${record.name}”的输出副本？输入文件夹中的原图不会删除。`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await control('/api/delete-output', { id: record.id, confirm: true })
      setSelectedPhoto(null)
      setNotice(`已删除 ${record.name} 的输出副本，原图仍保留。`)
      const next: Status = await (await fetch('/api/status', { cache: 'no-store' })).json()
      setStatus(next)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '删除输出副本失败') }
    finally { setBusy(false) }
  }
  const updateCategory = async (record: RecordItem, category: string) => {
    if (busy || record.status !== 'done' || !category || category === record.category) return
    if (!window.confirm(`确认把“${record.name}”的分类改为“${category}”？只移动分类结果副本，输入文件夹中的原图不会移动或删除。`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await control('/api/update-category', { id: record.id, category, confirm: true })
      const next: Status = await (await fetch('/api/status', { cache: 'no-store' })).json()
      setStatus(next)
      setSelectedPhoto(current => current?.id === record.id ? next.records.find(item => item.id === record.id) ?? null : current)
      setNotice(`已将 ${record.name} 改到“${category}”，原图仍保留。`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '修改分类失败') }
    finally { setBusy(false) }
  }
  const rescan = async () => {
    if (busy || rescanBusy || !status) return
    setRescanBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/rescan') as { summary: { scannedFiles: number; newFiles: number; sourceMissing: number; outputMissing: number; outputDeleted: number } }
      const next: Status = await (await fetch('/api/status', { cache: 'no-store' })).json()
      setStatus(next)
      const summary = result.summary
      setNotice(`已按当前磁盘重新扫描 ${summary.scannedFiles} 张照片：新增 ${summary.newFiles} 张，源文件移除 ${summary.sourceMissing} 张，输出缺失 ${summary.outputMissing} 张，手动删除 ${summary.outputDeleted} 张。`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '重新扫描失败') }
    finally { setRescanBusy(false) }
  }
  const running = status?.phase === 'running'
  const curating = !!status?.curation && ['scoring', 'aesthetic-laion', 'aesthetic-musiq', 'ranking'].includes(status.curation.phase)
  const disabled = busy || curating || running || status?.phase === 'starting' || status?.phase === 'stopping'
  const records: (RecordItem & CurationRecord)[] = status?.records ?? []
  const progress = status?.progress
  const progressPercent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0
  const progressFile = progress?.currentFile ? progress.currentFile.split(/[\\/]/).pop() : ''
  const hasBrokenPath = [config?.input, config?.output].some(value => value?.includes('�'))
  const activityTitle = curating ? '正在生成辅助推荐' : status?.curation?.phase === 'finished' && progress?.phase === 'finished' ? '辅助推荐已完成，已停止' : status?.phase === 'starting' ? '正在启动识别组件' : status?.phase === 'stopping' ? '正在释放识别组件' : progress?.phase === 'finished' ? '本批筛选已完成，已自动停止' : progress?.phase === 'error' ? '本批处理异常，已停止' : progress?.phase === 'analyzing' ? '正在分析照片' : progress?.phase === 'waiting' ? '正在等待照片写入完成' : progress?.phase === 'scanning' ? '正在扫描照片' : running ? '正在自动筛选' : progress?.phase === 'cancelled' ? '已手动停止' : '准备就绪'
  const activityMessage = status?.phase === 'starting' ? progress?.message ?? '正在加载本地模型与识别组件…' : progress?.message ?? (running ? '把照片放入来源文件夹，系统会自动分类。' : '准备好后，点击一键筛选开始。')
  const visible = records.filter(record => filter === '全部' || (filter === '辅助推荐' ? record.curated : filter === '失败' ? record.status === 'failed' : record.category === filter))
  return <main className="folder-control">
    <header className="control-header"><div className="control-brand">L<span>LensSort AI</span></div><a href="?legacy=1">旧版实验界面</a></header>
    <section className="control-intro"><p>LOCAL PHOTO ORGANIZER</p><h1>照片放进去，剩下的交给 LensSort。</h1><span>自动分类为主，辅助推荐供参考；原图始终保留，可随时人工修正。</span></section>
    <section className="control-quick-actions" aria-label="一键操作">
      <button type="button" className="quick-action primary" disabled={busy || !status || status.phase === 'starting' || status.phase === 'stopping'} onClick={() => void operate(!running)}><strong>{busy ? '正在处理…' : running ? '停止筛选' : '一键筛选'}</strong><span>{running ? '仅处理本次照片，完成后自动停止' : '识别当前文件夹照片并归类，完成即停止'}</span></button>
      <button type="button" className="quick-action secondary" disabled={busy || !status || records.filter(record => record.status === 'done').length === 0} onClick={() => void curate()}><strong>辅助推荐</strong><span>可选：结合质量与相似照片提供参考，不代替个人审美</span></button>
      <button type="button" className="quick-action tertiary" disabled={busy || rescanBusy || !status} onClick={() => void rescan()}><strong>{rescanBusy ? '正在重新扫描…' : '刷新当前文件夹'}</strong><span>以电脑磁盘当前内容为准，清理旧状态显示</span></button>
    </section>
     <section className="control-quick-status" aria-live="polite">
       <div className="quick-status-main"><strong>{busy && !curating && status?.phase === 'stopped' && progress?.phase !== 'finished' ? '正在处理操作…' : activityTitle}</strong><span>{activityMessage}{progressFile ? ` · ${progressFile}` : ''}</span>{(curating || status?.phase === 'starting' || progress?.phase === 'scanning' || progress?.phase === 'analyzing' || progress?.phase === 'waiting') && <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}><i style={{ width: `${progress?.total ? progressPercent : 28}%` }} /></div>}{progress?.total ? <small>{progress.completed}/{progress.total} 张 · {progressPercent}%</small> : null}</div>
       <div className="quick-status-counts"><span>{records.filter(record => record.status === 'done').length} 张已分类</span><span>{records.filter(record => record.curated).length} 张已推荐</span><span>{records.filter(record => record.status === 'failed').length} 张失败</span></div>
     </section>
     <p className="vision-model-status" role="status">{status?.visionModelStatus?.message ?? '模型会在开始时检查资源；批次结束不继续筛选。'}{status?.visionModelStatus?.device ? ` · 本批最近设备：${status.visionModelStatus.device}` : ''}</p>
    <ModelSettings value={config?.model ?? 'auto'} force={Boolean(config?.forceModel)} disabled={disabled || !status} onChange={model => void changeModel(model)} onForce={() => void forceModel()} />
    <section className="folder-path-highlight" aria-label="当前文件夹设置"><div><strong>照片来源文件夹</strong><span>{config?.input ?? '连接中…'}</span></div><div><strong>分类结果文件夹</strong><span>{config?.output ?? '连接中…'}</span></div></section>
    {(hasBrokenPath || status?.configWarning) && <p className="control-warning" role="alert">{status?.configWarning ?? '检测到路径文字显示异常，请停止筛选后重新点击“选择文件夹”。选择后会按 UTF-8 正确保存中文路径。'}</p>}
    <p className="control-note">辅助推荐 · 仅供人工挑片参考，不保证选出最好看的照片；不会删除原图。</p>
    {(error || status?.error) && <p className="control-error" role="alert">{error || status?.error}</p>}
    {notice && <p className="control-notice" role="status">{notice}</p>}
    <section className="control-settings" aria-label="高级设置">
      <details>
        <summary><span className="settings-summary-title">⚙ 设置文件夹与设备</span><span>目录、设备与运行状态</span></summary>
        <div className="control-heading"><h2>自动分类</h2><span className={running ? 'control-state active' : 'control-state'} role="status">{busy ? '正在处理操作…' : running ? '正在处理本批照片' : progress?.phase === 'finished' ? '本批已完成' : '已停止'}</span></div>
        <div className="folder-setting-grid">
          <div className="folder-setting"><label>照片来源文件夹<input aria-label="照片来源文件夹" value={config?.input ?? ''} disabled={disabled} onChange={event => setConfig(current => current ? { ...current, input: event.target.value } : null)} placeholder="可输入路径，也可点击右侧选择" /></label><button type="button" className="folder-picker" disabled={disabled} onClick={() => void pickFolder('input')}>选择文件夹</button></div>
          <div className="folder-setting"><label>分类结果文件夹<input aria-label="分类结果文件夹" value={config?.output ?? ''} disabled={disabled} onChange={event => setConfig(current => current ? { ...current, output: event.target.value } : null)} placeholder="可输入路径，也可点击右侧选择" /></label><button type="button" className="folder-picker" disabled={disabled} onClick={() => void pickFolder('output')}>选择文件夹</button></div>
        </div>
        <div className="control-action-row"><label>推理设备<select aria-label="推理设备" value={config?.backend ?? 'auto'} disabled={disabled} onChange={event => setConfig(current => current ? { ...current, backend: event.target.value } : null)}>{status?.devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><button type="button" disabled={busy || !status || status.phase === 'starting' || status.phase === 'stopping'} onClick={() => void operate(!running)}>{running ? '停止本批筛选' : '开始自动分类'}</button></div>
      </details>
     <p className="control-note">实际设备：{status?.device?.name ?? '尚未启动'} · {status?.npuVerified ? `NPU 主分类内核已验证（${status.records.find(record => record.npuVerified)?.npuEvidence?.npuKernelCount ?? 0} 个融合内核）；人脸、人物、质量等辅助模块仍可能使用 CPU` : config?.backend === 'npu' ? 'NPU 在本次照片推理后验证，不会静默替换为 CPU' : config?.backend === 'auto' ? '自动选择本机可用的核显、独显或 CPU；设备不可用时会明确提示' : '所选设备失败会明确报错，不会静默替换为其他设备'}</p>
    </section>
      {status?.curation?.warnings?.length ? <details className="control-warning"><summary>精选有 {status.curation.warnings.length} 项提示（点击查看）</summary><p>{status.curation.warnings.join('；')}</p></details> : null}
    <section className="control-results"><div className="control-heading"><h2>{filter === '辅助推荐' ? '精选结果' : '处理结果'}</h2><span>{records.filter(record => record.status === 'done').length} 张已分类 · {records.filter(record => record.curated).length} 张已推荐 · {records.filter(record => record.status === 'failed').length} 张失败</span></div>
      <nav className="control-filters" aria-label="分类筛选">{categories.map(category => <button key={category} className={filter === category ? 'active' : ''} onClick={() => setFilter(category)}>{category}</button>)}</nav>
        {visible.length === 0 ? <div className="control-empty"><strong>{filter === '辅助推荐' ? '还没有辅助推荐' : running ? '等待新照片' : '准备好后，点击一键筛选'}</strong><p>{filter === '辅助推荐' ? '先完成照片筛选，再点击辅助推荐。' : '把照片复制到来源文件夹，写入完成后会自动识别；原图不会被删除或移动。'}</p></div> : <div className="control-grid">{visible.map(record => <article key={record.id} className="control-photo"><button type="button" className="control-photo-open" onClick={() => record.status === 'done' && void openPhoto(record)} aria-label={'查看照片 ' + record.name}>{record.status === 'done' ? <img src={'/api/thumbnail/' + record.id} alt={record.name} loading="lazy" /> : <span className="control-photo-failed">{record.manualAction === 'deleted-output' ? '输出副本已删除' : record.status === 'source-missing' ? '输入原图已移除' : record.status === 'output-missing' ? '分类副本已缺失' : '无法读取照片'}</span>}</button><div className="control-photo-body"><div className="control-photo-heading"><span className="control-category">{record.category ?? '失败'}</span>{record.curated && <span className="curated-badge">推荐</span>}{record.manualCategory && <span className="manual-category-badge">人工修正</span>}</div><h3>{record.name}</h3><p className="photo-explanation">{record.error ?? record.explanation ?? record.reason ?? '已完成分析，可打开详情查看依据。'}</p>{record.visionExplanation?.generated && <p className="photo-vision-note">AI复核：{record.visionCategoryApplied ? `已采用“${record.category}”` : '仅作参考，未覆盖技术模型结果'}</p>}<div className="photo-card-footer"><small className="photo-quality-primary">{record.qualityScore !== undefined ? `质量 ${record.qualityScore}/100` : '质量待评'}</small>{record.device?.name && <small className="photo-device-secondary">{record.device.name}</small>}{record.status === 'done' && <button type="button" className="photo-detail-link" onClick={() => void openPhoto(record)}>查看详情</button>}</div></div></article>)}</div>}
    </section>
      {selectedPhoto && <div className="photo-modal-backdrop" onClick={() => setSelectedPhoto(null)}><section className="photo-modal" role="dialog" aria-modal="true" aria-label={'照片详情 ' + selectedPhoto.name} onClick={event => event.stopPropagation()}><button type="button" className="photo-modal-close" autoFocus onClick={() => setSelectedPhoto(null)}>关闭 ×</button><div className="photo-modal-image">{selectedPhoto.status === 'done' ? <img src={selectedPhoto.imageUrl ?? '/api/photo-image/' + selectedPhoto.id} alt={selectedPhoto.name} /> : <p>{selectedPhoto.error ?? '这张照片暂时无法预览'}</p>}</div><div className="photo-modal-info"><div className="photo-modal-kicker">LensSort 分析说明</div><div className="control-photo-heading"><span className="control-category">{selectedPhoto.category ?? '未分类'}</span>{selectedPhoto.manualCategory && <span className="manual-category-badge">人工修正</span>}</div><h2>{selectedPhoto.name}</h2>{detailLoading && <p role="status">正在读取详情…</p>}<p className="photo-modal-explanation">{selectedPhoto.explanation ?? selectedPhoto.reason ?? selectedPhoto.error ?? '暂时没有可展示的分析说明。'}</p><CurationResults record={selectedPhoto} /><div className="photo-detail-summary"><span>场景：{selectedPhoto.sceneLabel ?? '综合判断'}</span><span>人脸线索：{selectedPhoto.faceCount ?? 0}</span><span>质量：{selectedPhoto.qualityScore !== undefined ? selectedPhoto.qualityScore + '/100' : '暂无'}</span></div><details className="photo-technical"><summary>查看技术依据</summary><dl><dt>清晰度 / 曝光</dt><dd>{selectedPhoto.clarityScore ?? '暂无'} / {selectedPhoto.exposureStatus ?? '暂无'}</dd><dt>推理设备 / 耗时</dt><dd>{selectedPhoto.device?.name ?? '暂无'} / {selectedPhoto.durationMs ?? '暂无'} ms</dd><dt>模型状态</dt><dd>{selectedPhoto.npuVerified ? `NPU 已验证 · ${selectedPhoto.npuEvidence?.npuKernelCount ?? 0} 个融合内核 · ${selectedPhoto.npuEvidence?.npuKernelMs ?? 0} ms` : '本地推理已完成'}</dd></dl></details><div className="photo-modal-actions"><label className="category-editor">修改分类<select aria-label="修改照片分类" value={selectedPhoto.category ?? ''} disabled={busy || selectedPhoto.status !== 'done'} onChange={event => void updateCategory(selectedPhoto, event.target.value)}><option value="" disabled>选择新分类</option>{categories.filter(category => !['全部', '辅助推荐', '失败'].includes(category)).map(category => <option key={category} value={category}>{category}</option>)}</select></label><p className="control-note">确认后只移动分类结果副本，输入文件夹中的原图不会移动或删除。</p><button type="button" className="danger-action" onClick={() => void deleteOutput(selectedPhoto)} disabled={busy || selectedPhoto.status !== 'done'}>删除输出副本</button><p className="control-note">只删除分类结果副本，输入文件夹中的原图不会删除。</p></div></div></section></div>}
      <footer>照片只在本机处理 · 自动复制，不删除原图 · 本批完成自动停止</footer>
  </main>
}
