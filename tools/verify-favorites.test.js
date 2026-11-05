import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createFolderSorter } from './folder-sorter.js'

async function fixture() {
  const root = await mkdtemp(path.resolve('artifacts/favorite-test-'))
  const input = path.join(root, '输入')
  const output = path.join(root, '输出')
  const stateDir = path.join(root, 'state')
  await mkdir(input)
  await writeFile(path.join(input, 'favorite.jpg'), 'favorite')
  return { input, output, stateDir, batch: true, pollMs: 10, stableMs: 20, analyze: async () => ({ category: '风景' }) }
}

async function finish(sorter) {
  return Promise.race([sorter.finished, sleep(1500).then(() => { throw new Error('batch did not stop') })])
}

test('favorite state persists independently from classification', async () => {
  const options = await fixture()
  const sorter = await createFolderSorter(options)
  try { await finish(sorter) } finally { await sorter.close() }
  const source = path.join(options.input, 'favorite.jpg')
  const favorited = await sorterFavorite(options, source, true)
  assert.equal(favorited.result.category, '风景')
  assert.equal(favorited.favorite, true)
  const state = JSON.parse(await readFile(path.join(options.stateDir, 'records.json'), 'utf8'))
  assert.equal(state.sources[source].favorite, true)
  const unfavorited = await sorterFavorite(options, source, false)
  assert.equal(unfavorited.result.category, '风景')
  assert.equal(unfavorited.favorite, false)
})

async function sorterFavorite(options, source, favorite) {
  const { toggleFolderFavorite } = await import('./folder-sorter.js')
  return toggleFolderFavorite({ stateDir: options.stateDir, source, favorite })
}
