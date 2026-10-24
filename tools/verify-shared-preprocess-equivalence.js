import assert from 'node:assert/strict'
import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { analyzePhotoQuality, analyzePhotoQualityFromRgb } from './local-photo-analyzer.js'

const root = process.cwd()
const folder = path.join(root, 'data/eval/public-candidates/open-images')
const category = (await readdir(folder, { withFileTypes: true })).find(entry => entry.isDirectory())
if (!category) throw new Error('No downloaded public candidate category found')
const file = (await readdir(path.join(folder, category.name))).find(name => /\.(jpe?g|png|webp)$/i.test(name))
if (!file) throw new Error('No downloaded public candidate image found')
const bytes = await readFile(path.join(folder, category.name, file))
const prepared = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().removeAlpha().toColourspace('srgb').resize(256, 256, { fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true })
const baseline = await analyzePhotoQuality(bytes)
const shared = analyzePhotoQualityFromRgb(prepared)
assert.deepEqual(shared, baseline)
console.log(JSON.stringify({ status: 'passed', file, baseline, shared, scope: 'quality-only equivalence; no speed or accuracy claim' }, null, 2))
