import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, readFile, access, unlink } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createFolderSorter } from './folder-sorter.js'

async function fixture(names = []) {
  const root = await mkdtemp(path.resolve('artifacts/batch-test-'))
  const input = path.join(root, '输入')
  const output = path.join(root, '输出')
  const stateDir = path.join(root, 'state')
  await mkdir(input)
  for (const name of names) await writeFile(path.join(input, name), name)
  return { input, output, stateDir, batch: true, pollMs: 10, stableMs: 20, maxStableWaitMs: 100, analyze: async () => ({ category: '风景' }) }
}

async function finish(sorter) {
  assert.ok(sorter.finished instanceof Promise, 'batch must expose completion promise')
  return Promise.race([sorter.finished, sleep(1500).then(() => { throw new Error('batch did not stop') })])
}

test('empty batch stops and releases its lock', async () => {
  const options = await fixture()
  const sorter = await createFolderSorter(options)
  try {
    const result = await finish(sorter)
    assert.equal(result.total, 0)
    await assert.rejects(access(path.join(options.stateDir, 'service.lock')), { code: 'ENOENT' })
  } finally { await sorter.close() }
})

test('batch waits for stable files and ignores later additions until restart', async () => {
  const options = await fixture(['第一张.jpg'])
  let calls = 0
  const events = []
  const sorter = await createFolderSorter({ ...options, analyze: async () => { calls++; return { category: '风景' } }, onEvent: event => events.push(event) })
  try {
    const result = await finish(sorter)
    assert.equal(result.completed, 1)
    assert.equal(result.failed, 0)
    assert.ok(events.some(event => event.phase === 'waiting' && event.pending > 0))
    await writeFile(path.join(options.input, '新增.jpg'), 'later')
    await sleep(80)
    assert.equal(calls, 1)
  } finally { await sorter.close() }
  const restarted = await createFolderSorter({ ...options, analyze: async () => { calls++; return { category: '风景' } } })
  try { assert.equal((await finish(restarted)).total, 2); assert.equal(calls, 2) }
  finally { await restarted.close() }
})

test('failed file is terminal, batch stops, source remains unchanged', async () => {
  const options = await fixture(['bad.jpg'])
  const sorter = await createFolderSorter({ ...options, analyze: async () => { throw new Error('expected decode failure') } })
  try {
    const result = await finish(sorter)
    assert.equal(result.failed, 1)
    assert.equal(result.completed, 1)
    assert.equal(await readFile(path.join(options.input, 'bad.jpg'), 'utf8'), 'bad.jpg')
  } finally { await sorter.close() }
})

test('changing source during analysis is retried, not counted prematurely', async () => {
  const options = await fixture(['changing.jpg'])
  let calls = 0
  const sorter = await createFolderSorter({ ...options, maxStableWaitMs: 1000, analyze: async () => {
    calls++
    if (calls === 1) await writeFile(path.join(options.input, 'changing.jpg'), 'changed content')
    return { category: '风景' }
  } })
  try { assert.equal((await finish(sorter)).completed, 1); assert.equal(calls, 2) }
  finally { await sorter.close() }
})

test('deleted source terminates without recreating it', async () => {
  const options = await fixture(['gone.jpg'])
  const sorter = await createFolderSorter({ ...options, analyze: async () => {
    await unlink(path.join(options.input, 'gone.jpg'))
    return { category: '风景' }
  } })
  try { assert.equal((await finish(sorter)).missing, 1) }
  finally { await sorter.close() }
})

test('continuously changing file stops after stability deadline', async () => {
  const options = await fixture(['writing.jpg'])
  const timer = setInterval(() => { void writeFile(path.join(options.input, 'writing.jpg'), String(Date.now())) }, 8)
  const sorter = await createFolderSorter(options)
  try { assert.equal((await finish(sorter)).failed, 1) }
  finally { clearInterval(timer); await sorter.close() }
})

test('manual stop during analysis does not deadlock with automatic close', async () => {
  const options = await fixture(['slow.jpg'])
  let signal
  const started = new Promise(resolve => { signal = resolve })
  const sorter = await createFolderSorter({ ...options, analyze: async () => {
    signal()
    await sleep(60)
    return { category: '风景' }
  } })
  await started
  await Promise.race([sorter.close(), sleep(1000).then(() => { throw new Error('manual stop deadlock') })])
  await assert.rejects(access(path.join(options.stateDir, 'service.lock')), { code: 'ENOENT' })
})

test('forced model failure stops the batch instead of continuing with basic analysis', async () => {
  const options = await fixture(['first.jpg', 'second.jpg'])
  let calls = 0
  const sorter = await createFolderSorter({ ...options, analyze: async () => {
    calls++
    throw Object.assign(new Error('强制模型运行失败：测试资源不足'), { code: 'LENSSORT_FORCED_MODEL_FAILED' })
  } })
  try {
    const result = await finish(sorter)
    assert.equal(result.phase, 'error')
    assert.match(result.error, /强制模型运行失败/)
    assert.equal(calls, 1)
    await assert.rejects(access(path.join(options.stateDir, 'service.lock')), { code: 'ENOENT' })
  } finally { await sorter.close() }
})
