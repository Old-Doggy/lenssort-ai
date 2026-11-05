import { useEffect, useRef, useState } from 'react'
import './FolderControl.css'
import ModelSettings from './ModelSettings'
import CurationResults, { type CurationRecord } from './CurationResults'

type Config = { input: string; output: string; backend: string; model: string; forceModel?: boolean }
type VisionExplanation = { summary?: string; explanation?: string; subjects?: string[]; scene?: string; compositionComment?: string; qualityComment?: string; recommendation?: string; confidence?: number | null; categoryCandidate?: string | null; categoryApplied?: boolean; categoryDecision?: string; triggerReason?: string; cautions?: string[]; model?: string | null; generated?: boolean; error?: string; mediaType?: string; subjectFocus?: string; realPersonPresent?: boolean; personCount?: number; primaryPersonCount?: number; landscapePresent?: boolean; statuePresent?: boolean; animalPresent?: boolean; plantPresent?: boolean; bodyPartOnly?: boolean; subjectSharpness?: string; reviewCalls?: number }
type RecordItem = { id: string; name: string; status: string; favorite?: boolean; favoriteAt?: string | null; manualAction?: string | null; manualCategory?: string | null; manualCategoryAt?: string | null; category?: string; sceneLabel?: string | null; reason?: string; explanation?: string | null; qualityScore?: number; qualityReasons?: string[]; clarityScore?: number; exposureStatus?: string; faceCount?: number; curated?: boolean; error?: string; durationMs?: number; device?: { name: string }; npuVerified?: boolean; npuEvidence?: { npuKernelCount?: number | null; npuKernelMs?: number | null; profileScope?: string | null; cpuKernelCount?: number | null; cpuKernelMs?: number | null; mixedCpuAuxiliary?: boolean } | null; imageUrl?: string; visionTriggered?: boolean; visionTriggerReason?: string; visionCategoryApplied?: boolean; visionExplanation?: VisionExplanation | null; visionModelStatus?: { status?: string; model?: string | null; message?: string; device?: string | null } | null }
type Progress = { phase: string; completed: number; total: number; pending: number; currentFile?: string | null; message: string }
type CurationStatus = { phase: string; sources: string[]; warnings: string[]; considered: number; selected: number }
type Status = { token: string; config: Config; configWarning?: string | null; phase: string; error?: string; device?: { id?: string; name: string; provider?: string }; devices: Array<{ id: string; name: string }>; records: RecordItem[]; npuVerified: boolean; progress: Progress; curation?: CurationStatus; visionModelStatus?: { status: string; model?: string; message?: string; device?: string | null } | null }
const categories = ['全部', '收藏', '辅助推荐', '单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认', '失败']

export default function FolderControl() {
  const [status, setStatus] = useState<Status | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('全部')
  const [notice, setNotice] = useState('')
  const [selectedPhoto, setSelectedPhoto] = useState<RecordItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [imageLoadError, setImageLoadError] = useState(false)
  const [imageRetryKey, setImageRetryKey] = useState(0)
  const [rescanBusy, setRescanBusy] = useState(false)
  const [displayLimit, setDisplayLimit] = useState(60)
  const statusRequestRef = useRef(0)
  const statusAbortRef = useRef<AbortController | null>(null)
  const detailRequestRef = useRef(0)
  const selectedPhotoRef = useRef<RecordItem | null>(null)
  const photoOpenerRef = useRef<HTMLElement | null>(null)
  const selectedPhotoId = selectedPhoto?.id
  useEffect(() => {
    if (!selectedPhotoId) return
    const modal = document.querySelector<HTMLElement>('.photo-modal')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    modal?.querySelector<HTMLElement>('.photo-modal-close')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSelectedPhoto(null); return }
      if (event.key !== 'Tab' || !modal) return
      const controls = [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary, a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) return
      if (!modal.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (photoOpenerRef.current?.isConnected) photoOpenerRef.current.focus({ preventScroll: true })
    }
  }, [selectedPhotoId])
  useEffect(() => { selectedPhotoRef.current = selectedPhoto }, [selectedPhoto])
  const refreshStatus = async () => {
    const requestId = statusRequestRef.current + 1
    statusRequestRef.current = requestId
    statusAbortRef.current?.abort()
    const controller = new AbortController()
    statusAbortRef.current = controller
    try {
      const response = await fetch('/api/status', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('本地服务尚未启动：请使用“启动网页控制.cmd”')
      const next: Status = await response.json()
      if (requestId !== statusRequestRef.current) return null
      if (selectedPhotoRef.current && !next.records.some(record => record.id === selectedPhotoRef.current?.id)) {
        selectedPhotoRef.current = null
        setSelectedPhoto(null)
        setNotice('当前照片已不在磁盘记录中，页面已按最新文件夹状态更新')
      }
      setStatus(next)
      setConfig(current => current ?? next.config)
      setError('')
      return next
    } catch (caught) {
      if (controller.signal.aborted || requestId !== statusRequestRef.current) return null
      setError(caught instanceof Error ? caught.message : '无法连接本地服务')
      return null
    }
  }
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = async () => {
      if (!active) return
      const next = await refreshStatus()
      if (!active) return
      const phase = next?.phase
      const progressPhase = next?.progress?.phase
      const curationPhase = next?.curation?.phase
      const activeTask = phase === 'starting' || phase === 'running' || phase === 'stopping' || ['scanning', 'analyzing', 'waiting', 'scoring', 'aesthetic-laion', 'aesthetic-musiq', 'ranking'].includes(progressPhase ?? '') || ['scoring', 'aesthetic-laion', 'aesthetic-musiq', 'ranking'].includes(curationPhase ?? '')
      const interval = activeTask ? (phase === 'starting' || phase === 'stopping' ? 500 : 1000) : 5000
      timer = setTimeout(() => void refresh(), interval)
    }
    void refresh()
    return () => { active = false; if (timer) clearTimeout(timer); statusAbortRef.current?.abort() }
  }, [])
  const control = async (route: string, body = {}) => {
    if (!status) throw new Error('服务未连接')
    const response = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lenssort-token': status.token }, body: JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? '操作失败')
    return result
  }
  const operate = async (start: boolean) => {
    if (!config || busy || curating) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (start) { await control('/api/config', config); await control('/api/start') }
      else await control('/api/stop')
      await refreshStatus()
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
      setNotice('模型选择已保存 · 下一次筛选生效')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '模型设置保存失败') }
    finally { setBusy(false) }
  }
  const forceModel = async () => {
    if (!config || busy || config.model === 'auto' || config.model === 'off') return
    if (!config.forceModel && !window.confirm('强制使用会跳过模型资源建议，不会自动换小模型；显存不足时可能混合使用系统内存，速度变慢或运行失败 · 空闲内存低于3GiB仍会停止整批 · 确认继续？')) return
    setBusy(true); setError('')
    try {
      const next = { ...config, forceModel: !config.forceModel }
      await control('/api/config', next)
      setConfig(next)
      setNotice(next.forceModel ? '已开启强制使用 · 不会自动换小模型 · 运行失败会明确停止本批' : '已关闭强制使用 · 恢复自动资源保护')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '强制模型设置保存失败') }
    finally { setBusy(false) }
  }
  const curate = async () => {
    if (busy || disabled) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/curate')
      const sourceText = result.curation?.sources?.length ? `评分来源：${result.curation.sources.join(' + ')}` : '审美评分器不可用，已使用技术质量回退'
      setNotice(result.selected.length ? `已生成辅助推荐 ${result.selected.length} 张（评估 ${result.considered} 张）· ${sourceText} · 原图未改动` : `没有生成辅助推荐 · ${sourceText} · 原图未改动`)
      await refreshStatus(); setFilter('辅助推荐')
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
    if (selectedPhotoRef.current?.id !== record.id) photoOpenerRef.current = document.activeElement as HTMLElement | null
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    selectedPhotoRef.current = record
    setSelectedPhoto(record); setDetailLoading(true); setDetailError(''); setImageLoadError(false); setImageRetryKey(0); setError('')
    try {
      const response = await fetch('/api/photo/' + record.id, { cache: 'no-store' })
      const details: RecordItem & { error?: string } = await response.json()
      if (!response.ok) throw new Error(details.error ?? '无法读取照片详情')
      if (requestId === detailRequestRef.current) setSelectedPhoto(current => current?.id === record.id ? details : current)
    } catch (caught) {
      if (requestId === detailRequestRef.current) setDetailError(caught instanceof Error ? caught.message : '无法读取照片详情')
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false)
    }
  }
  const retryPhotoDetail = () => { if (selectedPhoto) void openPhoto(selectedPhoto) }
  const deleteOutput = async (record: RecordItem) => {
    if (busy || record.status !== 'done') return
    if (!window.confirm(`只删除“${record.name}”的分类副本？输入文件夹中的原图不会删除`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await control('/api/delete-output', { id: record.id, confirm: true })
      setSelectedPhoto(null)
      setNotice(`已删除 ${record.name} 的分类副本 · 原图仍保留`)
      await refreshStatus()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '删除分类副本失败') }
    finally { setBusy(false) }
  }
  const updateCategory = async (record: RecordItem, category: string) => {
    if (busy || record.status !== 'done' || !category || category === record.category) return
    if (!window.confirm(`确认把“${record.name}”的分类改为“${category}”？只移动分类结果副本，输入文件夹中的原图不会移动或删除`)) return
    detailRequestRef.current += 1
    const previousCategory = record.category
    selectedPhotoRef.current = { ...record, category, manualCategory: category, manualAction: 'category-corrected' }
    setSelectedPhoto(current => current?.id === record.id ? { ...current, category, manualCategory: category, manualAction: 'category-corrected' } : current)
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/update-category', { id: record.id, category, confirm: true }) as { category?: string }
      const appliedCategory = result.category ?? category
      setSelectedPhoto(current => current?.id === record.id ? { ...current, category: appliedCategory, manualCategory: appliedCategory, manualAction: 'category-corrected' } : current)
      const next = await refreshStatus()
      const updated = next?.records.find(item => item.id === record.id)
      if (updated) { selectedPhotoRef.current = updated; setSelectedPhoto(updated) }
      setNotice(`已将 ${record.name} 改到“${appliedCategory}” · 原图仍保留`)
    } catch (caught) {
      selectedPhotoRef.current = { ...record, category: previousCategory }
      setSelectedPhoto(current => current?.id === record.id ? { ...current, category: previousCategory, manualCategory: record.manualCategory, manualAction: record.manualAction } : current)
      setError(caught instanceof Error ? caught.message : '修改分类失败')
    }
    finally { setBusy(false) }
  }
  const rescan = async () => {
    if (busy || rescanBusy || !status) return
    setRescanBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/rescan') as { summary: { scannedFiles: number; newFiles: number; sourceMissing: number; outputMissing: number; outputDeleted: number } }
      await refreshStatus()
      const summary = result.summary
      setNotice(`已按当前磁盘重新扫描 ${summary.scannedFiles} 张照片：新增 ${summary.newFiles} 张 · 源文件移除 ${summary.sourceMissing} 张 · 输出缺失 ${summary.outputMissing} 张 · 手动删除 ${summary.outputDeleted} 张`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '重新扫描失败') }
    finally { setRescanBusy(false) }
  }
  const toggleFavorite = async (record: RecordItem) => {
    if (busy || record.status !== 'done' || !status) return
    setBusy(true); setError(''); setNotice('')
    try {
      const nextFavorite = !record.favorite
      await control('/api/toggle-favorite', { id: record.id, favorite: nextFavorite })
      const next = await refreshStatus()
      const updated = next?.records.find(item => item.id === record.id)
      if (updated && selectedPhotoRef.current?.id === record.id) { selectedPhotoRef.current = updated; setSelectedPhoto(updated) }
      setNotice(nextFavorite ? `已收藏 ${record.name} · 可在“收藏”中集中查看` : `已取消收藏 ${record.name}`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '收藏状态更新失败') }
    finally { setBusy(false) }
  }
  const running = status?.phase === 'running'
  const curating = !!status?.curation && ['scoring', 'aesthetic-laion', 'aesthetic-musiq', 'ranking'].includes(status.curation.phase)
  const disabled = busy || curating || running || status?.phase === 'starting' || status?.phase === 'stopping'
  const records: (RecordItem & CurationRecord)[] = status?.records ?? []
  const verifiedNpuRecord = records.find(record => record.npuVerified === true && record.npuEvidence)
  const npuEvidence = verifiedNpuRecord?.npuEvidence
  const npuStatusText = status?.npuVerified && npuEvidence
    ? `NPU 主分类内核已验证 · ${npuEvidence.npuKernelCount ?? 0} 个融合内核 · ${npuEvidence.npuKernelMs ?? 0} ms`
    : config?.backend === 'npu'
      ? '本批选择了 NPU，照片推理后才会显示验证结果；未验证前不代表已使用 NPU'
      : '当前没有 NPU 验证证据；设备选择不等于实际推理已使用该设备'
  const visionDeviceText = status?.visionModelStatus?.device
    ? `视觉模型最近设备：${status.visionModelStatus.device}`
    : status?.visionModelStatus?.status === 'unavailable'
      ? '视觉模型服务不可用，当前只使用基础分析'
      : '视觉模型设备由本地服务报告，基础分类设备不会代表视觉模型设备'
  const progress = status?.progress
  const progressPercent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0
  const progressFile = progress?.currentFile ? progress.currentFile.split(/[\\/]/).pop() : ''
  const hasBrokenPath = [config?.input, config?.output].some(value => value?.includes('�'))
  const activityTitle = curating ? '正在生成辅助推荐' : status?.curation?.phase === 'finished' && progress?.phase === 'finished' ? '辅助推荐已完成，已停止' : status?.phase === 'starting' ? '正在启动识别组件' : status?.phase === 'stopping' ? '正在释放识别组件' : progress?.phase === 'finished' ? '分类完成，已自动停止' : progress?.phase === 'error' ? '本批处理异常，已停止' : progress?.phase === 'analyzing' ? '正在分析照片' : progress?.phase === 'waiting' ? '正在等待照片写入完成' : progress?.phase === 'scanning' ? '正在扫描照片' : running ? '正在自动筛选' : progress?.phase === 'cancelled' ? '已手动停止' : '准备就绪'
  const activityMessage = status?.phase === 'starting' ? progress?.message ?? '正在加载本地模型与识别组件…' : progress?.message ?? (running ? '把照片放入来源文件夹，系统会自动分类' : '准备好后，点击一键筛选开始')
  const visible = records.filter(record => filter === '全部' || (filter === '收藏' ? record.favorite === true : filter === '辅助推荐' ? record.curated : filter === '失败' ? record.status === 'failed' : record.category === filter)).sort((left, right) => Number(right.favorite === true) - Number(left.favorite === true))
  const displayed = visible.slice(0, displayLimit)
  const categoryCounts = records.reduce<Record<string, number>>((counts, record) => {
    if (record.status === 'failed') counts['失败'] = (counts['失败'] ?? 0) + 1
    if (record.category) counts[record.category] = (counts[record.category] ?? 0) + 1
    return counts
  }, {})
  categoryCounts['全部'] = records.length
  const doneCount = records.filter(record => record.status === 'done').length
  const curatedCount = records.filter(record => record.curated).length
  categoryCounts['辅助推荐'] = curatedCount
  categoryCounts['收藏'] = records.filter(record => record.favorite === true).length
  const failedCount = categoryCounts['失败'] ?? 0
  const emptyState = filter === '收藏'
    ? { title: '还没有收藏照片', lines: ['在照片卡片或详情页点击收藏', '收藏照片会集中出现在这里'] }
    : filter === '辅助推荐'
    ? { title: '还没有辅助推荐', lines: doneCount > 0 ? ['点击上方“辅助推荐”生成参考结果', '它不会移动或删除原图'] : ['先完成照片分类，再生成辅助推荐', '辅助推荐只供人工挑片参考'] }
    : filter === '失败'
      ? { title: failedCount > 0 ? '暂时没有可显示的失败项' : '当前没有读取失败的照片', lines: ['刷新当前文件夹可以重新核对磁盘内容', '原图不会被删除或移动'] }
      : filter === '全部'
        ? { title: status ? '来源文件夹还没有照片' : '等待本地服务连接', lines: status ? ['把照片放入来源文件夹后点击一键筛选', '原图不会被删除或移动'] : ['请先打开本地服务，再刷新此页面', '连接后会读取当前文件夹内容'] }
        : { title: `“${filter}”暂时没有照片`, lines: ['可以切换其他分类查看', '分类结果始终以当前磁盘扫描为准'] }
  const selectedVision = selectedPhoto?.visionExplanation
  const selectedImageSource = selectedPhoto ? selectedPhoto.imageUrl ?? '/api/photo-image/' + selectedPhoto.id : ''
  const selectedNaturalExplanation = (selectedVision?.generated
    ? selectedVision.explanation ?? [selectedVision.summary, selectedVision.compositionComment, selectedVision.qualityComment].filter(Boolean).join(' ')
    : selectedPhoto?.explanation ?? selectedPhoto?.reason ?? selectedPhoto?.error) || '暂时没有足够依据生成普通语言说明，建议打开原图人工确认'
  const selectedPersonNote = selectedVision?.generated
    ? selectedVision.realPersonPresent && (selectedVision.personCount ?? 0) > 0
      ? `视觉模型估计画面中约有 ${selectedVision.personCount} 位真人，建议结合原图确认`
      : '视觉模型当前未确认真人；这不等于绝对无人，遮挡、角度和画面大小都可能影响判断'
    : (selectedPhoto?.faceCount ?? 0) > 0
      ? `基础检测发现 ${selectedPhoto?.faceCount} 个脸部候选区域；候选区域不等于已确认真人`
      : '当前没有检测到脸部候选区域；这不能单独证明画面没有人'
  const selectedVisionStatus = selectedVision?.generated ? `视觉模型说明${selectedVision.model ? ` · ${selectedVision.model}` : ''}` : '基础分析说明'
  return <main className="folder-control">
    <header className="control-header"><div className="control-brand"><span className="control-brand-mark">L</span><span>LensSort AI</span></div><a href="?legacy=1">实验入口</a></header>
    <section className="control-intro"><p>LOCAL PHOTO ORGANIZER</p><h1>照片放进去，剩下的交给 LensSort</h1><span className="two-line-copy intro-copy"><span>自动分类为主，辅助推荐供参考</span><span>原图始终保留，可随时人工修正</span></span></section>
    <section className="workspace-settings-card" aria-label="设置文件夹与设备">
      <div className="workspace-settings-heading"><div className="source-folder-icon" aria-hidden="true">⚙</div><div><p className="source-folder-kicker">当前工作目录与设备</p><h2 id="source-folder-title">设置文件夹与设备</h2><span>目录、设备与运行状态</span></div><span className={status ? 'source-folder-connection connected' : 'source-folder-connection'}>{status ? '本地服务已连接' : '等待连接'}</span></div>
      <div className="folder-setting-grid">
        <div className="folder-setting"><label>照片来源文件夹<input aria-label="照片来源文件夹" value={config?.input ?? ''} disabled={disabled} onChange={event => setConfig(current => current ? { ...current, input: event.target.value } : null)} placeholder="可输入路径，也可点击右侧选择" /></label><button type="button" className="folder-picker" disabled={disabled} onClick={() => void pickFolder('input')}>选择文件夹</button></div>
        <div className="folder-setting"><label>分类结果文件夹<input aria-label="分类结果文件夹" value={config?.output ?? ''} disabled={disabled} onChange={event => setConfig(current => current ? { ...current, output: event.target.value } : null)} placeholder="可输入路径，也可点击右侧选择" /></label><button type="button" className="folder-picker" disabled={disabled} onClick={() => void pickFolder('output')}>选择文件夹</button></div>
      </div>
      <div className="workspace-settings-actions"><label>推理设备<select aria-label="推理设备" value={config?.backend ?? 'auto'} disabled={disabled} onChange={event => setConfig(current => current ? { ...current, backend: event.target.value } : null)}>{status?.devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><button type="button" className="source-folder-secondary" disabled={busy || rescanBusy || !status} onClick={() => void rescan()}>{rescanBusy ? '正在刷新…' : '刷新当前文件夹'}</button></div>
      <div className="device-status-summary" aria-label="加速与视觉模型状态"><div className="device-status-item"><span className="device-status-label">基础分类设备</span><strong>{status?.device?.name ?? '尚未启动'}</strong><span>{status?.device ? '本批实际报告设备' : `当前选择：${status?.config.backend ?? config?.backend ?? '自动选择'}`}</span></div><div className="device-status-item"><span className="device-status-label">NPU 证据</span><strong className={status?.npuVerified && npuEvidence ? 'verified' : 'pending'}>{status?.npuVerified && npuEvidence ? '已验证' : '尚未验证'}</strong><span>{npuStatusText}</span></div><div className="device-status-item"><span className="device-status-label">视觉模型服务</span><strong>{status?.visionModelStatus?.model ?? '未加载'}</strong><span>{status?.visionModelStatus?.message ?? visionDeviceText}</span></div></div>
      <div className="source-folder-meta"><span>{status ? `${records.length} 张已载入` : '连接后读取照片数量'}</span><span>{running ? '正在读取或分类' : rescanBusy ? '正在刷新文件夹' : '以当前磁盘内容为准'}</span></div>
    </section>
    <section className="control-quick-actions" aria-label="一键操作">
      <button type="button" className="quick-action primary" disabled={busy || curating || !status || status.phase === 'starting' || status.phase === 'stopping'} onClick={() => void operate(!running)}><strong>{busy ? '正在处理…' : running ? '停止筛选' : '一键筛选'}</strong><span className="two-line-copy"><span>{running ? '仅处理本次照片，完成后自动停止' : '识别当前文件夹照片并归类'}</span><span>{running ? '任务结束后不会继续监控' : '处理完成后自动停止'}</span></span></button>
      <button type="button" className="quick-action secondary" disabled={disabled || !status || records.filter(record => record.status === 'done').length === 0} onClick={() => void curate()}><strong>辅助推荐</strong><span className="two-line-copy"><span>结合质量与相似照片提供参考</span><span>不代替个人审美</span></span></button>
    </section>
     <section className="control-quick-status" data-phase={rescanBusy ? 'rescan' : curating ? 'curating' : status?.phase ?? 'offline'} aria-live="polite">
       <div className="quick-status-main"><div className="quick-status-title"><span className="quick-status-dot" aria-hidden="true" /><strong>{rescanBusy ? '正在刷新当前文件夹' : busy && !curating && status?.phase === 'stopped' && progress?.phase !== 'finished' ? '正在处理操作…' : activityTitle}</strong></div><span>{rescanBusy ? '重新读取电脑磁盘内容，旧状态会按实际文件更新' : activityMessage}{progressFile ? ` · ${progressFile}` : ''}</span>{(curating || status?.phase === 'starting' || progress?.phase === 'scanning' || progress?.phase === 'analyzing' || progress?.phase === 'waiting') && <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label="照片处理进度"><i style={{ width: `${progress?.total ? progressPercent : 28}%` }} /></div>}{progress?.total ? <small>{progress.completed}/{progress.total} 张 · {progressPercent}%</small> : null}</div>
       <div className="quick-status-counts"><span>{records.filter(record => record.status === 'done').length} 张已分类</span><span>{records.filter(record => record.curated).length} 张已推荐</span><span>{records.filter(record => record.status === 'failed').length} 张失败</span></div>
     </section>
    <ModelSettings value={config?.model ?? 'auto'} force={Boolean(config?.forceModel)} disabled={disabled || !status} onChange={model => void changeModel(model)} onForce={() => void forceModel()} />
    {(hasBrokenPath || status?.configWarning) && <p className="control-warning two-line-copy" role="alert"><span>{status?.configWarning ?? '检测到路径文字显示异常，请停止筛选后重新点击“选择文件夹”'}</span><span>选择后会按 UTF-8 正确保存中文路径</span></p>}
    <p className="control-note two-line-copy"><span>辅助推荐 · 仅供人工挑片参考</span><span>推荐结果可自行取舍 · 原图始终保留</span></p>
    {(error || status?.error) && <p className="control-error" role="alert">{error || status?.error}</p>}
    {notice && <p className="control-notice" role="status">{notice}</p>}
      {status?.curation?.warnings?.length ? <details className="control-warning"><summary>辅助推荐有 {status.curation.warnings.length} 项提示（点击查看）</summary><p>{status.curation.warnings.join('；')}</p></details> : null}
    <section className="control-results"><div className="control-heading"><div><h2>{filter === '辅助推荐' ? '辅助推荐' : '分类结果'}</h2><p className="control-results-subtitle">{filter === '辅助推荐' ? '只展示系统认为值得优先查看的照片' : '按照片类别查看自动分类结果'}</p></div><span className="control-results-count">当前显示 {visible.length} 张 · 已分类 {doneCount} 张 · 推荐 {curatedCount} 张 · 失败 {failedCount} 张</span></div>
      <nav className="control-filters" aria-label="分类筛选">{categories.map(category => <button type="button" key={category} className={filter === category ? 'active' : ''} aria-current={filter === category ? 'page' : undefined} onClick={() => { setFilter(category); setDisplayLimit(60) }}><span>{category}</span><b>{categoryCounts[category] ?? 0}</b></button>)}</nav>
        {visible.length === 0 && <div className="control-empty"><span className="control-empty-icon" aria-hidden="true">○</span><strong>{running ? '正在读取本批照片' : emptyState.title}</strong><p className="two-line-copy"><span>{emptyState.lines[0]}</span><span>{emptyState.lines[1]}</span></p>{filter === '失败' && <button type="button" className="control-empty-action" disabled={busy || rescanBusy || !status} onClick={() => void rescan()}>{rescanBusy ? '正在刷新…' : '刷新当前文件夹'}</button>}</div>}<div className="control-grid" hidden={visible.length === 0}>{displayed.map(record => <article key={record.id} className={`control-photo${record.category === '待确认' ? ' needs-review' : ''}${record.status !== 'done' ? ' is-unavailable' : ''}`}><button type="button" className="control-photo-open" onClick={() => record.status === 'done' && void openPhoto(record)} aria-label={'查看照片 ' + record.name}>{record.status === 'done' ? <img src={'/api/thumbnail/' + record.id} alt={record.name} loading="lazy" /> : <span className="control-photo-failed">{record.manualAction === 'deleted-output' ? '分类副本已删除' : record.status === 'source-missing' ? '输入原图已移除' : record.status === 'output-missing' ? '分类副本已缺失' : '无法读取照片'}</span>}</button><div className="control-photo-body"><div className="control-photo-heading">{record.favorite && <span className="favorite-badge">收藏</span>}<span className="control-category">{record.category ?? '失败'}</span>{record.curated && <span className="curated-badge">推荐</span>}{record.manualCategory && <span className="manual-category-badge">人工修正</span>}</div><h3>{record.name}</h3><p className="photo-explanation">{record.status !== 'done' ? (record.manualAction === 'deleted-output' ? '分类副本已删除，可刷新当前文件夹' : record.status === 'source-missing' ? '输入原图已从来源文件夹移除' : record.status === 'output-missing' ? '分类副本已缺失，可重新扫描核对' : record.error ?? '这张照片暂时无法读取') : record.manualCategory ? `已人工调整为“${record.category}”` : record.curated ? '已加入辅助推荐，可打开详情查看依据' : '已完成分类，可打开详情查看说明'}</p><div className="photo-card-footer">{record.status !== 'done' ? <small className="photo-status-secondary">需要处理</small> : <small className="photo-status-secondary">{record.category === '待确认' ? '建议人工查看' : '已完成'}</small>}{record.status === 'done' && <><button type="button" className={`favorite-card-action${record.favorite ? ' active' : ''}`} aria-label={record.favorite ? '取消收藏' : '收藏照片'} aria-pressed={record.favorite === true} onClick={() => void toggleFavorite(record)}>{record.favorite ? '★' : '☆'}</button><button type="button" className="photo-detail-link" onClick={() => void openPhoto(record)}>查看详情</button></>}</div></div></article>)}</div>{visible.length > displayed.length && <div className="control-load-more"><span>已显示 {displayed.length} / {visible.length} 张</span><button type="button" onClick={() => setDisplayLimit(current => current + 60)}>加载更多</button></div>}
    </section>
      {selectedPhoto && <div className="photo-modal-backdrop" onClick={() => setSelectedPhoto(null)}><section className="photo-modal" role="dialog" aria-modal="true" aria-label={'照片详情 ' + selectedPhoto.name} onClick={event => event.stopPropagation()}><button type="button" className="photo-modal-close" autoFocus onClick={() => setSelectedPhoto(null)}>关闭 ×</button><div className="photo-modal-image">{selectedPhoto.status === 'done' && !imageLoadError ? <img key={`${selectedPhoto.id}-${imageRetryKey}`} src={selectedImageSource} alt={selectedPhoto.name} onError={() => setImageLoadError(true)} /> : <div className="photo-modal-image-state" role="status"><strong>{imageLoadError ? '大图暂时无法读取' : '这张照片暂时无法预览'}</strong><span>{imageLoadError ? '可以重试读取，或关闭详情后刷新当前文件夹' : selectedPhoto.error ?? '当前记录没有可用的输出副本'}</span>{imageLoadError && <button type="button" onClick={() => { setImageLoadError(false); setImageRetryKey(value => value + 1) }}>重试读取大图</button>}</div>}</div><div className="photo-modal-info"><div className="photo-modal-kicker">照片分析说明</div><div className="photo-modal-heading"><div className="control-photo-heading"><span className="control-category">{selectedPhoto.category ?? '未分类'}</span>{selectedPhoto.favorite && <span className="favorite-badge">收藏</span>}{selectedPhoto.manualCategory && <span className="manual-category-badge">人工修正</span>}{selectedPhoto.curated && <span className="curated-badge">辅助推荐</span>}</div><span className="photo-explanation-source">{selectedVisionStatus}</span></div><h2>{selectedPhoto.name}</h2><button type="button" className={`favorite-action${selectedPhoto.favorite ? ' active' : ''}`} disabled={busy || selectedPhoto.status !== 'done'} onClick={() => void toggleFavorite(selectedPhoto)}>{selectedPhoto.favorite ? '★ 已收藏' : '☆ 收藏照片'}</button>{detailLoading && <p className="photo-detail-loading" role="status">正在读取最新照片说明…</p>}{detailError && <div className="photo-detail-error" role="alert"><strong>照片说明读取失败</strong><span>{detailError}</span><button type="button" onClick={retryPhotoDetail}>重试读取说明</button></div>}<section className="photo-natural-explanation" aria-label="普通语言说明"><strong>画面解读</strong><p>{selectedNaturalExplanation}</p><p className="photo-person-note">{selectedPersonNote}</p>{selectedVision?.generated && (selectedVision.compositionComment || selectedVision.qualityComment) && <div className="photo-vision-observations"><span>{selectedVision.compositionComment ?? '暂时没有构图说明'}</span><span>{selectedVision.qualityComment ?? '暂时没有质量说明'}</span></div>}</section><CurationResults record={selectedPhoto} /><div className="photo-detail-summary"><span>场景：{selectedPhoto.sceneLabel ?? selectedVision?.scene ?? '综合判断'}</span><span>{selectedVision?.generated ? `视觉模型人数：${selectedVision.personCount ?? '未确定'}` : `脸部候选：${selectedPhoto.faceCount ?? 0}`}</span><span>质量：{selectedPhoto.qualityScore !== undefined ? selectedPhoto.qualityScore + '/100' : '暂无'}</span></div><details className="photo-technical"><summary>查看技术依据</summary><dl><dt>分类依据</dt><dd>{selectedPhoto.reason ?? '暂无文字依据'}{selectedPhoto.visionCategoryApplied ? ' · 已采用视觉模型类别' : ''}</dd><dt>清晰度 / 曝光</dt><dd>{selectedPhoto.clarityScore ?? '暂无'} / {selectedPhoto.exposureStatus ?? '暂无'}</dd><dt>推理设备 / 耗时</dt><dd>{selectedPhoto.device?.name ?? '暂无'} / {selectedPhoto.durationMs ?? '暂无'} ms</dd><dt>视觉模型</dt><dd>{selectedVision?.generated ? `${selectedVision.model ?? '本地视觉模型'} · ${selectedVision.reviewCalls ? `复核 ${selectedVision.reviewCalls} 次` : '单次观察'}` : selectedPhoto.visionModelStatus?.message ?? '本批未启用视觉模型'}</dd><dt>加速验证</dt><dd>{selectedPhoto.npuVerified ? `NPU 已验证 · ${selectedPhoto.npuEvidence?.npuKernelCount ?? 0} 个融合内核 · ${selectedPhoto.npuEvidence?.npuKernelMs ?? 0} ms` : '本地基础推理已完成，未提供 NPU 验证证据'}</dd></dl></details><div className="photo-modal-actions"><div className="photo-action-heading"><strong>人工修正</strong><span>只移动分类结果副本，输入文件夹中的原图始终保留</span></div><label className="category-editor">将照片移到<select aria-label="修改照片分类" value={selectedPhoto.category ?? ''} disabled={busy || selectedPhoto.status !== 'done'} onChange={event => void updateCategory(selectedPhoto, event.target.value)}><option value="" disabled>选择新分类</option>{categories.filter(category => !['全部', '收藏', '辅助推荐', '失败'].includes(category)).map(category => <option key={category} value={category}>{category}</option>)}</select></label><button type="button" className="danger-action" onClick={() => void deleteOutput(selectedPhoto)} disabled={busy || selectedPhoto.status !== 'done'}>删除分类副本</button><p className="control-note two-line-copy"><span>只删除分类副本，来源文件夹中的原图始终保留</span><span>刷新当前文件夹可核对最新磁盘内容</span></p></div></div></section></div>}
      <footer>照片只在本机处理 · 自动复制，不删除原图 · 本批完成自动停止</footer>
  </main>
}
