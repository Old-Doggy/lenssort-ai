import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { rankCurationRecords } from './curation-ranking.js'
import { groupCurationCandidates } from './curation-groups.js'

const curatedFolderName = '精选'

const within = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

async function visualFingerprint(bytes) {
  const input = sharp(bytes, { limitInputPixels: 80_000_000 }).rotate()
  const { data: colorImage, info } = await input.clone().resize(24, 24, { fit: 'inside' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const color = [0, 1, 2].map(channel => {
    let total = 0
    for (let index = channel; index < colorImage.length; index += 3) total += colorImage[index]
    return total / (colorImage.length / 3)
  })
  const image = await input.resize(24, 24, { fit: 'fill' }).greyscale().raw().toBuffer()
  const average = image.reduce((total, value) => total + value, 0) / image.length
  const deviation = Math.sqrt(image.reduce((total, value) => total + (value - average) ** 2, 0) / image.length)
  return { fingerprint: Array.from(image, value => value >= average ? 1 : 0), color, aspect: info.width / info.height, deviation }
}

export async function validatePhotoSource(record, output) {
  const source = path.resolve(record.output)
  if (!within(output, source)) throw new Error('精选来源路径不安全')
  const resolvedRoot = await realpath(output)
  const info = await lstat(source)
  if (!info.isFile() || info.isSymbolicLink() || !within(resolvedRoot, await realpath(source))) throw new Error('精选来源路径不安全')
  if (info.size > 128 * 1024 * 1024) throw new Error('精选来源照片超过 128 MiB')
  const bytes = await readFile(source)
  if (record.hash && digest(bytes) !== record.hash) throw new Error('精选来源内容已变化：' + record.name)
  return { source, bytes, hash: digest(bytes) }
}

export async function curatePhotos({ records, output, manifestFile, selectionRatio = 0.3 }) {
  if (!records.some(record => record.status === 'done')) throw new Error('没有可精选的已分析照片')
  const parent = path.resolve(output, curatedFolderName)
  const expectedManifest = path.join(parent, 'selection.json')
  const resolvedManifest = path.resolve(manifestFile)
  if (resolvedManifest !== expectedManifest) throw new Error('精选清单路径不安全')
  if ((await lstat(parent).catch(error => { if (error.code === 'ENOENT') return null; throw error }))?.isSymbolicLink()) throw new Error('精选输出路径不安全')
  if ((await lstat(resolvedManifest).catch(error => { if (error.code === 'ENOENT') return null; throw error }))?.isSymbolicLink()) throw new Error('精选清单路径不安全')
  const candidates = rankCurationRecords(records)
  const unique = new Map()
  for (const candidate of candidates) {
    const { record } = candidate
    const { source, bytes, hash } = await validatePhotoSource(record, output)
    if (!unique.has(hash)) unique.set(hash, { ...candidate, source, hash, ...await visualFingerprint(bytes) })
  }
  const diversity = groupCurationCandidates([...unique.values()])
  const ratio = Math.max(0.05, Math.min(0.5, Number(selectionRatio) || 0.3))
  const selected = diversity.slice(0, Math.max(1, Math.ceil(diversity.length * ratio)))
  const batch = digest(JSON.stringify(selected.map(item => [item.hash, item.score]))).slice(0, 24)
  try {
    if ((await lstat(parent)).isSymbolicLink()) throw new Error('精选输出路径不安全')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  try {
    if ((await lstat(resolvedManifest)).isSymbolicLink()) throw new Error('精选清单路径不安全')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const folder = path.join(parent, batch)
  await mkdir(parent, { recursive: true })
  if ((await lstat(parent)).isSymbolicLink()) throw new Error('精选输出路径不安全')
  if ((await lstat(resolvedManifest).catch(error => { if (error.code === 'ENOENT') return null; throw error }))?.isSymbolicLink()) throw new Error('精选清单路径不安全')
  if (selected.length) {
    await mkdir(folder, { recursive: true })
    if ((await lstat(folder)).isSymbolicLink()) throw new Error('精选输出路径不安全')
  }
  const outputs = []
  for (const item of selected) {
    const filename = path.parse(item.record.name || path.basename(item.source)).name.slice(0, 80) + '--' + item.hash + path.extname(item.source).toLowerCase()
    const destination = path.join(folder, filename)
    const { bytes } = await validatePhotoSource(item.record, output)
    if (digest(bytes) !== item.hash) throw new Error('精选来源在排序后变化，未复制')
    try { await writeFile(destination, bytes, { flag: 'wx' }) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      if ((await lstat(destination)).isSymbolicLink() || digest(await readFile(destination)) !== item.hash) throw new Error('精选输出已存在且内容不一致，未覆盖')
    }
    outputs.push({ id: item.record.id, name: item.record.name, qualityScore: item.record.qualityScore, aestheticScore: item.record.aestheticScore ?? null, musiqScore: item.record.musiqScore ?? null, aestheticRank: item.aestheticRank, musiqRank: item.musiqRank, selectionBasis: item.basis, selectionScore: item.score, qualityReasons: item.reasons, output: destination, hash: item.hash })
  }
  const manifest = { version: 2, createdAt: new Date().toISOString(), folder, selected: outputs }
  let reused = false
  try {
    const previous = JSON.parse(await readFile(manifestFile, 'utf8'))
    reused = JSON.stringify(previous.selected?.map(item => item.hash)) === JSON.stringify(outputs.map(item => item.hash))
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = resolvedManifest + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx' })
  await rename(temporary, manifestFile)
  const technicalOnly = selected.length > 0 && selected.every(item => item.basis === 'technical-fallback')
  return { folder: selected.length ? folder : null, selected: outputs, reused, considered: unique.size, basis: technicalOnly ? 'technical-fallback' : 'aesthetic-relative-ranking-v5', message: technicalOnly ? '审美模型不可用，仅提供技术质量候选，不代表审美判断' : selected.length ? '按专用审美模型相对排名择优，夜景不因偏暗淘汰；不等于用户主观审美' : '没有可生成精选候选的照片；原图仍保留' }
}
