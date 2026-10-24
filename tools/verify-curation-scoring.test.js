import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreCurationBatch } from './curation-scoring.js'

const row = () => ({ id: 'a', name: 'a.jpg', status: 'done', qualityScore: 80, hash: 'original' })
test('评分器按LAION释放后MUSIQ启动的顺序运行，传播进度', async () => {
  const events = []
  const records = [row()]
  const summary = await scoreCurationBatch({ root: '.', records, output: '.', freeMemory: () => 8 * 1024 ** 3,
    validate: async () => ({ bytes: Buffer.from('photo'), source: 'photo.jpg' }), onProgress: progress => events.push(progress.phase),
    laionFactory: async () => ({ score: async () => ({ status: 'succeeded', score: 6 }), close: async () => events.push('laion-closed') }),
    musiqFactory: async () => { events.push('musiq-opened'); return { scoreBatch: async (_items, progress) => { progress({ completed: 1, total: 1 }); return { results: [{ id: 'a', sha256: 'original', score: 5 }] } }, close: async () => events.push('musiq-closed') } },
  })
  assert.ok(events.indexOf('laion-closed') < events.indexOf('musiq-opened'))
  assert.equal(records[0].aestheticScore, 6)
  assert.equal(records[0].musiqScore, 5)
  assert.deepEqual(summary.sources, ['LAION', 'MUSIQ-AVA'])
})
test('双模型异常不伪造分，仍关闭并返回技术回退警告', async () => {
  let closed = 0
  const records = [{ ...row(), aestheticScore: 9 }]
  const summary = await scoreCurationBatch({ records, freeMemory: () => 8 * 1024 ** 3, validate: async () => ({ bytes: Buffer.from('x'), source: 'x' }),
    laionFactory: async () => ({ score: async () => { throw new Error('test failure') }, close: async () => { closed++ } }),
    musiqFactory: async () => ({ scoreBatch: async () => { throw new Error('timeout') }, close: async () => { closed++ } }),
  })
  assert.equal(closed, 2)
  assert.equal(records[0].aestheticScore, null)
  assert.equal(records[0].musiqScore, null)
  assert.deepEqual(summary.sources, [])
  assert.ok(summary.warnings.length >= 2)
})
test('低可用内存不启动评分器，不制造OOM', async () => {
  const fail = async () => { throw new Error('must not load') }
  const summary = await scoreCurationBatch({ records: [row()], freeMemory: () => 1024, laionFactory: fail, musiqFactory: fail })
  assert.deepEqual(summary.sources, [])
  assert.ok(summary.warnings.some(text => text.includes('内存')))
})
