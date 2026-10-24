const landscapeLabels = new Set(['alp', 'cliff, drop, drop-off', 'coral reef', 'geyser', 'lakeside, lakeshore', 'promontory, headland, head, foreland', 'seashore, coast, seacoast, sea-coast', 'valley, vale', 'volcano'])
const landscapeWords = ['beach', 'beacon', 'boathouse', 'breakwater', 'bridge', 'castle', 'coast', 'harbor', 'hill', 'island', 'lake', 'lighthouse', 'mountain', 'palace', 'pier', 'reef', 'river', 'seashore', 'shore', 'waterfall']
const personWords = ['ballplayer', 'bride', 'groom', 'man', 'person', 'portrait', 'scuba diver', 'woman']
const clipLandscapeLabels = new Set(['a natural landscape', 'a cityscape', 'a building or architectural scene', 'a night scene', 'a photo of the sky', 'a photo of clouds or sunset', 'a person in an environment'])
const clipAnimalLabels = new Set(['a photo of an animal', 'a photo of a bird', 'a photo of a dog or cat'])
const clipPlantLabels = new Set(['a close-up photo of flowers or plants', 'a photo of leaves or fruit on a plant'])
const clipPersonLabels = new Set(['a portrait of one person', 'a group photo', 'a person in an environment'])
const clipStatueLabels = new Set(['a photo of a statue or sculpture', 'a statue or sculpture next to a person'])

function labelMatches(label, words) {
  return words.some(word => label === word || label.startsWith(word + ',') || label.includes(word + ' '))
}

function strongestSignal(candidates, words, exactLabels = new Set()) {
  return candidates
    .filter(candidate => Number.isFinite(candidate?.score))
    .map(candidate => ({ label: candidate.label?.trim().toLowerCase() ?? '', score: candidate.score }))
    .filter(candidate => exactLabels.has(candidate.label) || labelMatches(candidate.label, words))
    .sort((left, right) => right.score - left.score)[0] ?? null
}

function boxIoU(left, right) {
  const x1 = Math.max(left.x, right.x)
  const y1 = Math.max(left.y, right.y)
  const x2 = Math.min(left.x + left.width, right.x + right.width)
  const y2 = Math.min(left.y + left.height, right.y + right.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

export function getReliablePersonCount(person = {}) {
  if (person.status !== 'succeeded') return null
  if (!Array.isArray(person.boxes)) return null
  const imageArea = Number(person.imageWidth) * Number(person.imageHeight)
  const candidates = person.boxes
    .map(box => ({
      ...box,
      score: Number(box?.score),
      x: Number(box?.x),
      y: Number(box?.y),
      width: Number(box?.width),
      height: Number(box?.height),
    }))
    .filter(box => {
      const areaRatio = Number(box.areaRatio) || (imageArea > 0 ? (box.width * box.height) / imageArea : 0)
      return Number.isFinite(box.score) && box.score >= 0.65 && Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0 && box.height > 0 && areaRatio >= 0.004
    })
    .sort((left, right) => right.score - left.score)
  const independent = []
  for (const candidate of candidates) {
    if (independent.every(existing => boxIoU(existing, candidate) < 0.45)) independent.push(candidate)
  }
  return independent.length
}

export function classifyFolderCategory(candidates, faces, auxiliary = {}) {
  const first = candidates[0]
  const confidence = Number.isFinite(first?.score) ? first.score : 0
  const label = first?.label?.trim().toLowerCase() ?? ''
  const semanticCandidates = Array.isArray(auxiliary.sceneCandidates) && auxiliary.sceneCandidates.length ? auxiliary.sceneCandidates : candidates
  const landscapeSignal = strongestSignal(semanticCandidates, landscapeWords, new Set([...landscapeLabels, ...clipLandscapeLabels]))
  const animalSignal = strongestSignal(semanticCandidates, [], clipAnimalLabels)
  const plantSignal = strongestSignal(semanticCandidates, [], clipPlantLabels)
  const personSignal = strongestSignal(semanticCandidates, personWords, clipPersonLabels)
  const statueSignal = strongestSignal(semanticCandidates, [], clipStatueLabels)
  const reliablePersonCount = getReliablePersonCount(auxiliary.person)
  const personEvidenceCount = reliablePersonCount ?? Number(auxiliary.person?.candidateCount ?? 0)
  const personCandidate = auxiliary.person?.status === 'succeeded' && Number(auxiliary.person.maxScore) >= 0.25 && personEvidenceCount > 0
  const landscape = landscapeSignal?.score >= 0.12
  if (!faces || !Number.isInteger(faces.faceCount) || faces.faceCount < 0) {
    return { category: '待确认', confidence, reason: '人脸状态未知，无法可靠区分人物与风景' }
  }
  if (faces.faceCount > 0) {
    const statueDominant = statueSignal?.score >= 0.2 && statueSignal.score >= (personSignal?.score ?? 0) * 0.9
    if (statueDominant && reliablePersonCount === 1) return { category: '单人', confidence: auxiliary.person.maxScore, sceneLabel: statueSignal.label, reason: '艺术品语义与人脸候选同时存在；一个独立人体框支持一位真人', explanation: '雕像或艺术品不计为真人；结合独立人体证据，画面按一位真人归类。' }
    if (statueDominant && reliablePersonCount >= 2) return { category: '多人', confidence: auxiliary.person.maxScore, sceneLabel: statueSignal.label, reason: '艺术品语义与人脸候选同时存在；多个独立人体框支持多人', explanation: '雕像或艺术品不计为真人；多个相互独立的人体证据支持画面存在多人。' }
    if (statueDominant) return { category: '待确认', confidence: null, sceneLabel: statueSignal.label, reason: '人脸候选与艺术品语义同时存在；候选框无法可靠区分真人和非真人', explanation: '人物与艺术品线索存在歧义，需要视觉语义复核；不按候选框数量猜测真人数量。' }
    const effectiveFaceCount = faces.faceCount
    const category = landscape ? '人物与风景' : effectiveFaceCount === 1 ? '单人' : '多人'
    const explanation = `画面存在 ${effectiveFaceCount} 个人脸候选${landscape ? '及环境线索' : ''}；基础识别暂按人物照片处理，候选数不等于已确认真人数。`
    return { category, confidence: faces.maxConfidence ?? null, sceneLabel: landscapeSignal?.label ?? null, reason: `检测到 ${faces.faceCount} 张人脸${landscape ? `，场景信号为“${landscapeSignal.label}”` : ''}；检测数不保证等于实际人数`, explanation }
  }
  if (personCandidate) {
    const strongPerson = Number(auxiliary.person.maxScore) >= 0.85
    const category = landscape ? '人物与风景' : reliablePersonCount >= 2 ? '多人' : reliablePersonCount === 1 || (reliablePersonCount === null && strongPerson) ? '单人' : '待确认'
    const evidenceText = reliablePersonCount === null ? `${auxiliary.person.candidateCount} 个候选框` : `${reliablePersonCount} 个相互独立的人体框`
    return { category, confidence: category === '待确认' ? null : auxiliary.person.maxScore, sceneLabel: landscapeSignal?.label ?? null, reason: `人物候选模型检测到 ${evidenceText}，但未检测到人脸${landscape ? `，场景信号为“${landscapeSignal.label}”` : ''}${category === '多人' ? '；多个独立人体证据支持多人' : strongPerson && category === '单人' ? '；单个人体候选置信度很高' : '；证据不足，保守保留人工确认'}`, explanation: category === '待确认' ? '画面疑似有人物，但人体框证据不足以可靠判断人数，已保留人工复核。' : '人物候选模型已确认主要画面存在人物；即使面部被遮挡、侧身或模糊，也不再因人脸漏检直接判为无人。' }
  }
  if (plantSignal?.score >= 0.18 && plantSignal.score >= (animalSignal?.score ?? 0) && plantSignal.score > (landscapeSignal?.score ?? 0)) {
    return { category: '植物', confidence: plantSignal.score, sceneLabel: plantSignal.label, reason: '植物主体语义强于环境背景', explanation: '画面以花朵、枝叶或植物特写为主，不将绿色背景等同于风景。' }
  }
  if (animalSignal?.score >= 0.18) {
    return { category: '动物', confidence: animalSignal.score, sceneLabel: animalSignal.label, reason: `场景模型识别为“${animalSignal.label}”`, explanation: '画面主体更接近动物或宠物，未发现明确真人面部。' }
  }
  if (personSignal?.score >= 0.18) {
    return { category: '待确认', confidence, reason: `模型出现人物信号“${personSignal.label}”，但未检测到人脸`, explanation: '画面可能包含人物，但面部或人物主体不够清晰，暂不强行归类。' }
  }
  if (landscape) {
    return { category: '风景', confidence: landscapeSignal.score, sceneLabel: landscapeSignal.label, reason: `未检测到人脸；场景模型识别为“${landscapeSignal.label}”`, explanation: '画面以自然、城市、建筑或天空等环境内容为主，未发现明确人物主体。' }
  }
  if (confidence >= 0.45) return { category: '其他', confidence, reason: `未检测到人脸；最高候选“${label}”不是人物或风景信号`, explanation: '画面内容明确，但暂时不属于人物、风景或动物等主要分类。' }
  return { category: '待确认', confidence, reason: '未检测到人脸，且前五候选不足以可靠区分场景', explanation: '画面信息不足以稳定判断类别，建议打开详情后人工确认。' }
}
