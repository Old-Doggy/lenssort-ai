import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { installAsset, verifyAsset } from './asset-install.js'

const bytes = Buffer.from('verified-model-fixture')
const asset = { id: 'fixture', path: 'models/test.bin', url: 'https://example.invalid/model', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase() }
const rootFor = () => mkdtemp(path.join(os.tmpdir(), 'lenssort 中文 assets '))

test('verified asset installs atomically, then skips download', async () => {
  const root = await rootFor()
  let calls = 0
  const fetchImpl = async () => { calls++; return new Response(bytes) }
  assert.equal((await installAsset(root, asset, { fetchImpl })).status, 'downloaded')
  assert.equal((await verifyAsset(root, asset)).verified, true)
  assert.equal((await installAsset(root, asset, { fetchImpl })).status, 'present')
  assert.equal(calls, 1)
  assert.deepEqual(await readdir(path.join(root, 'models')), ['test.bin'])
})

test('corrupt existing asset requires explicit repair and survives failed replacement', async () => {
  const root = await rootFor()
  await mkdir(path.join(root, 'models'))
  await writeFile(path.join(root, asset.path), 'old')
  await assert.rejects(installAsset(root, asset), /repair/)
  await assert.rejects(installAsset(root, asset, { repair: true, fetchImpl: async () => new Response(Buffer.alloc(bytes.length, 1)) }), /SHA-256/)
  assert.equal(await readFile(path.join(root, asset.path), 'utf8'), 'old')
  assert.deepEqual(await readdir(path.join(root, 'models')), ['test.bin'])
})

test('rejects oversized response and path escape without network or residue', async () => {
  const root = await rootFor()
  await assert.rejects(installAsset(root, asset, { fetchImpl: async () => new Response(Buffer.alloc(bytes.length + 1)) }), /size/)
  assert.deepEqual(await readdir(path.join(root, 'models')), [])
  await assert.rejects(installAsset(root, { ...asset, path: '../escape.bin' }), /目录/)
  const outside = await rootFor()
  await mkdir(path.join(root, 'linked'))
  await symlink(outside, path.join(root, 'linked', 'out'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(installAsset(root, { ...asset, path: 'linked/out/model.bin' }), /symbolic|link/i)
  assert.deepEqual(await readdir(outside), [])
})
