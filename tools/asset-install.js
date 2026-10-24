import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { resolveInside } from './runtime-paths.js'

async function safeTarget(root, relative) {
  const target = resolveInside(root, relative)
  let current = path.resolve(root)
  for (const part of path.relative(current, target).split(path.sep)) {
    current = path.join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Refusing symbolic link in model path') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return target
}

export async function verifyAsset(root, asset) {
  if (!/^[A-F0-9]{64}$/i.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) throw new Error('Invalid pinned asset manifest')
  const target = await safeTarget(root, asset.path)
  try {
    const info = await lstat(target)
    if (!info.isFile() || info.size !== asset.bytes) return { id: asset.id, path: asset.path, verified: false, error: 'size mismatch' }
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(target)) hash.update(chunk)
    const sha256 = hash.digest('hex').toUpperCase()
    return { id: asset.id, path: asset.path, bytes: info.size, sha256, verified: sha256 === asset.sha256.toUpperCase() }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return { id: asset.id, path: asset.path, verified: false, error: 'missing' }
  }
}

export async function installAsset(root, asset, { repair = false, fetchImpl = fetch, timeoutMs = 300000 } = {}) {
  const existing = await verifyAsset(root, asset)
  if (existing.verified) return { ...existing, status: 'present' }
  if (existing.error !== 'missing' && !repair) throw new Error(`${asset.path}: existing file differs; rerun with --repair to replace it`)
  const target = await safeTarget(root, asset.path)
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.part`
  let handle
  try {
    const response = await fetchImpl(asset.url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${asset.id}`)
    const declared = response.headers.get('content-length')
    if (declared && Number(declared) !== asset.bytes) throw new Error(`Download size mismatch: ${asset.id}`)
    handle = await open(temporary, 'wx')
    const hash = createHash('sha256')
    let count = 0
    for await (const chunk of response.body) {
      count += chunk.length
      if (count > asset.bytes) throw new Error(`Download size limit exceeded: ${asset.id}`)
      hash.update(chunk)
      await handle.writeFile(chunk)
    }
    if (count !== asset.bytes) throw new Error(`Download size mismatch: ${asset.id}`)
    if (hash.digest('hex').toUpperCase() !== asset.sha256.toUpperCase()) throw new Error(`SHA-256 mismatch: ${asset.id}`)
    await handle.sync()
    await handle.close()
    handle = null
    await safeTarget(root, asset.path)
    await rename(temporary, target)
    return { id: asset.id, path: asset.path, status: 'downloaded', bytes: count, verified: true }
  } finally {
    await handle?.close()
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
