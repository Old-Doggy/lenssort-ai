import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseSafeModel, modelProfiles } from './model-resource-policy.js'

const installed = ['qwen3.5:9b', 'qwen3.5:4b', 'gemma3:4b']
const resources = { freeRamGiB: 20, freeVramGiB: 10 }
test('默认自动不选择9B；明确选择且资源充足才运行9B', () => {
  assert.equal(chooseSafeModel({ requested: 'auto', installed, resources }).selected, 'qwen3.5:4b')
  assert.equal(chooseSafeModel({ requested: 'qwen3.5:9b', installed, resources }).selected, 'qwen3.5:9b')
})
test('基础模式不加载大模型；未知或低配资源保守回退', () => {
  assert.equal(chooseSafeModel({ requested: 'off', installed, resources }).selected, 'off')
  assert.equal(chooseSafeModel({ installed }).selected, 'off')
  assert.equal(chooseSafeModel({ installed, resources: { freeRamGiB: 4, freeVramGiB: 10 } }).selected, 'off')
})
test('安装状态和实时空闲决定回退，不看总显存', () => {
  assert.equal(chooseSafeModel({ requested: 'qwen3.5:9b', installed, resources: { freeRamGiB: 12, freeVramGiB: 7 } }).selected, 'qwen3.5:4b')
  assert.equal(chooseSafeModel({ installed: ['gemma3:4b'], resources }).selected, 'gemma3:4b')
  assert.equal(chooseSafeModel({ installed: ['qwen3.5:9b'], resources }).selected, 'off')
})
test('已驻留模型显存不重复计算，但空闲安全余量仍须保留', () => {
  const resident = [{ name: 'qwen3.5:4b', size_vram: 3 * 1024 ** 3 }]
  assert.equal(chooseSafeModel({ installed, resident, resources: { freeRamGiB: 12, freeVramGiB: 3.5 } }).selected, 'qwen3.5:4b')
  assert.equal(chooseSafeModel({ installed, resident, resources: { freeRamGiB: 12, freeVramGiB: 0.4 } }).selected, 'off')
})
test('用户明确强制时保留已安装的高级模型，不自动降级', () => {
  const result = chooseSafeModel({ requested: 'qwen3.5:9b', installed, resources: { freeRamGiB: 6, freeVramGiB: 4 }, force: true })
  assert.equal(result.selected, 'qwen3.5:9b')
  assert.equal(result.forced, true)
  assert.equal(result.fallback, false)
})

test('only the measured 9B digest receives the calibrated headroom budget', () => {
  const installedDetails = [{ name: 'qwen3.5:9b', digest: '56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90' }]
  const available = { freeRamGiB: 16, freeVramGiB: 7.7 }
  assert.equal(chooseSafeModel({ requested: 'qwen3.5:9b', installed, installedDetails, resources: available }).selected, 'qwen3.5:9b')
  assert.equal(modelProfiles(installedDetails).find(item => item.id === 'qwen3.5:9b').minVramGiB, 7.5)
  assert.equal(chooseSafeModel({ requested: 'qwen3.5:9b', installed, resources: available }).selected, 'qwen3.5:4b')
  assert.equal(chooseSafeModel({ requested: 'qwen3.5:9b', installed, installedDetails: [{ name: 'qwen3.5:9b', digest: 'changed-model' }], resources: available }).selected, 'qwen3.5:4b')
  assert.equal(chooseSafeModel({ requested: 'qwen3.5:9b', installed, installedDetails, resources: { ...available, freeVramGiB: 7 } }).selected, 'qwen3.5:4b')
  assert.equal(chooseSafeModel({ requested: 'auto', installed, installedDetails, resources: available }).selected, 'qwen3.5:4b')
})

test('resident GPU weights do not reserve cold-load VRAM again; runtime floor remains', () => {
  const resident = [{ name: 'qwen3.5:9b', size: 5606337412, size_vram: 5606337412 }]
  assert.equal(chooseSafeModel({ requested: 'qwen3.5:9b', installed, resident, resources: { freeRamGiB: 14, freeVramGiB: 1.2 } }).selected, 'qwen3.5:9b')
  assert.notEqual(chooseSafeModel({ requested: 'qwen3.5:9b', installed, resident, resources: { freeRamGiB: 14, freeVramGiB: 0.6 } }).selected, 'qwen3.5:9b')
})
