import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const artifacts = path.join(root, 'artifacts')
const outputJson = path.join(artifacts, 'p2-model-selection-report.json')
const outputMarkdown = path.join(root, 'docs', 'p2-model-selection-report.md')

const readJson = async name => JSON.parse(await readFile(path.join(artifacts, name), 'utf8'))
const [samples, persons, scenes, aesthetic, comparison] = await Promise.all([
  readJson('p1-failure-samples.json'),
  readJson('p2-yolox-tiny-baseline.json'),
  readJson('p2-clip-scene-baseline.json'),
  readJson('p2-aesthetic-baseline.json'),
  readJson('p2-person-candidate-comparison.json'),
])

const riskSamples = samples.samples.filter(sample => sample.tags?.length > 0)
const personMissSamples = samples.samples.filter(sample => sample.tags?.includes('person-missed'))
const sceneRiskSamples = samples.samples.filter(sample => sample.tags?.includes('scene-missed'))
const duplicateRiskSamples = samples.samples.filter(sample => sample.tags?.includes('duplicate-risk'))
const personResults = new Map(persons.results.map(item => [item.name, item]))
const sceneResults = new Map(scenes.results.map(item => [item.name, item]))

const report = {
  status: 'completed-with-boundaries',
  phase: 'P2.2',
  createdAt: new Date().toISOString(),
  sampleEvidence: {
    sampleCount: samples.sampleCount,
    taggedRiskCount: riskSamples.length,
    personMissRiskCount: personMissSamples.length,
    sceneRiskCount: sceneRiskSamples.length,
    duplicateRiskCount: duplicateRiskSamples.length,
    independentHumanLabels: samples.independentHumanLabels,
  },
  candidateEvidence: {
    personDetection: {
      selected: 'YOLOX Tiny',
      averageDurationMs: persons.averageDurationMs,
      threshold025CandidateCount: persons.thresholdDetectionCounts['0.25'],
      candidateCount: persons.personCandidateCount,
      comparison: comparison.candidates,
      reason: '在同一 41 张样本上比 Nano 多检出 5 张候选人物图，速度仍处于可接受范围；S 更慢且没有额外收益。',
      guardrails: ['必须结合人物框面积和置信度', '不能把检测框数量当作人数', '必须保留场景和人脸辅助信号'],
    },
    sceneSemantics: {
      selected: 'CLIP ViT-B/32 zero-shot scene signal',
      averageDurationMs: scenes.averageDurationMs,
      loadDurationMs: scenes.loadDurationMs,
      successCount: scenes.processedCount - scenes.errorCount,
      use: '仅作为风景/建筑/城市/夜景/人物环境的辅助语义，不作为人物存在真值。',
    },
    aesthetic: {
      selected: 'LAION aesthetic predictor V1 linear head on CLIP ViT-B/32 image embedding',
      averageDurationMs: aesthetic.averageDurationMs,
      loadDurationMs: aesthetic.loadDurationMs,
      successCount: aesthetic.successCount,
      use: '作为精选候选排序信号，与技术质量、主体证据、重复风险组合；不直接宣称“好看”。',
      combinedWeights: aesthetic.normalization.combinedWeights,
    },
  },
  selectedProductionCombination: {
    person: 'YOLOX Tiny',
    face: 'MediaPipe Blaze Face/Face Landmarker 作为人脸与主体辅助',
    scene: 'CLIP ViT-B/32',
    aesthetic: 'LAION aesthetic V1 linear head',
    technicalQuality: '现有清晰度、曝光和质量风险分析',
    duplicateHandling: '现有视觉指纹与相似组规则',
    decision: 'P2 只完成候选定案；下一阶段 P3 才将组合接入生产识别链路，并通过回归样本验证。',
  },
  p3AcceptanceGates: [
    '先建立统一中间结果：人物候选、人脸、人景语义、审美分、技术质量、重复组和证据来源。',
    '人物分类采用证据门控：YOLOX 发现人物但人脸为空时不得直接判无人；低置信度保留待确认。',
    '精选排序先去重，再按审美与技术质量排序，并保留人工删除/移出精选的入口。',
    '不将 41 张样本当独立真值；P3 仅报告前后回归变化和失败样本覆盖。',
    '必须保留 CPU 可运行路径；设备不可用时自动降级，不把 NPU 或 GPU 写死。',
  ],
  boundaries: [
    '当前 41 张样本来自用户照片和工程筛选，缺少独立人工金标准。',
    '模型基线均为 Node CPU 隔离实验，不能替代生产 GPU/NPU 性能验收。',
    'YOLOX、CLIP 和 LAION 输出是候选信号，不代表真实召回率、准确率或用户满意度。',
    '本报告不修改生产主链路、不改变网页入口、不删除原图。',
  ],
}

const personMissEvidence = personMissSamples.map(sample => ({
  name: sample.name,
  yoloXMaxPersonScore: personResults.get(sample.name)?.maxPersonScore ?? null,
  clipTopLabel: sceneResults.get(sample.name)?.topLabel ?? null,
  clipTopScore: sceneResults.get(sample.name)?.topScore ?? null,
  tags: sample.tags,
}))
report.personMissEvidence = personMissEvidence

const markdown = `# P2 模型选择报告\n\n- 状态：${report.status}\n- 样本：${report.sampleEvidence.sampleCount} 张；带风险标签 ${report.sampleEvidence.taggedRiskCount} 张\n- 范围：人物检测、场景语义、审美排序候选的隔离基线，不修改生产主链路。\n\n## 定案组合\n\n| 能力 | 选择 | 用法 |\n|---|---|---|\n| 人物候选 | YOLOX Tiny | 发现人物候选；与框面积、置信度、人脸和场景联合门控 |\n| 人脸辅助 | MediaPipe Blaze Face/Face Landmarker | 人脸数量、主体证据和后续人像辅助 |\n| 场景语义 | CLIP ViT-B/32 | 风景、建筑、城市、夜景、人物环境辅助语义 |\n| 审美候选 | LAION aesthetic V1 线性头 | 精选排序信号，不直接等同“好看” |\n| 技术质量 | 现有清晰度/曝光分析 | 排除明显技术风险 |\n| 重复处理 | 现有视觉指纹 | 连拍/相似图先去重 |\n\n## 基线证据\n\n- YOLOX Tiny：平均 ${report.candidateEvidence.personDetection.averageDurationMs}ms/张；0.25 阈值下 ${report.candidateEvidence.personDetection.threshold025CandidateCount} 张出现人物候选。\n- CLIP 场景：${report.candidateEvidence.sceneSemantics.successCount}/${scenes.sampleCount} 张成功；平均 ${report.candidateEvidence.sceneSemantics.averageDurationMs}ms/张。\n- LAION 审美：${report.candidateEvidence.aesthetic.successCount}/${aesthetic.sampleCount} 张成功；平均 ${report.candidateEvidence.aesthetic.averageDurationMs}ms/张。\n- 三张“人物漏脸”风险图由 YOLOX Tiny 给出高置信人物候选，说明不能再用“人脸数量为 0”直接判定无人。\n\n## P3 门槛\n\n${report.p3AcceptanceGates.map(item => `- ${item}`).join('\\n')}\n\n## 边界\n\n${report.boundaries.map(item => `- ${item}`).join('\\n')}\n\n机器证据：` + '`artifacts/p2-model-selection-report.json`、`artifacts/p2-yolox-tiny-baseline.json`、`artifacts/p2-clip-scene-baseline.json`、`artifacts/p2-aesthetic-baseline.json`。\n'

await writeFile(outputJson, JSON.stringify(report, null, 2), 'utf8')
await writeFile(outputMarkdown, markdown, 'utf8')
console.log(JSON.stringify({ status: report.status, outputJson: 'artifacts/p2-model-selection-report.json', outputMarkdown: 'docs/p2-model-selection-report.md', selected: report.selectedProductionCombination }, null, 2))
