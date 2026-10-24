import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, realpath, lstat, readdir, readFile, writeFile, unlink, open, link, rename } from 'node:fs/promises'
import { writeAtomicJson } from './atomic-state.js'

const categories = new Set(['单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认'])
const extensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif'])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const signature = stat => stat.size + ':' + stat.mtimeMs
const within = (parent, child) => {
  const relative = path.relative(parent, child)
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

const walkFolder = async folder => {
  const files = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const file = path.join(folder, entry.name)
    if (entry.isDirectory()) files.push(...await walkFolder(file))
    else if (entry.isFile() && extensions.has(path.extname(file).toLowerCase())) files.push(file)
  }
  return files
}

const validOutput = async (outputRoot, outputPath) => {
  if (!outputPath || !within(outputRoot, outputPath)) return false
  try {
    const info = await lstat(outputPath)
    return info.isFile() && !info.isSymbolicLink() && within(outputRoot, await realpath(outputPath))
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export async function rescanFolderState({ stateDir, input, output }) {
  const stateFile = path.join(path.resolve(stateDir), 'records.json')
  await Promise.all([stateDir, input, output].map(folder => mkdir(folder, { recursive: true })))
  let state
  try { state = JSON.parse(await readFile(stateFile, 'utf8')) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    state = { version: 1, input: await realpath(input), output: await realpath(output), sources: {} }
  }
  const inputRoot = await realpath(input)
  const outputRoot = await realpath(output)
  const files = await walkFolder(inputRoot)
  const currentFiles = new Set(files)
  const summary = { scannedFiles: files.length, newFiles: 0, sourceMissing: 0, outputMissing: 0, outputDeleted: 0, restoredSources: 0, changed: 0, scannedAt: new Date().toISOString() }
  for (const file of files) {
    const info = await lstat(file)
    const expected = signature(info)
    const previous = state.sources[file]
    if (!previous) {
      state.sources[file] = { status: 'pending', analysisVersion: state.analysisVersion ?? 1, signature: expected, pendingAt: summary.scannedAt }
      summary.newFiles++
      summary.changed++
      continue
    }
    const outputExists = await validOutput(outputRoot, previous.output)
    if (previous.status === 'output-deleted') {
      summary.outputDeleted++
      continue
    }
    if (previous.status === 'source-missing') {
      const nextStatus = outputExists ? 'done' : 'output-missing'
      state.sources[file] = { ...previous, status: nextStatus, signature: expected, restoredAt: summary.scannedAt }
      if (nextStatus === 'done') summary.restoredSources++
      else summary.outputMissing++
      summary.changed++
      continue
    }
    if (previous.status === 'output-missing') {
      if (outputExists) {
        state.sources[file] = { ...previous, status: 'done', signature: expected, restoredAt: summary.scannedAt }
        summary.restoredSources++
        summary.changed++
      } else summary.outputMissing++
      continue
    }
    if (previous.status === 'done' && !outputExists) {
      state.sources[file] = { ...previous, status: 'output-missing', outputMissingAt: summary.scannedAt }
      summary.outputMissing++
      summary.changed++
    }
  }
  for (const [source, record] of Object.entries(state.sources)) {
    if (currentFiles.has(source) || record.status === 'output-deleted' || record.status === 'source-missing') continue
    if (record.status !== 'source-missing') {
      state.sources[source] = { ...record, status: 'source-missing', sourceMissingAt: summary.scannedAt }
      summary.sourceMissing++
      summary.changed++
    }
  }
  if (summary.changed) await writeAtomicJson(stateFile, state)
  return summary
}

export async function deleteFolderOutput({ stateDir, output, source }) {
  const stateFile = path.join(path.resolve(stateDir), 'records.json')
  const state = JSON.parse(await readFile(stateFile, 'utf8'))
  const record = state.sources?.[source]
  if (!record || record.status !== 'done' || !record.output || !within(output, record.output)) throw new Error('可删除的输出副本不存在')
  const outputRoot = await realpath(output)
  const target = path.resolve(record.output)
  if (!within(outputRoot, target)) throw new Error('输出副本路径不安全')
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('输出副本路径不安全')
  if (!within(outputRoot, await realpath(target))) throw new Error('输出副本路径不安全')
  await unlink(target)
  const deletedAt = new Date().toISOString()
  for (const [sharedSource, sharedRecord] of Object.entries(state.sources)) {
    if (sharedRecord.status === 'done' && typeof sharedRecord.output === 'string' && path.resolve(sharedRecord.output) === target) {
      state.sources[sharedSource] = { ...sharedRecord, status: 'output-deleted', manualAction: 'deleted-output', output: null, deletedAt }
    }
  }
  await writeAtomicJson(stateFile, state)
  return state.sources[source]
}

export async function updateFolderCategory({ stateDir, output, source, category }) {
  if (!categories.has(category)) throw new Error('无效分类')
  const stateFile = path.join(path.resolve(stateDir), 'records.json')
  const state = JSON.parse(await readFile(stateFile, 'utf8'))
  const record = state.sources?.[source]
  if (!record || record.status !== 'done' || !record.output || !within(output, record.output)) throw new Error('可移动的输出副本不存在')
  const outputRoot = await realpath(output)
  const current = path.resolve(record.output)
  if (!within(outputRoot, current)) throw new Error('输出副本路径不安全')
  const currentInfo = await lstat(current)
  if (!currentInfo.isFile() || currentInfo.isSymbolicLink()) throw new Error('输出副本路径不安全')
  if (!within(outputRoot, await realpath(current))) throw new Error('输出副本路径不安全')
  const categoryDir = path.join(outputRoot, category)
  await mkdir(categoryDir, { recursive: true })
  const categoryInfo = await lstat(categoryDir)
  if (!categoryInfo.isDirectory() || categoryInfo.isSymbolicLink()) throw new Error('目标分类目录不安全')
  const target = path.join(categoryDir, path.basename(current))
  const sharedSources = Object.entries(state.sources).filter(([, item]) => item.status === 'done' && path.resolve(item.output ?? '') === current)
  const manualCategoryAt = new Date().toISOString()
  const updateRecords = destination => {
    for (const [sharedSource, sharedRecord] of sharedSources) {
      state.sources[sharedSource] = { ...sharedRecord, output: destination, manualCategory: category, manualAction: 'category-corrected', manualCategoryAt, result: { ...sharedRecord.result, category } }
    }
    return state.sources[source]
  }
  if (path.resolve(target) === current) {
    const updated = updateRecords(current)
    await writeAtomicJson(stateFile, state)
    return updated
  }
  try { await lstat(target); throw Object.assign(new Error('目标分类已有同名输出副本，请先处理冲突'), { code: 'EEXIST' }) }
  catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EEXIST') throw error; if (error.code === 'EEXIST') throw error }
  await rename(current, target)
  const updated = updateRecords(target)
  await writeAtomicJson(stateFile, state)
  return updated
}

export async function createFolderSorter(options) {
  if (typeof options.analyze !== 'function') throw new Error('analyze is required')
  const analysisVersion = options.analysisVersion ?? 1
  const directories = [options.input, options.output, options.stateDir].map(folder => path.resolve(folder))
  for (const [index, folder] of directories.entries()) {
    if (directories.some((other, otherIndex) => index !== otherIndex && (within(folder, other) || within(other, folder)))) throw new Error('Input, output and state directories must not overlap')
  }
  for (const folder of directories) await mkdir(folder, { recursive: true })
  const [input, output, stateDir] = await Promise.all(directories.map(folder => realpath(folder)))
  for (const [index, folder] of [input, output, stateDir].entries()) {
    if ([input, output, stateDir].some((other, otherIndex) => index !== otherIndex && (within(folder, other) || within(other, folder)))) throw new Error('Input, output and state directories must not overlap')
  }
  const lockPath = path.join(stateDir, 'service.lock')
  let lock
  try { lock = await open(lockPath, 'wx') }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const old = JSON.parse(await readFile(lockPath, 'utf8'))
    try { process.kill(old.pid, 0); throw new Error('Service already running (lock)') }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe }
    await unlink(lockPath)
    lock = await open(lockPath, 'wx')
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, input, output }))
  const stateFile = path.join(stateDir, 'records.json')
  let state = { version: 1, input, output, sources: {} }
  try {
    try { state = JSON.parse(await readFile(stateFile, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (state.version !== 1 || state.input !== input || state.output !== output || !state.sources) throw new Error('State does not match folders; use a separate state directory')
  } catch (error) { await lock.close(); await unlink(lockPath); throw error }
  const observed = new Map()
  const batch = options.batch === true
  const terminal = new Map()
  let batchFiles
  let batchResult
  let resolveFinished
  const finished = new Promise(resolve => { resolveFinished = resolve })
  const outputValidation = new Map()
  const save = async () => {
    await writeAtomicJson(stateFile, state)
  }
  const notify = event => { try { options.onEvent?.(event) } catch {} }
  const walk = async folder => {
    const files = []
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const file = path.join(folder, entry.name)
      if (entry.isDirectory()) files.push(...await walk(file))
      else if (entry.isFile() && extensions.has(path.extname(file).toLowerCase())) files.push(file)
    }
    return files
  }
  const hasValidOutput = async record => {
    if (!record?.output || !record.hash || !within(output, record.output)) return false
    try {
      const info = await lstat(record.output)
      if (!info.isFile() || info.isSymbolicLink()) return false
      const currentSignature = signature(info)
      const cached = outputValidation.get(record.output)
      if (cached?.signature === currentSignature && cached.hash === record.hash) return true
      const actualHash = digest(await readFile(record.output))
      const valid = actualHash === record.hash
      if (valid) outputValidation.set(record.output, { signature: currentSignature, hash: actualHash })
      return valid
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }
  let stopped = false
  let running
  const pollMs = Math.max(20, options.pollMs ?? 1000)
  const stableMs = Math.max(pollMs * 2, options.stableMs ?? 2000)
  try { await save() }
  catch (error) { await lock.close(); await unlink(lockPath); throw error }
  const processFile = async (file, expected, completed, total) => {
    notify({ type: 'progress', phase: 'analyzing', completed, total, pending: total - completed, currentFile: file, message: '正在分析：' + path.basename(file) })
    const current = await lstat(file)
    if (!current.isFile() || current.isSymbolicLink() || signature(current) !== expected) return false
    if (current.size > 128 * 1024 * 1024) throw new Error('Photo exceeds 128 MiB limit')
    const resolved = await realpath(file)
    if (!within(input, resolved)) throw new Error('Source escapes input folder')
    const bytes = await readFile(file)
    if (signature(await lstat(file)) !== expected) return false
    const hash = digest(bytes)
    const matches = Object.values(state.sources).filter(item => item.hash === hash)
    const existing = matches.find(item => item.analysisVersion === analysisVersion) ?? matches[0]
    const manualCategory = existing?.manualCategory
    const preservedDeleted = existing?.manualAction === 'deleted-output' || existing?.status === 'output-deleted'
    let result = existing?.result ?? null
    let destination = !preservedDeleted && existing?.output && within(output, existing.output) ? existing.output : null
    if (destination) {
      try { if (digest(await readFile(destination)) !== hash) destination = null }
      catch (error) { if (error.code === 'ENOENT') destination = null; else throw error }
    }
    if (!result || (existing?.analysisVersion !== analysisVersion && !preservedDeleted)) result = await options.analyze(bytes)
    if (manualCategory) result = { ...result, category: manualCategory }
    if (!categories.has(result.category)) throw new Error('Analyzer returned invalid category')
    if (destination && path.basename(path.dirname(destination)) !== result.category) destination = null
    if (signature(await lstat(file)) !== expected) return false
    if (!destination && !preservedDeleted) {
      const categoryDir = path.join(output, result.category)
      await mkdir(categoryDir, { recursive: true })
      if ((await lstat(categoryDir)).isSymbolicLink()) throw new Error('Output category symlink is forbidden')
      const name = path.parse(file).name.slice(0, 80) + '--' + hash + path.extname(file).toLowerCase()
      destination = path.join(categoryDir, name)
      const temporary = path.join(categoryDir, '.' + randomUUID() + '.tmp')
      try {
        await writeFile(temporary, bytes, { flag: 'wx' })
        try { await link(temporary, destination) }
        catch (error) { if (error.code !== 'EEXIST' || digest(await readFile(destination)) !== hash) throw error }
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    }
    const previous = state.sources[file]
    state.sources[file] = { ...previous, status: preservedDeleted ? 'output-deleted' : 'done', analysisVersion, signature: expected, hash, output: preservedDeleted ? null : destination, result, manualCategory, manualAction: preservedDeleted ? 'deleted-output' : previous?.manualAction, completedAt: new Date().toISOString(), sourceMissingAt: undefined, outputMissingAt: undefined }
    await save()
    notify({ type: preservedDeleted ? 'output-deleted' : 'classified', category: result.category, file, output: destination })
    return true
  }
  const deleteOutput = async source => {
    const record = state.sources[source]
    if (!record || record.status !== 'done' || !record.output || !within(output, record.output)) throw new Error('可删除的输出副本不存在')
    const info = await lstat(record.output)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('输出副本路径不安全')
    await unlink(record.output)
    const deletedAt = new Date().toISOString()
    for (const [sharedSource, sharedRecord] of Object.entries(state.sources)) {
      if (sharedRecord.status === 'done' && typeof sharedRecord.output === 'string' && path.resolve(sharedRecord.output) === path.resolve(record.output)) {
        state.sources[sharedSource] = { ...sharedRecord, status: 'output-deleted', manualAction: 'deleted-output', output: null, deletedAt }
      }
    }
    await save()
    notify({ type: 'output-deleted', file: source })
    return state.sources[source]
  }
  const inspect = async () => {
    const files = batch ? (batchFiles ??= await walk(input)) : await walk(input)
    let completed = 0
    notify({ type: 'progress', phase: 'scanning', completed, total: files.length, pending: files.length, currentFile: null, message: files.length ? `已发现 ${files.length} 张照片，正在检查文件状态…` : '正在等待新照片…' })
    for (const file of files) {
      if (stopped) break
      if (batch && terminal.has(file)) { completed++; continue }
      let stat
      try { stat = await lstat(file) }
      catch (error) { if (error.code === 'ENOENT') { if (batch) { terminal.set(file, 'missing'); completed++ }; continue }; throw error }
      if (!stat.isFile() || stat.isSymbolicLink()) { if (batch) { terminal.set(file, 'missing'); completed++ }; continue }
      const expected = signature(stat)
      const previous = state.sources[file]
      const seen = observed.get(file)
      if (batch && seen && Date.now() - seen.firstAt > (options.maxStableWaitMs ?? 30000) && (seen.signature !== expected || Date.now() - seen.at < stableMs)) {
        state.sources[file] = { ...previous, status: 'failed', analysisVersion, signature: expected, error: '文件持续变化，请写入完成后重新筛选', failedAt: new Date().toISOString() }
        await save()
        terminal.set(file, 'failed')
        completed++
        continue
      }
      if (previous?.status === 'done' && previous.analysisVersion === analysisVersion && previous.signature === expected && await hasValidOutput(previous)) { completed++; continue }
      if (previous?.status === 'output-deleted' && previous.analysisVersion === analysisVersion && previous.signature === expected) { completed++; continue }
      if (previous?.status === 'failed' && previous.analysisVersion === analysisVersion && previous.signature === expected) { completed++; continue }
      if (!seen || seen.signature !== expected) { observed.set(file, { signature: expected, at: Date.now(), firstAt: seen?.firstAt ?? Date.now() }); notify({ type: 'progress', phase: 'waiting', completed, total: files.length, pending: files.length - completed, currentFile: file, message: '正在等待文件写入完成：' + path.basename(file) }); continue }
      if (Date.now() - seen.at < stableMs) { notify({ type: 'progress', phase: 'waiting', completed, total: files.length, pending: files.length - completed, currentFile: file, message: '正在等待文件写入完成：' + path.basename(file) }); continue }
      try {
        if (!await processFile(file, expected, completed, files.length)) continue
        if (batch) terminal.set(file, 'done')
        completed++
        notify({ type: 'progress', phase: 'completed', completed, total: files.length, pending: files.length - completed, currentFile: file, message: `已完成 ${completed}/${files.length} 张` })
      }
      catch (error) {
        if (error.code === 'ENOENT') { if (batch) { terminal.set(file, 'missing'); completed++ }; continue }
        state.sources[file] = { status: 'failed', analysisVersion, signature: expected, error: error.message, failedAt: new Date().toISOString() }
        await save()
        if (batch) terminal.set(file, 'failed')
        notify({ type: 'failed', file, error: error.message })
        completed++
        if (error.code === 'LENSSORT_FORCED_MODEL_FAILED') {
          batchResult = { type: 'progress', phase: 'error', error: error.message, completed, total: files.length, pending: files.length - completed, currentFile: null, message: '强制模型失败，本批已停止；不会改用基础分析。' }
          notify(batchResult)
          return
        }
        notify({ type: 'progress', phase: 'failed', completed, total: files.length, pending: files.length - completed, currentFile: file, message: `已完成 ${completed}/${files.length} 张，${path.basename(file)}处理失败` })
      }
    }
    if (stopped) return
    const pending = files.length - completed
    const failed = files.filter(file => terminal.get(file) === 'failed' || state.sources[file]?.status === 'failed').length
    const missing = [...terminal.values()].filter(value => value === 'missing').length
    if (batch && pending === 0) {
      batchResult = { type: 'progress', phase: 'finished', completed, total: files.length, pending: 0, failed, missing, currentFile: null, message: `本批筛选结束：${completed}/${files.length} 张，失败 ${failed} 张，已移除 ${missing} 张；已自动停止。` }
      notify(batchResult)
    } else notify({ type: 'progress', phase: pending ? 'waiting' : 'idle', completed, total: files.length, pending, currentFile: null, message: pending ? `等待 ${pending} 张照片写入完成…` : files.length ? `本轮处理完成：${completed}/${files.length} 张` : '正在等待新照片…' })
  }
  const tick = () => {
    if (stopped || running) return
    running = inspect().catch(error => {
      notify({ type: 'service-error', error: error.message })
      if (batch) batchResult = { phase: 'error', error: error.message }
    }).finally(async () => {
      running = null
      if (batchResult) {
        try { if (!closing) await controller.close(true); resolveFinished(batchResult) }
        catch (error) { resolveFinished({ phase: 'error', error: error.message }) }
      }
    })
  }
  const timer = setInterval(tick, pollMs)
  let closing
  const controller = {
    finished,
    start() { tick() },
    close(skipRunning = false) {
      closing ??= (async () => {
        stopped = true
        clearInterval(timer)
        try { if (running && !skipRunning) await running }
        finally { await lock.close(); await unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      })()
      return closing
    },
    async waitForIdle() { if (running) await running },
    async deleteOutput(source) { if (running) await running; return deleteOutput(source) },
    async updateCategory(source, category) {
      if (running) await running
      const updated = await updateFolderCategory({ stateDir, output, source, category })
      state = JSON.parse(await readFile(stateFile, 'utf8'))
      outputValidation.clear()
      return updated
    },
    async rescan() {
      if (running) await running
      const summary = await rescanFolderState({ stateDir, input, output })
      state = JSON.parse(await readFile(stateFile, 'utf8'))
      outputValidation.clear()
      notify({ type: 'rescan', ...summary })
      return summary
    },
  }
  tick()
  return controller
}
