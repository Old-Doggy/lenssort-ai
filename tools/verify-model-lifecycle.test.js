import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { createVisionLanguageExplainer } from './vision-language-explainer.js'

const model = 'qwen3.5:4b'
const content = JSON.stringify({ category_candidate: '风景', summary: '天空与树木。', media_type: 'photograph', subject_focus: 'environment', real_person_present: false, person_count: 0, primary_person_count: 0, landscape_present: true, statue_present: false, animal_present: false, plant_present: false, composition_comment: '层次清楚。', quality_comment: '光线自然。', uncertain: false })
const resource = { freeRamGiB: 20, freeVramGiB: 10 }
const photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#aabbcc' } }).jpeg().toBuffer()
function fixture({ existing = false, partial = false, fail9b = false, invalidResponses = 0 } = {}) {
  let resident = existing ? [{ name: model, digest: 'owned-by-user', size: 3e9, size_vram: 3e9 }] : []
  const calls = []
  let available = { ...resource }
  const request = async (route, init = {}, timeout) => {
    const payload = init.body ? JSON.parse(init.body) : null
    calls.push({ route, payload, timeout })
    if (route === '/api/tags') return { models: [model, 'qwen3.5:9b'].map(name => ({ name })) }
    if (route === '/api/ps') return { models: resident }
    if (route === '/api/generate') {
      resident = payload.keep_alive === 0 ? [] : [{ name: payload.model, digest: 'test-' + payload.model, size: 3e9, size_vram: partial ? 1e9 : 3e9 }]
      return { done: true, load_duration: 1000000 }
    }
    if (route === '/api/chat') {
      resident = [{ name: payload.model, digest: 'test-' + payload.model, size: 3e9, size_vram: partial ? 1e9 : 3e9 }]
      if (payload.model === 'qwen3.5:9b' && fail9b) throw new Error('out of memory')
      const responseContent = invalidResponses-- > 0 ? content.replace('"person_count":0', '"person_count":1') : content
      return { message: { content: responseContent }, done_reason: 'stop' }
    }
    throw new Error('Unexpected route ' + route)
  }
  return { calls, request, resources: async () => available, lowMemory: () => { available = { freeRamGiB: 1, freeVramGiB: 10 } }, residentMemory: () => { available = { freeRamGiB: 6, freeVramGiB: 5 } } }
}

test('基础模式不访问Ollama，不加载任何大模型', async () => {
  const setup = fixture()
  const explainer = await createVisionLanguageExplainer({ ...setup, model: 'off' })
  await explainer.close()
  assert.equal(setup.calls.length, 0)
})
test('冷启动预加载与图片推理使用独立时限并报告阶段', async () => {
  const setup = fixture()
  const stages = []
  const explainer = await createVisionLanguageExplainer({ ...setup, model, onProgress: event => stages.push(event.phase) })
  try {
    await explainer.explain(photo)
    const preload = setup.calls.find(call => call.route === '/api/generate' && call.payload.keep_alive !== 0)
    assert.ok(preload)
    assert.equal(preload.timeout, 120000)
    assert.equal(setup.calls.find(call => call.route === '/api/chat').timeout, 45000)
    assert.ok(stages.includes('loading-model'))
  } finally { await explainer.close() }
})
test('单张推理超时不关闭后续视觉复核且不换模型', async () => {
  const setup = fixture({ existing: true })
  let first = true
  const request = async (...args) => {
    if (args[0] === '/api/chat' && first) { first = false; throw Object.assign(new Error('request timeout'), { name: 'TimeoutError' }) }
    return setup.request(...args)
  }
  const explainer = await createVisionLanguageExplainer({ ...setup, request, model })
  try {
    await assert.rejects(explainer.explain(photo), { code: 'LENSSORT_VISION_PHOTO_FAILED' })
    assert.equal(explainer.status.status, 'ready')
    assert.equal((await explainer.explain(photo)).model, model)
  } finally { await explainer.close() }
})
test('单图JSON矛盾只做一次修复复核，不停用后续整批模型', async () => {
  const setup = fixture({ invalidResponses: 1 })
  const explainer = await createVisionLanguageExplainer({ ...setup, model })
  try {
    const result = await explainer.explain(photo)
    assert.equal(result.generated, true)
    assert.equal(result.outputRepairCalls, 1)
    assert.equal((await explainer.explain(photo)).generated, true)
    assert.equal(setup.calls.filter(call => call.route === '/api/chat').length, 3)
  } finally { await explainer.close() }
})
test('单图两次无效后明确报错，下一张仍继续视觉复核', async () => {
  const setup = fixture({ invalidResponses: 2 })
  const explainer = await createVisionLanguageExplainer({ ...setup, model })
  try {
    await assert.rejects(explainer.explain(photo), error => error.code === 'LENSSORT_VISION_OUTPUT_INVALID')
    assert.equal(explainer.status.status, 'ready')
    assert.equal((await explainer.explain(photo)).generated, true)
    assert.equal(setup.calls.filter(call => call.route === '/api/chat').length, 3)
  } finally { await explainer.close() }
})
test('本批模型串行请求、短驻留，结束主动卸载', async () => {
  const setup = fixture()
  const explainer = await createVisionLanguageExplainer({ ...setup, model })
  try {
    const result = await explainer.explain(photo)
    assert.equal(result.generated, true)
    const chat = setup.calls.find(call => call.route === '/api/chat').payload
    assert.equal(chat.keep_alive, '30s')
    assert.equal(chat.options.num_ctx, 4096)
  } finally { await explainer.close() }
  assert.equal(setup.calls.filter(call => call.route === '/api/generate' && call.payload.keep_alive === 0).length, 1)
})
test('用户原先驻留模型不主动卸载，也不设置短驻留', async () => {
  const setup = fixture({ existing: true })
  const explainer = await createVisionLanguageExplainer({ ...setup, model })
  try { await explainer.explain(photo) } finally { await explainer.close() }
  assert.equal(setup.calls.find(call => call.route === '/api/chat').payload.keep_alive, undefined)
  assert.equal(setup.calls.some(call => call.route === '/api/generate'), false)
})
test('运行前资源下降时不发推理请求，明确进入基础模式', async () => {
  const setup = fixture()
  const explainer = await createVisionLanguageExplainer({ ...setup, model })
  setup.lowMemory()
  try {
    await assert.rejects(explainer.explain(photo), /保护性停用/)
    assert.equal(setup.calls.some(call => call.route === '/api/chat'), false)
    assert.equal(explainer.status.status, 'disabled')
  } finally { await explainer.close() }
})
test('9B内存错误只降级重试一次，先释放再加载4B', async () => {
  const setup = fixture({ fail9b: true })
  const explainer = await createVisionLanguageExplainer({ ...setup, model: 'qwen3.5:9b' })
  try {
    assert.equal((await explainer.explain(photo)).model, model)
    const operations = setup.calls.filter(call => call.route === '/api/chat' || call.route === '/api/generate' && call.payload.keep_alive === 0)
    assert.deepEqual(operations.map(call => [call.route, call.payload.model]), [['/api/chat', 'qwen3.5:9b'], ['/api/generate', 'qwen3.5:9b'], ['/api/chat', model]])
  } finally { await explainer.close() }
})

test('已完整驻留GPU的模型不重复索取首次加载的系统内存余量', async () => {
  const setup = fixture()
  const explainer = await createVisionLanguageExplainer({ ...setup, model })
  try {
    await explainer.explain(photo)
    setup.residentMemory()
    assert.equal((await explainer.explain(photo)).generated, true)
    assert.equal(explainer.status.fallback, false)
  } finally { await explainer.close() }
})

test('已驻留模型仍保留最低系统空闲内存保护', async () => {
  const setup = fixture()
  const explainer = await createVisionLanguageExplainer({ ...setup, model })
  try {
    await explainer.explain(photo)
    setup.lowMemory()
    await assert.rejects(explainer.explain(photo), /保护性停用/)
    assert.equal(setup.calls.filter(call => call.route === '/api/chat').length, 1)
  } finally { await explainer.close() }
})
test('部分GPU卸载到系统内存也应触发保护，不能假称全GPU安全', async () => {
  const setup = fixture({ partial: true })
  const explainer = await createVisionLanguageExplainer({ ...setup, model })
  try {
    await assert.rejects(explainer.explain(photo), /保护性停用/)
    assert.equal(explainer.status.status, 'disabled')
  } finally { await explainer.close() }
})

test('强制9B失败时明确失败，不改用4B或基础分析', async () => {
  const setup = fixture({ fail9b: true })
  const explainer = await createVisionLanguageExplainer({ ...setup, model: 'qwen3.5:9b', force: true })
  try {
    await assert.rejects(explainer.explain(photo), { code: 'LENSSORT_FORCED_MODEL_FAILED' })
    assert.deepEqual(setup.calls.filter(call => call.route === '/api/chat').map(call => call.payload.model), ['qwen3.5:9b'])
    assert.equal(explainer.status.fallback, false)
    assert.equal(explainer.status.status, 'failed')
  } finally { await explainer.close() }
})

test('强制模式服务不可用时初始化失败，不转基础分析', async () => {
  await assert.rejects(createVisionLanguageExplainer({ model, force: true, request: async () => { throw new Error('服务未连接') }, resources: async () => resource }), /强制模型初始化失败/)
})

test('强制模式允许同一模型混合卸载并如实显示设备', async () => {
  const setup = fixture({ partial: true })
  const explainer = await createVisionLanguageExplainer({ ...setup, model, force: true })
  try {
    assert.equal((await explainer.explain(photo)).model, model)
    assert.equal(explainer.status.fullyGpuResident, false)
    assert.match(explainer.status.device, /混合/)
  } finally { await explainer.close() }
})

test('强制并发申请失败不会释放另一任务的模型预约', async () => {
  const first = await createVisionLanguageExplainer({ ...fixture(), model })
  try {
    await assert.rejects(createVisionLanguageExplainer({ ...fixture(), model, force: true }), /已有视觉模型任务/)
    const third = await createVisionLanguageExplainer({ ...fixture(), model })
    try { assert.equal(third.status.status, 'disabled') } finally { await third.close() }
    assert.equal((await first.explain(photo)).generated, true)
  } finally { await first.close() }
  const next = await createVisionLanguageExplainer({ ...fixture(), model, force: true })
  try { assert.equal(next.status.status, 'ready') } finally { await next.close() }
})

test('冲突复核使用独立提示和更大全图输入，不灌输旧结论', async () => {
  const setup = fixture()
  const image = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#aabbcc' } }).jpeg().toBuffer()
  const explainer = await createVisionLanguageExplainer({ ...setup, model })
  try {
    await explainer.explain(image)
    await explainer.explain(image, { review: true })
    const chats = setup.calls.filter(call => call.route === '/api/chat').map(call => call.payload)
    assert.equal(chats.length, 2)
    assert.notEqual(chats[0].messages[0].content, chats[1].messages[0].content)
    assert.doesNotMatch(chats[1].messages[0].content, /上一轮结果是|快速分类：/)
    assert.equal((await sharp(Buffer.from(chats[0].messages[0].images[0], 'base64')).metadata()).width, 1152)
    assert.equal((await sharp(Buffer.from(chats[1].messages[0].images[0], 'base64')).metadata()).width, 1536)
  } finally { await explainer.close() }
})
