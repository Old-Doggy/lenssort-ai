const categories = ['单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认']
const focuses = ['person', 'environment_portrait', 'environment', 'animal', 'plant', 'object', 'artwork', 'uncertain']
const mediaTypes = ['photograph', 'illustration', 'screen', 'artwork', 'unknown']
export const visionSchema = {
  type: 'object', additionalProperties: false,
  required: ['category_candidate', 'summary', 'media_type', 'subject_focus', 'real_person_present', 'person_count', 'primary_person_count', 'landscape_present', 'statue_present', 'animal_present', 'plant_present', 'composition_comment', 'quality_comment', 'uncertain'],
  properties: {
    category_candidate: { type: 'string', enum: categories },
    summary: { type: 'string' },
    media_type: { type: 'string', enum: mediaTypes },
    subject_focus: { type: 'string', enum: focuses },
    real_person_present: { type: 'boolean' }, person_count: { type: 'integer', minimum: 0 }, primary_person_count: { type: 'integer', minimum: 0 },
    landscape_present: { type: 'boolean' }, statue_present: { type: 'boolean' }, animal_present: { type: 'boolean' },
    plant_present: { type: 'boolean' }, body_part_only: { type: 'boolean' },
    composition_comment: { type: 'string' }, quality_comment: { type: 'string' }, uncertain: { type: 'boolean' },
    subject_sharpness: { type: 'string', enum: ['clear', 'blurred', 'unknown'] },
    subject_box: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 0, maxItems: 4 },
  },
}
export const visionPrompt = [
  '你是谨慎的照片整理助手。直接看图，输出要求的JSON，描述看得见的事实。不猜地点、身份、故事、运动动作，不确定的细节不写。',
  'category_candidate只能是单人、多人、人物与风景、风景、动物、植物、其他、待确认。先判断拍摄主体subject_focus，而非只统计画面里有没有人。',
  'media_type必须先判断：photograph=真实相机照片；illustration=绘画、漫画、插画或印刷图；screen=屏幕/电视/投影中的画面；artwork=雕像、装置或艺术品；unknown=无法判断。插画、屏幕和艺术品中的人不算照片里的真人。',
  'subject_focus: person=以真人为主要主体（背景只作陪衬）；environment_portrait=真人与大范围环境都是有意拍摄的主角；environment=天空、自然、建筑、城市、夜景等广角环境；animal=以动物为主；plant=以花朵、枝叶、果实或单株植物为主；object=物件/交通工具/食物等；artwork=艺术品本身；uncertain=不确定。花草特写归植物，不因绿色背景归风景。',
  '风景照可有微小游客；不能因为有人就归人物与风景。确定以人为主体后，单人/多人按画面中可确认的真人总数person_count区分，背景中可辨识的真人也计数，而非只数主角。雕像、照片、屏幕、插画中的人不算真人；真人可与雕像同时出现。只拍雕像归其他，人与雕像合影按真人数量判断。',
  '以动物为主体时，即使有饲养者局部也属于动物；飞机、物品、广告不是因为背景有天空就属于风景。',
  '局部人体不等于一个可计数的人：若只有手部、脚部而无可辨识的人物主体，body_part_only=true，primary_person_count=0，按实际主物件分类；不要猜单人或多人。若可见头部或躯干则不属于只有局部。雕像、玩偶、蛋糕公仔和印刷人物一律不计真人。',
  '有墙面、草地、汽车不代表人物与风景；多人活动与合影按可确认的真人数量，不把普通背景当共同主体。plant_present与animal_present必须如实填写布尔值；花、枝叶、果实或单株植物为主体时plant_present=true，不用环境背景替代主要主体。',
  '口罩、墨镜、帽子或面部遮挡不等于没有真人；只要能看到真人头部、躯干或人体姿态，应结合人体和场景证据判断，不因脸部局部被遮挡直接判为无人。',
  'person_count只计可确认的真人总数，数不清背景路人时填可确认的数量；primary_person_count只计主要拍摄真人，不能大于总数。只有无法确定拍摄主体或主要人物数时才uncertain=true，无法数清背景路人不影响已明确的主体分类。',
  'summary一句中文，只描述主要可见内容。composition_comment简短评价布局、主体位置、层次与裁切；quality_comment简短评价美感/光线，不用曝光明暗直接否决夜景，不编造评分。',
].join('\n')

export const visionReviewSchema = visionSchema
export const visionReviewPrompt = [
  '你是第二位谨慎的照片整理审核员。独立重新观察整张照片，只输出要求的JSON，不参考任何上一轮判断。',
  '重点核对：媒介类型是什么；拍摄主体是什么；主要主体中的真人有几位；雕像、海报、屏幕、插画和倒影不算真人；动物、天空、建筑、城市夜景和自然环境是否是主要主体。',
  '独立核对主体类别。若确实无法区分真人/艺术品或确定主体才uncertain=true，不要为了给出类别猜测。',
  ...visionPrompt.split('\n').slice(1),
].join('\n')

export function normalizeVision(content) {
  const value = typeof content === 'string' ? JSON.parse(content) : content
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('视觉输出不是对象')
  for (const key of visionSchema.required) {
    const field = value[key]
    const definition = visionSchema.properties[key]
    const valid = definition.type === 'integer' ? Number.isSafeInteger(field) && field >= 0 : typeof field === definition.type
    if (!valid || (definition.enum && !definition.enum.includes(field))) throw new Error('视觉字段无效：' + key)
  }
  if (value.primary_person_count > value.person_count) throw new Error('主体人数不能超过真人总数')
  if (!value.real_person_present && (value.person_count > 0 || value.primary_person_count > 0)) throw new Error('真人字段与人数不一致')
  if (value.body_part_only === true && value.primary_person_count > 0) throw new Error('局部人体不能推断主要人物数量')
  if (value.subject_focus === 'plant' && value.plant_present !== true) throw new Error('植物主体缺少植物证据')
  if (['illustration', 'screen', 'artwork'].includes(value.media_type) && value.real_person_present) throw new Error('非照片媒介不能标记真人主体')
  if (!value.summary.trim()) throw new Error('视觉摘要为空')
  if (value.subject_sharpness !== undefined && !['clear', 'blurred', 'unknown'].includes(value.subject_sharpness)) throw new Error('视觉主体清晰度字段无效')
  let subjectBox = null
  if (Array.isArray(value.subject_box) && value.subject_box.length === 4) {
    const [x, y, width, height] = value.subject_box
    if ([x, y, width, height].every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1) && width > 0 && height > 0 && x + width <= 1.001 && y + height <= 1.001) subjectBox = [x, y, width, height]
  }
  return {
    summary: value.summary.trim().slice(0, 500), categoryCandidate: value.category_candidate,
    mediaType: value.media_type, subjectFocus: value.subject_focus, realPersonPresent: value.real_person_present, personCount: value.person_count, primaryPersonCount: value.primary_person_count,
    landscapePresent: value.landscape_present, statuePresent: value.statue_present, animalPresent: value.animal_present,
    plantPresent: value.plant_present === true, bodyPartOnly: value.body_part_only === true,
    compositionComment: value.composition_comment.trim().slice(0, 240), qualityComment: value.quality_comment.trim().slice(0, 240),
    subjectSharpness: value.subject_sharpness ?? 'unknown',
    subjectBox,
    uncertain: value.uncertain, confidence: null, subjects: [], scene: '', recommendation: '待确认', cautions: [],
  }
}

export function semanticCategory(vision) {
  if (vision.uncertain || vision.subjectFocus === 'uncertain') return '待确认'
  if (['illustration', 'screen', 'artwork'].includes(vision.mediaType)) return '其他'
  if (vision.subjectFocus === 'environment' && vision.landscapePresent) return '风景'
  if (vision.subjectFocus === 'animal' && vision.animalPresent) return '动物'
  if (vision.subjectFocus === 'plant' && vision.plantPresent) return '植物'
  if (['object', 'artwork'].includes(vision.subjectFocus)) return '其他'
  if (!vision.realPersonPresent || vision.personCount < 1) return null
  if (vision.subjectFocus === 'environment_portrait' && vision.landscapePresent) return '人物与风景'
  if (vision.subjectFocus === 'person') return vision.personCount === 1 ? '单人' : vision.personCount > 1 ? '多人' : null
  return null
}
