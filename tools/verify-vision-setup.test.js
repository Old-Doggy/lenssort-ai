import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInstallerArgs, parseVisionModel, supportedVisionModels } from './setup-vision-model.js'

test('视觉模型安装器只接受项目支持的固定模型', () => {
  assert.deepEqual(Object.keys(supportedVisionModels), ['qwen3.5:4b', 'gemma3:4b', 'qwen3.5:9b'])
  assert.equal(parseVisionModel('QWEN3.5:4B'), 'qwen3.5:4b')
  assert.throws(() => parseVisionModel('unknown:latest'), /不支持的视觉模型/)
})

test('视觉模型安装器默认推荐4B并支持显式选择', () => {
  assert.deepEqual(parseInstallerArgs([]), { model: 'qwen3.5:4b', installOllama: false, keepService: false })
  assert.deepEqual(parseInstallerArgs(['--model=qwen3.5:9b', '--install-ollama', '--keep-service']), { model: 'qwen3.5:9b', installOllama: true, keepService: true })
})
