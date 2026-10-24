const categories = new Set(['单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认'])
import { getReliablePersonCount } from './folder-classification.js'

const numberOf = value => Number.isFinite(Number(value)) ? Number(value) : 0
const truth = value => value === true || value === 1 || value === 'true'

export function getVisionLanguageTrigger({ classification = {}, candidates = [], faces = {}, person = {}, scene = {} } = {}) {
  const mode = String(process.env.LENSSORT_VLM_MODE || 'precision').toLowerCase()
  if (mode === 'off') return { run: false, reason: '视觉复核已关闭' }
  if (mode !== 'uncertain') return { run: true, reason: '精度优先模式：进行全量视觉复核' }
  const topScore = numberOf(candidates[0]?.score)
  const personCandidate = person.status === 'succeeded' && numberOf(person.candidateCount) > 0 && numberOf(person.maxScore) >= 0.32
  if (classification.category === '待确认') return { run: true, reason: '快速分类结果为待确认' }
  if (numberOf(faces.faceCount) === 0 && personCandidate) return { run: true, reason: '检测到人物候选但没有稳定人脸证据' }
  if (scene.status === 'unavailable') return { run: true, reason: '场景辅助模型不可用' }
  if (classification.category === '其他' && topScore < 0.3) return { run: true, reason: '快速模型置信度过低' }
  return { run: false, reason: '快速模型和辅助信号已足够稳定' }
}

export function getVisionConflict({ classification = {}, vision = {}, faces = {}, person = {}, scene = {} } = {}) {
  if (!vision?.generated || vision.uncertain || vision.subjectFocus === 'uncertain') return '视觉模型输出不确定'
  const semantic = semanticCategory(vision)
  if (['illustration', 'screen', 'artwork'].includes(vision.mediaType) && vision.realPersonPresent) return '非照片媒介却标记真人主体'
  if (numberOf(vision.primaryPersonCount) > numberOf(vision.personCount)) return '主要人物数超过真人总数'
  if (vision.subjectFocus === 'person' && (!vision.realPersonPresent || Number(vision.personCount ?? 0) < 1)) return '人物主体但真人证据不足'
  if (vision.rawCategoryCandidate && vision.rawCategoryCandidate !== vision.categoryCandidate) return '模型原始类别与主体语义类别不一致'
  if (semantic && semantic !== vision.categoryCandidate) return '视觉模型类别与主体语义不一致'
  if (semantic && classification.category !== semantic) return '快速分类与视觉主体语义不一致'
  if (['person', 'environment_portrait'].includes(vision.subjectFocus) && vision.realPersonPresent && vision.personCount > 0 && Number(faces.faceCount ?? 0) > 0 && vision.personCount !== Number(faces.faceCount)) return '真人数量与人脸线索不一致'
  if (vision.subjectFocus === 'animal' && !vision.animalPresent) return '动物主体字段不完整'
  if (vision.subjectFocus === 'plant' && !vision.plantPresent) return '植物主体字段不完整'
  if (vision.subjectFocus === 'environment' && !vision.landscapePresent) return '环境主体字段不完整'
  if (vision.subjectFocus === 'environment_portrait' && (!vision.realPersonPresent || !vision.landscapePresent)) return '人物与环境主体字段不完整'
  if (scene.status === 'succeeded' && scene.candidates?.length && vision.subjectFocus === 'person' && Number(scene.candidates.find(item => /landscape|cityscape|building|night scene|sky/.test(item.label))?.score ?? 0) > 0.65 && !vision.landscapePresent) return '场景模型与环境字段冲突'
  if (person.status === 'succeeded' && Number(person.candidateCount ?? 0) > 0 && !vision.realPersonPresent && vision.subjectFocus === 'person') return '人物检测与真人字段冲突'
  return null
}

export function mergeVisionReviews(first, second) {
  if (!first) return second
  if (!second) return first
  const fields = ['categoryCandidate', 'mediaType', 'subjectFocus', 'primaryPersonCount']
  if (['person', 'environment_portrait'].includes(first.subjectFocus) || ['person', 'environment_portrait'].includes(second.subjectFocus)) fields.push('realPersonPresent', 'personCount')
  if (first.subjectFocus === 'animal' || second.subjectFocus === 'animal') fields.push('animalPresent')
  const conflict = fields.find(field => first[field] !== second[field])
  if (first.uncertain || second.uncertain) return { ...second, uncertain: true, reviewConflict: '至少一轮视觉复核不确定；未强行归类', explanation: '两轮视觉复核无法稳定确认主体，已保留待确认。' }
  return conflict ? { ...second, uncertain: true, reviewConflict: `两轮视觉复核的${conflict}不一致`, explanation: `两轮视觉复核对${conflict}的判断不一致，已保留待确认。` } : { ...second, reviewPassed: true, confidence: null }
}

export function applyVisionLanguageCategory(classification, vision, { faces = {}, person = {} } = {}) {
  const category = categories.has(vision?.categoryCandidate) ? vision.categoryCandidate : null
  if (vision?.generated === false || !category) return { classification, applied: false, reason: '视觉模型输出不可用或不确定' }
  if (vision?.reviewConflict || vision?.uncertain === true) {
    const faceCount = numberOf(faces.faceCount)
    const personCandidate = person.status === 'succeeded' && numberOf(person.candidateCount) > 0 && numberOf(person.maxScore) >= 0.85
    const technicalPerson = faceCount > 0 || personCandidate
    const technicalCategory = classification.category
    if (technicalPerson && ['单人', '多人', '人物与风景'].includes(technicalCategory)) return { classification: { ...classification, confidence: null, reason: `${classification.reason ?? '技术模型分类'}；视觉复核不确定，保留技术主体证据` }, applied: false, reason: '视觉模型不确定但技术人物证据稳定，保留技术分类' }
    return { classification: { ...classification, category: '待确认', confidence: null, reason: `${vision.reviewConflict ?? '视觉模型输出不确定'}；未强行归类`, explanation: '视觉证据暂不足以稳定判断主体或类别，已保留待确认；可打开原图人工修改分类。' }, applied: true, reason: '关键视觉证据冲突，转入人工确认' }
  }
  if (vision?.subjectFocus) {
    const semantic = semanticCategory(vision)
    if (!semantic || semantic === '待确认') return { classification: { ...classification, category: '待确认', confidence: null, explanation: '主体语义不完整，已保留待确认。' }, applied: true, reason: '主体语义不完整，保留待复核结果' }
    const reliablePersonCount = getReliablePersonCount(person)
    if (semantic === '单人' && reliablePersonCount >= 2) {
      if (classification.category === '多人') return { classification: { ...classification, confidence: null }, applied: false, reason: '可靠人体框支持多人，拒绝视觉单人结果覆盖技术分类' }
      return { classification: { ...classification, category: '待确认', confidence: null, reason: '视觉模型判断为单人，但多个独立人体框产生冲突，未强行归类' }, applied: true, reason: '视觉人数与可靠人体证据冲突，转入人工确认' }
    }
    if (semantic !== category) return { classification: { ...classification, category: semantic, confidence: null, reason: '按视觉模型确认的主要拍摄主体修正；雕像或艺术品不计入真人数量' }, applied: true, reason: '主体语义优先于检测框数量' }
    if (classification.category === category) return { classification: { ...classification, confidence: null }, applied: false, reason: '视觉模型与快速分类一致；不使用旧检测分数代表语义置信度' }
    return { classification: { ...classification, category, confidence: null, reason: '按主要拍摄主体进行视觉复核；检测框不等于真人，也不代表主体' }, applied: true, reason: '采用通过结构校验的主体语义；不代表校准概率' }
  }
  const faceCount = numberOf(faces.faceCount)
  const semanticCount = numberOf(vision.primaryPersonCount ?? vision.personCount)
  const personCandidate = person.status === 'succeeded' && numberOf(person.candidateCount) > 0 && numberOf(person.maxScore) >= 0.32
  const realPerson = truth(vision.realPersonPresent)
  const safeEnvironment = faceCount === 0 && !personCandidate && !realPerson
  const hasEnvironment = truth(vision.landscapePresent)
  const allowed = category === '动物'
    ? safeEnvironment && truth(vision.animalPresent)
    : category === '风景'
      ? safeEnvironment && truth(vision.landscapePresent)
      : category === '人物与风景'
      ? realPerson && hasEnvironment
        : (category === '单人' || category === '多人')
          ? realPerson && semanticCount > 0 && category === (semanticCount === 1 ? '单人' : '多人') && (faceCount > 0 || personCandidate)
          : false
  if (!allowed) return { classification, applied: false, reason: '视觉模型结果与检测信号冲突，保留快速分类' }
  if (classification.category === category) return { classification, applied: false, reason: '视觉模型与快速分类一致' }
  return { classification: { ...classification, category, confidence: null, reason: `${classification.reason ?? '快速分类'}；视觉模型复核为“${category}”` }, applied: true, reason: '视觉模型通过语义一致性检查；不代表校准概率' }
}
import { semanticCategory } from './vision-output.js'
