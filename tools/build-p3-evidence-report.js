import { readFile, writeFile } from 'node:fs/promises'

const regression = JSON.parse(await readFile('artifacts/p3-failure-regression.json', 'utf8'))
const report = {
  status: 'completed-with-boundaries',
  phase: 'P3',
  createdAt: new Date().toISOString(),
  completedSlices: [
    '统一 modelEvidence v1 已接入生产分析结果，旧字段兼容保留',
    'YOLOX Tiny 人物候选已接入，不能读取时显式 unavailable 并保留旧链路',
    'CLIP 场景语义按需调用，避免所有照片承担额外推理成本',
    '人物门控：人脸为空但人物候选明显时不再直接归为无人，保守进入待确认或人物与风景',
    '一键挑好看按需加载 LAION 审美候选分，与技术质量、主体证据和视觉去重共同排序',
  ],
  regression: {
    sampleCount: regression.sampleCount,
    errorCount: regression.errorCount,
    personMissRiskCount: regression.personMissRiskCount,
    personMissRecoveredByCandidate: regression.personMissRecoveredByCandidate,
    categoryCounts: regression.categoryCounts,
    averageDurationMs: regression.averageDurationMs,
  },
  verification: [
    'npm run verify:model-evidence',
    'npm run verify:folder-classification',
    'node tools/verify-photo-curator.js',
    'npm run verify:control',
    'npm run verify:quick-actions',
    'npm run verify:p3-failure-regression',
    'npm run build',
  ],
  boundaries: [
    '41 张失败样本不是独立人工金标准，不能宣称真实准确率。',
    'YOLOX 与 CLIP 辅助模型当前按 CPU 运行；主 MobileNet/NPU 证据仍按原设备链路记录。',
    'LAION 分数是审美候选信号，不等于用户主观“好看”。',
    '未修改开机启动、未删除原图、未新增首页复杂入口。',
  ],
  stopPoint: 'P3.1/P3.2 已完成；停止继续无限调阈值。下一阶段只有在用户提供新的可复现错误或人工标注证据时，才进入 P4 有限校准；否则保持当前版本。',
}
await writeFile('artifacts/p3-production-integration-report.json', JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ status: report.status, phase: report.phase, sampleCount: report.regression.sampleCount, errorCount: report.regression.errorCount, output: 'artifacts/p3-production-integration-report.json', stopPoint: report.stopPoint }, null, 2))
