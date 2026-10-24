import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, stat, lstat, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { analyzePhotoQuality, createPhotoAnalyzer } from './local-photo-analyzer.js'
import { createFolderSorter, deleteFolderOutput, rescanFolderState, updateFolderCategory } from './folder-sorter.js'
import { listInferenceDevices } from './inference-devices.js'
import { curatePhotos, validatePhotoSource } from './photo-curator.js'
import { applyPublicReviewLabel, readPublicReview, resolveReviewSource, reviewStatus } from './public-review.js'
import { createLaionAestheticScorer } from './laion-aesthetic-scorer.js'
import { createMusiqAestheticScorer } from './musiq-aesthetic-scorer.js'
import { modelProfiles } from './model-resource-policy.js'
import { inspectModelOptions } from './model-resources.js'
import { scoreCurationBatch } from './curation-scoring.js'

const execute = promisify(execFile)

async function chooseFolder(current) {
  if (process.platform !== 'win32') throw Object.assign(new Error('系统文件夹选择器目前仅支持 Windows；请直接输入绝对路径'), { status: 400 })
  const selectedFile = path.join(os.tmpdir(), 'lenssort-folder-' + randomBytes(12).toString('hex') + '.txt')
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = '选择 LensSort 照片文件夹'",
    '$dialog.ShowNewFolderButton = $true',
    '$dialog.SelectedPath = $env:LENSORT_INITIAL_PATH',
    `if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText($env:LENSORT_SELECTED_FILE, $dialog.SelectedPath, [System.Text.UTF8Encoding]::new($false)) }`,
  ].join('; ')
  try {
    await execute('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: false, timeout: 300000, maxBuffer: 16384, env: { ...process.env, LENSORT_INITIAL_PATH: String(current || ''), LENSORT_SELECTED_FILE: selectedFile } })
    const selected = (await readFile(selectedFile, 'utf8')).trim()
    return selected ? path.resolve(selected) : null
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  } finally { await unlink(selectedFile).catch(() => {}) }
}

export async function createControlServer({ root, controlDir = path.join(root, 'data/control'), port = 4317, analyzerFactory = createPhotoAnalyzer }) {
  await mkdir(controlDir, { recursive: true })
  const token = randomBytes(24).toString('hex')
  const devices = await listInferenceDevices(root)
  const defaultBackend = devices.find(device => device.id === 'igpu')?.id ?? devices.find(device => device.id === 'dgpu')?.id ?? 'cpu'
  let config = { input: path.join(root, 'data/inbox'), output: path.join(root, 'data/sorted'), backend: defaultBackend, model: 'auto' }
  let configWarning = null
  const configFile = path.join(controlDir, 'config.json')
  try {
    const saved = JSON.parse(await readFile(configFile, 'utf8'))
    const backend = devices.some(device => device.id === saved.backend) ? saved.backend : defaultBackend
    const inputBroken = typeof saved.input !== 'string' || saved.input.includes('\ufffd')
    const outputBroken = typeof saved.output !== 'string' || saved.output.includes('\ufffd')
    const model = saved.model === 'auto' || modelProfiles().some(item => item.id === saved.model) ? saved.model : 'auto'
    config = { input: inputBroken ? config.input : path.resolve(saved.input), output: outputBroken ? config.output : path.resolve(saved.output), backend, model, forceModel: saved.forceModel === true }
    if (inputBroken || outputBroken) configWarning = '检测到旧配置中的路径编码损坏，已恢复默认目录；请重新选择文件夹。'
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const stateDir = () => path.join(controlDir, createHash('sha256').update(config.input + '\n' + config.output).digest('hex').slice(0, 24))
  let phase = 'stopped'
  let errorMessage = null
  let analyzer
  let lastDevice = null
  let lastNpuVerified = false
  let lastVisionModelStatus = null
  let stopping
  let sorter
  let curating = false
  let aestheticScorer
  let musiqScorer
  let curation = { phase: 'idle', sources: [], warnings: [], considered: 0, selected: 0 }
  let progress = { phase: 'idle', completed: 0, total: 0, pending: 0, currentFile: null, message: '准备好后，点击一键筛选开始。' }
  const events = []
  const recordId = source => createHash('sha256').update(source).digest('hex')
  const curatedManifest = () => path.join(config.output, '精选', 'selection.json')
  let curatedIds = new Set()
  let curatedDetails = new Map()
  const loadCuratedIds = async () => {
    try {
      const selected = JSON.parse(await readFile(curatedManifest(), 'utf8')).selected ?? []
      curatedIds = new Set(selected.map(item => item.id))
      curatedDetails = new Map(selected.map(item => [item.id, item]))
    } catch (error) { if (error.code !== 'ENOENT') throw error; curatedIds = new Set(); curatedDetails = new Map() }
  }
  await loadCuratedIds()
  const records = async () => {
    try {
      const state = JSON.parse(await readFile(path.join(stateDir(), 'records.json'), 'utf8'))
      return (await Promise.all(Object.entries(state.sources).map(async ([source, record]) => {
        try {
          const sourceInfo = await lstat(source)
          if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) return null
        } catch (caught) {
          if (caught.code === 'ENOENT') return null
          throw caught
        }
        let status = record.status
        let error = record.error
        if (status === 'output-deleted') error = '已删除输出副本，原图仍保留；不会自动恢复'
        if (status === 'source-missing') error = '输入文件夹中暂时找不到原图；重新放回后可继续处理'
        if (status === 'output-missing') error = '分类结果副本已缺失；点击一键筛选后会按原图状态恢复'
        if (status === 'done') {
          try {
            const info = await lstat(record.output)
            if (!info.isFile() || info.isSymbolicLink()) throw new Error('输出副本不可用')
          } catch (caught) {
            if (caught.code !== 'ENOENT') error = caught.message
            else error = '输出副本缺失，启动筛选后会自动恢复'
            status = 'repairing'
          }
        }
        if (status !== 'done' && status !== 'failed') return null
        return { id: recordId(source), name: path.basename(source), status, manualAction: record.manualAction ?? null, manualCategory: record.manualCategory ?? null, manualCategoryAt: record.manualCategoryAt ?? null, deletedAt: record.deletedAt ?? null, category: record.result?.category, sceneLabel: record.result?.sceneLabel ?? null, reason: record.result?.reason, explanation: record.result?.explanation ?? null, hash: record.hash, qualityScore: record.result?.qualityScore, qualityReasons: record.result?.qualityReasons ?? [], clarityScore: record.result?.clarityScore, exposureStatus: record.result?.exposureStatus, faceCount: record.result?.faces?.faceCount ?? 0, faceAreaRatio: record.result?.faces?.faceAreaRatio ?? 0, error, backend: record.result?.backend, device: record.result?.device, durationMs: record.result?.durationMs, npuVerified: record.result?.npuVerified ?? false, npuEvidence: record.result?.npuEvidence ?? null, modelEvidence: record.result?.modelEvidence ?? null, personDetection: record.result?.personDetection ?? null, sceneSemantics: record.result?.sceneSemantics ?? null, visionTriggered: record.result?.visionTriggered ?? false, visionTriggerReason: record.result?.visionTriggerReason ?? null, visionCategoryApplied: record.result?.visionCategoryApplied ?? false, visionExplanation: record.result?.visionExplanation ?? null, visionModelStatus: record.result?.visionModelStatus ?? null, aestheticScore: record.result?.aestheticScore ?? null, aestheticNormalizedScore: record.result?.aestheticNormalizedScore ?? null, completedAt: record.completedAt, output: record.output, curated: status === 'done' && curatedIds.has(recordId(source)), source }
      }))).filter(Boolean).map(record => ({ ...record, subjectQuality: state.sources[record.source]?.result?.subjectQuality ?? null, curationDetails: record.curated ? curatedDetails.get(record.id) ?? null : null }))
    } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  const stop = async (completed = false) => {
    if (phase === 'starting') throw Object.assign(new Error('Service busy'), { status: 409 })
    if (stopping) return stopping
    if (phase === 'stopped') return
    phase = 'stopping'
    stopping = (async () => {
      try { if (sorter) await sorter.close() }
      finally {
        sorter = null
        lastDevice = analyzer?.device ?? lastDevice
        lastNpuVerified = analyzer?.npuVerified ?? lastNpuVerified
        lastVisionModelStatus = analyzer?.visionModelStatus ?? lastVisionModelStatus
        try { if (analyzer) await analyzer.close(); if (aestheticScorer) await aestheticScorer.close(); if (musiqScorer) await musiqScorer.close() }
        finally {
          lastVisionModelStatus = analyzer?.visionModelStatus ?? lastVisionModelStatus
          analyzer = null
          aestheticScorer = null
          musiqScorer = null
          if (!completed) progress = { ...progress, phase: 'cancelled', currentFile: null, message: '本批筛选已手动停止；点击一键筛选可继续。' }
          phase = 'stopped'
        }
      }
    })()
    try { await stopping } finally { stopping = null }
  }
  const start = async () => {
    if (phase !== 'stopped' || curating) throw Object.assign(new Error('正在处理照片，请等待本批结束'), { status: 409 })
    phase = 'starting'
    curation = { phase: 'idle', sources: [], warnings: [], considered: 0, selected: 0 }
    errorMessage = null
    progress = { phase: 'starting', completed: 0, total: 0, pending: 0, currentFile: null, message: '正在加载本地模型与识别组件…' }
    try {
      analyzer = await analyzerFactory(root, config.backend, config.model, { forceModel: config.forceModel === true, onProgress: event => { progress = { ...progress, message: event.message }; events.push({ type: 'vision-progress', ...event, at: new Date().toISOString() }); if (events.length > 50) events.shift() } })
      progress = { phase: 'starting', completed: 0, total: 0, pending: 0, currentFile: null, message: '模型已就绪，正在扫描本批照片…' }
      const vision = analyzer.visionModelStatus
      const analysisVersion = `global-v8:person-tiles:${vision?.status ?? 'none'}:${vision?.model ?? 'none'}:${process.env.LENSSORT_VLM_MODE || 'precision'}:${config.forceModel ? 'forced' : 'safe'}`
       sorter = await createFolderSorter({ ...config, batch: true, stateDir: stateDir(), analysisVersion, pollMs: 300, stableMs: 800, analyze: bytes => analyzer.analyze(bytes), onEvent: event => { if (event.type === 'progress') progress = event; else { events.push({ ...event, at: new Date().toISOString() }); if (events.length > 50) events.shift() } } })
      phase = 'running'
      const activeSorter = sorter
      void activeSorter.finished.then(async result => {
        if (sorter !== activeSorter || phase !== 'running') return
        progress = result
        if (result.error) errorMessage = result.error
        await stop(true)
      }).catch(error => { errorMessage = error.message })
    } catch (error) { if (analyzer) await analyzer.close(); analyzer = null; phase = 'stopped'; errorMessage = error.message; throw error }
  }
  const server = http.createServer()
  let origin
  const json = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)) }
  server.on('request', async (request, response) => {
    try {
      const route = new URL(request.url, origin).pathname
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) { json(response, 403, { error: 'Local same-origin requests only' }); return }
      if (request.method === 'GET' && route === '/api/status') {
        json(response, 200, { token, config, configWarning, phase, error: errorMessage, device: analyzer?.device ?? lastDevice, devices, events, progress, curation, records: (await records()).map(({ source: _source, ...record }) => record), npuVerified: analyzer?.npuVerified ?? lastNpuVerified, visionModelStatus: analyzer?.visionModelStatus ?? lastVisionModelStatus }); return
      }
      if (request.method === 'GET' && route === '/api/models') {
        json(response, 200, await inspectModelOptions(config.model)); return
      }
      if (request.method === 'GET' && route === '/api/review') {
        json(response, 200, reviewStatus(await readPublicReview(root))); return
      }
      if (request.method === 'POST' && route.startsWith('/api/')) {
        if (request.headers['x-lenssort-token'] !== token || request.headers['content-type'] !== 'application/json') { json(response, 403, { error: 'Invalid control token' }); return }
        let body = ''
        for await (const chunk of request) { body += chunk; if (body.length > 16384) throw Object.assign(new Error('Request too large'), { status: 413 }) }
        let payload
        try { payload = JSON.parse(body || '{}') } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }) }
        if (route === '/api/pick-folder') {
          if (phase !== 'stopped' || curating) throw Object.assign(new Error('停止筛选后才能选择文件夹'), { status: 409 })
          if (payload.kind !== 'input' && payload.kind !== 'output') throw Object.assign(new Error('Folder kind must be input or output'), { status: 400 })
          const selected = await chooseFolder(payload.current)
          json(response, 200, { selected }); return
        } else if (route === '/api/config') {
          if (phase !== 'stopped' || curating) throw Object.assign(new Error('Stop monitoring before changing settings'), { status: 409 })
          if (typeof payload.input !== 'string' || typeof payload.output !== 'string' || !path.isAbsolute(payload.input) || !path.isAbsolute(payload.output) || !devices.some(device => device.id === payload.backend)) throw Object.assign(new Error('请选择有效的文件夹，并选择当前电脑可用的设备'), { status: 400 })
          const model = payload.model ?? config.model ?? 'auto'
          if (model !== 'auto' && !modelProfiles().some(item => item.id === model)) throw Object.assign(new Error('请选择受支持的视觉模型'), { status: 400 })
          const next = { input: path.resolve(payload.input), output: path.resolve(payload.output), backend: payload.backend, model, forceModel: payload.forceModel === true && model !== 'auto' && model !== 'off' }
          const relative = path.relative(next.input, next.output)
          const reverse = path.relative(next.output, next.input)
          const nested = value => !value || (!value.startsWith('..' + path.sep) && value !== '..' && !path.isAbsolute(value))
          if (nested(relative) || nested(reverse)) throw Object.assign(new Error('Input and output folders must not overlap'), { status: 400 })
          await writeFile(configFile, JSON.stringify(next, null, 2))
          config = next
          configWarning = null
          await loadCuratedIds()
        } else if (route === '/api/start') await start()
        else if (route === '/api/stop') await stop()
        else if (route === '/api/delete-output') {
          if (payload.confirm !== true || typeof payload.id !== 'string') throw Object.assign(new Error('请确认删除输出副本'), { status: 400 })
          const record = (await records()).find(item => item.id === payload.id)
          if (!record?.source) throw Object.assign(new Error('找不到可删除的输出副本'), { status: 404 })
          if (sorter) await sorter.deleteOutput(record.source)
          else await deleteFolderOutput({ stateDir: stateDir(), output: config.output, source: record.source })
          json(response, 200, { phase, config, deleted: true, originalPreserved: true }); return
        } else if (route === '/api/update-category') {
          if (payload.confirm !== true || typeof payload.id !== 'string' || typeof payload.category !== 'string') throw Object.assign(new Error('请确认新的分类标签'), { status: 400 })
          const record = (await records()).find(item => item.id === payload.id)
          if (!record?.source) throw Object.assign(new Error('找不到可修改分类的照片'), { status: 404 })
          const updated = sorter
            ? await sorter.updateCategory(record.source, payload.category)
            : await updateFolderCategory({ stateDir: stateDir(), output: config.output, source: record.source, category: payload.category })
          json(response, 200, { phase, config, updated: true, originalPreserved: true, category: updated.result.category }); return
        } else if (route === '/api/rescan') {
          if (curating) throw Object.assign(new Error('正在精选，请稍候再重新扫描'), { status: 409 })
          const summary = sorter
            ? await sorter.rescan()
            : await rescanFolderState({ stateDir: stateDir(), input: config.input, output: config.output })
          json(response, 200, { phase, config, rescanned: true, summary }); return
        } else if (route === '/api/curate') {
          if (curating || phase !== 'stopped') throw Object.assign(new Error('请等待当前照片处理结束后再生成精选'), { status: 409 })
          curating = true
          curation = { phase: 'scoring', sources: [], warnings: [], considered: 0, selected: 0 }
          try {
            const current = await records()
            for (const record of current) {
              if (record.status !== 'done' || Number.isFinite(record.qualityScore)) continue
              const { bytes } = await validatePhotoSource(record, config.output)
              Object.assign(record, await analyzePhotoQuality(bytes))
            }
            const scoring = await scoreCurationBatch({
              records: current,
              validate: record => validatePhotoSource(record, config.output),
              onProgress: next => {
                curation = { ...curation, ...next }
                progress = { ...progress, ...next, pending: Math.max(0, next.total - next.completed), currentFile: null }
              },
              laionFactory: async () => {
                const scorer = await createLaionAestheticScorer(root)
                aestheticScorer = scorer
                return { score: bytes => scorer.score(bytes), close: async () => { await scorer.close(); aestheticScorer = null } }
              },
              musiqFactory: async () => {
                const scorer = await createMusiqAestheticScorer(root)
                musiqScorer = scorer
                return scorer ? { scoreBatch: (...args) => scorer.scoreBatch(...args), close: async () => { await scorer.close(); musiqScorer = null } } : null
              },
            })
            curation = { ...curation, phase: 'ranking', sources: scoring.sources, warnings: scoring.warnings }
            const result = await curatePhotos({ records: current, output: config.output, manifestFile: curatedManifest() })
            await loadCuratedIds()
            curation = { ...curation, phase: 'finished', considered: result.considered, selected: result.selected.length }
            progress = { phase: 'finished', completed: result.considered, total: result.considered, pending: 0, currentFile: null, message: result.message }
            json(response, 200, { phase, config, curation, ...result }); return
          } catch (error) {
            curation = { ...curation, phase: 'error' }
            progress = { ...progress, phase: 'error', message: '精选失败，原图未改动：' + error.message }
            throw error
          } finally {
            try { if (aestheticScorer) await aestheticScorer.close(); if (musiqScorer) await musiqScorer.close() }
            finally { aestheticScorer = null; musiqScorer = null; curating = false }
          }
        } else if (route === '/api/review') {
          if (phase !== 'stopped') throw Object.assign(new Error('请先停止自动筛选，再进行样本审核'), { status: 409 })
          if (typeof payload.imageId !== 'string' || typeof payload.label !== 'string') throw Object.assign(new Error('审核图片和标签不能为空'), { status: 400 })
          json(response, 200, await applyPublicReviewLabel(root, payload.imageId, payload.label)); return
        }
        else { json(response, 404, { error: 'Unknown control operation' }); return }
        json(response, 200, { phase, config }); return
      }
      if (request.method === 'GET' && route.startsWith('/api/review/thumbnail/')) {
        const imageId = route.split('/').pop()
        const bundle = await readPublicReview(root)
        const record = bundle.records.find(item => item.imageId === imageId)
        if (!record) { json(response, 404, { error: 'Unknown review image' }); return }
        const source = resolveReviewSource(root, record)
        const thumbnail = await sharp(source, { limitInputPixels: 80_000_000 }).rotate().resize(1000, 760, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer()
        response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); response.end(thumbnail); return
      }
      if (request.method === 'GET' && route.startsWith('/api/thumbnail/')) {
        const id = route.split('/').pop()
        const record = (await records()).find(item => item.id === id && item.status === 'done')
        if (!record) { json(response, 404, { error: 'Unknown photo' }); return }
        const thumbnail = await sharp(record.output, { limitInputPixels: 80_000_000 }).rotate().resize(640, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
        response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); response.end(thumbnail); return
      }
      if (request.method === 'GET' && route.startsWith('/api/photo-image/')) {
        const id = route.split('/').pop()
        const record = (await records()).find(item => item.id === id && item.status === 'done')
        if (!record) { json(response, 404, { error: 'Unknown photo' }); return }
        const image = await sharp(record.output, { limitInputPixels: 80_000_000 }).rotate().resize(1800, 1400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
        response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); response.end(image); return
      }
      if (request.method === 'GET' && route.startsWith('/api/photo/')) {
        const id = route.split('/').pop()
        const record = (await records()).find(item => item.id === id)
        if (!record) { json(response, 404, { error: 'Unknown photo' }); return }
        const { source: _source, output: _output, ...details } = record
        json(response, 200, { ...details, imageUrl: `/api/photo-image/${id}` })
        return
      }
      if (request.method === 'GET' && (route === '/' || route === '/index.html' || route === '/favicon.svg' || route.startsWith('/assets/'))) {
        const dist = path.join(root, 'dist')
        const file = path.resolve(dist, route === '/' ? 'index.html' : '.' + route)
        if (!file.startsWith(dist + path.sep)) { json(response, 403, { error: 'Invalid path' }); return }
        try {
          if (!(await stat(file)).isFile()) throw new Error('Not a file')
          const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }
          response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); response.end(await readFile(file)); return
        } catch { json(response, 404, { error: 'Build webpage with npm run build first' }); return }
      }
      json(response, 404, { error: 'Not found' })
    } catch (error) { json(response, error.status ?? 500, { error: error.message }) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  origin = 'http://127.0.0.1:' + server.address().port
  return { origin, close: async () => { await stop(); await new Promise(resolve => server.close(resolve)) } }
}
