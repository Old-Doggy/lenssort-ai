import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
await mkdir(path.join(root, 'artifacts'), { recursive: true })
const fixture = await mkdtemp(path.join(root, 'artifacts/open-images-fixture-'))
const output = path.join(fixture, 'candidates.json')
const checks = []
try {
  const image = (id, license = 'by', title = 'A title') =>
    [id, 'validation', 'https://example.org/' + id + '.jpg', 'https://example.org/photos/' + id,
      'https://creativecommons.org/licenses/' + license + '/2.0/', 'https://example.org/author', 'Author', title,
      '12345', 'md5', id === 'badurl' ? 'https://example.org/not-an-image' : 'https://example.org/' + id + '-thumb.jpg'].join(',')
  await writeFile(path.join(fixture, 'validation-images.csv'),
    'ImageID,Subset,OriginalURL,OriginalLandingURL,License,AuthorProfileURL,Author,Title,OriginalSize,OriginalMD5,Thumbnail300KURL\n' +
    [image('single', 'by', '"A comma, and ""quotes"""'), image('multiple'), image('outdoor'),
      image('landscape'), image('other'), image('uncertain'), image('restricted', 'by-nc'), image('badurl')].join('\n'))
  await writeFile(path.join(fixture, 'validation-annotations-human-imagelabels.csv'),
    'ImageID,Source,LabelName,Confidence\n' + [
      'single,verification,/m/01g317,1', 'multiple,verification,/m/01g317,1',
      'outdoor,verification,/m/01g317,1', 'outdoor,verification,/m/09d_r,1',
      'landscape,verification,/m/09d_r,1', 'other,verification,/m/0bt9lr,1',
      'uncertain,verification,/m/01g317,1', 'restricted,verification,/m/01g317,1',
      'other,verification,/m/01g317,0',
    ].join('\n'))
  await writeFile(path.join(fixture, 'validation-annotations-bbox.csv'),
    'ImageID,Source,LabelName,Confidence,IsGroupOf,IsDepiction\n' + [
      'single,freeform,/m/01g317,1,0,0', 'multiple,freeform,/m/01g317,1,1,0',
    ].join('\n'))
  await writeFile(path.join(fixture, 'class-descriptions.csv'),
    '/m/01g317,Person\n/m/09d_r,Mountain\n/m/0bt9lr,Dog\n')
  const run = limit => spawnSync(process.execPath, [path.join(root, 'tools/build-open-images-candidates.js'),
    '--index-root=' + fixture, '--output=' + output, '--limit-per-class=' + limit], { encoding: 'utf8' })
  const result = run('1')
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(report.records.length, 6)
  assert.deepEqual(report.records.find(record => record.imageId === 'single').sourceLabelNames, ['Person'])
  assert.equal(report.records.find(record => record.imageId === 'single').title, 'A comma, and "quotes"')
  assert.ok(report.records.every(record => record.humanLabel === null && record.downloadStatus === 'not-downloaded'))
  assert.ok(!report.records.some(record => record.imageId === 'restricted'))
  checks.push('headerless dictionary, quoted CSV, negative labels, six candidate mappings and license filtering')
  for (const value of ['0', '31', '-1', '2x', 'Infinity']) {
    assert.notEqual(run(value).status, 0, 'Unbounded/invalid limit accepted: ' + value)
  }
  checks.push('collection limits reject invalid values and values above 30')
  const imagesFile = path.join(fixture, 'validation-images.csv')
  const original = await readFile(imagesFile, 'utf8')
  await writeFile(imagesFile, original + '\nbroken,"unterminated')
  assert.notEqual(run('1').status, 0, 'Malformed quoted CSV accepted')
  await writeFile(imagesFile, 'WrongHeader,OtherHeader\nwrong,value\n')
  assert.notEqual(run('1').status, 0, 'Missing image columns accepted')
  checks.push('malformed CSV, missing source columns and unsupported image URLs rejected')
} finally {
  assert.ok(fixture.startsWith(path.join(root, 'artifacts') + path.sep))
  await rm(fixture, { recursive: true, force: true })
}
const report = { status: 'passed', createdAt: new Date().toISOString(), checks,
  scope: 'Local index fixture tests only; not download, independent human review, accuracy or speed evidence' }
await writeFile(path.join(root, 'artifacts/open-images-candidates-verification.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
