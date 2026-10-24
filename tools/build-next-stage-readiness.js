import { readFile, writeFile } from 'node:fs/promises'

const f6b = JSON.parse(await readFile('artifacts/f6b-power-condition.json', 'utf8'))
const f6bCloseout = JSON.parse(await readFile('artifacts/f6b-power-closeout.json', 'utf8'))
const f72 = JSON.parse(await readFile('artifacts/f7.2-human-trial-boundary-2026-10-13.json', 'utf8'))
const userTests = JSON.parse(await readFile('artifacts/t6.7-user-test-results.json', 'utf8'))
const p3 = JSON.parse(await readFile('artifacts/p3-production-integration-report.json', 'utf8'))

const report = {
  status: 'awaiting-external-input',
  createdAt: new Date().toISOString(),
  currentStage: 'F7.2 真人试用条件审查',
  completedSinceLastReview: [
    'P3 生产识别链路已完成并冻结',
    'F6b.1 统一功耗条件已重新确认，仍为 external-blocked',
    'F6b.2 功耗部分保持 external-blocked-closed，不重复不可比测量',
  ],
  p3Evidence: {
    status: p3.status,
    sampleCount: p3.regression.sampleCount,
    regressionErrors: p3.regression.errorCount,
    personMissRecoveredByCandidate: p3.regression.personMissRecoveredByCandidate,
  },
  power: {
    conditionStatus: f6b.status,
    closeoutStatus: f6bCloseout.status,
    wholeMachinePowerMeasured: f6bCloseout.wholeMachinePowerMeasured,
    unifiedEnergyMeasured: f6bCloseout.unifiedEnergyMeasured,
    nextAction: '如未来获得外部校准功率计或统一能量源，可另开独立测量任务；当前不继续尝试。',
  },
  humanTrial: {
    status: f72.status,
    requiredRounds: f72.requiredRounds,
    completedRounds: userTests.rounds,
    participantCount: f72.participantCount,
    requiredProtocol: 'docs/user-testing-t6.7.md',
    nextAction: '获得真实参与者后，按 A–E 完成 R1、R2、R3；每轮最多 20 分钟，R2 只复测阻塞问题，R3 独立验证。',
    minimumUserInput: [
      '至少一位真实参与者；若三轮为同一人，报告必须写“1 人 3 轮”。',
      '6–20 张公开授权或参与者明确同意在本机分析的照片；不上传、不提交私人原图。',
      '每轮记录原话、求助次数、A–E 完成状态、精选保留数、满意度和隐私信任。',
    ],
  },
  prohibitedClaims: [
    '不宣称真实相册准确率',
    '不宣称真人接受率或满意度',
    '不宣称四设备整机功耗排名',
    '不把自动化浏览器、演示视频或开发者自测代替真人试用',
  ],
  stopPoint: 'F7.2 外部阻塞保持；没有参与者和授权样本时停止，不新增第四轮、不扩展产品、不继续调模型。',
}

await writeFile('artifacts/next-stage-readiness-2026-10-15.json', JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ status: report.status, currentStage: report.currentStage, participantCount: report.humanTrial.participantCount, completedRounds: report.humanTrial.completedRounds.length, output: 'artifacts/next-stage-readiness-2026-10-15.json', stopPoint: report.stopPoint }, null, 2))
