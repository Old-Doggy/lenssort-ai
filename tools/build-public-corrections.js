import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const manifest = JSON.parse(await readFile(path.join(root, 'artifacts/open-images-download-manifest.json'), 'utf8'))
const review = JSON.parse(await readFile(path.join(root, 'artifacts/public-eval-review/manual-review.json'), 'utf8'))
const downloaded = manifest.records.filter(record => record.downloadStatus === 'downloaded')
const labels = new Map([
  [2, { category: '多人' }], [7, { category: '多人' }], [14, { category: '多人' }],
  [16, { category: '其他', realPersonPresent: false, note: '只有雕像' }],
  [17, { category: '其他', note: '只见手部，不能据此确定单人；不据局部推断整个人数' }],
  [25, { realPersonPresent: true, personCount: 1, note: '一辆车和一个人；不据此强定人物是否主体' }],
  [26, { category: '其他', realPersonPresent: false, note: '蛋糕上的人偶不是真人' }],
  ...[66, 67, 77, 80, 91, 92].map(number => [number, { category: '动物' }]),
  ...[70, 72, 88].map(number => [number, { category: '植物' }]),
  [85, { realPersonPresent: true }],
  ...Array.from({ length: 14 }, (_, index) => index + 93).map(number => [number,
    [96, 103].includes(number)
      ? { note: '用户将其排除于有人样本；103缩略图存在背景行人，需区分无人主体与无人，暂不强写人数真值', needsClarification: true }
      : { realPersonPresent: true }]),
])
const records = [...labels].sort(([left], [right]) => left - right).map(([number, expected]) => {
  const source = downloaded[number - 1]
  if (!source) throw new Error(`编号不存在：${number}`)
  const name = path.basename(source.localPath)
  const previous = review.records.find(record => record.name === name)
  if (!previous) throw new Error(`缺少实际预测：${name}`)
  return { number, name, sha256: source.sha256, localPath: source.localPath, sourceCandidate: source.candidateLabel,
    previousCategory: previous.predictedCategory, annotationSource: 'human-user-2026-10-22', expected }
})
const directory = path.join(root, 'artifacts/public-eval-review')
await mkdir(directory, { recursive: true })
await writeFile(path.join(directory, 'human-corrections-2026-10-22.json'), JSON.stringify({ version: 1, numbering: 'downloaded manifest order / sheet-01..06', notice: '局部人工纠错，非独立测试集；未知人数和主体不得补标', records }, null, 2), 'utf8')
console.log(JSON.stringify({ annotated: records.length, destination: directory }))
