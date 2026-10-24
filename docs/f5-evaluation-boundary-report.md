# F5 评估与边界收口报告

日期：2026-10-11
状态：F5 已收口；公开样本评估完成，但仅为 AI 辅助代理评估，不构成独立真人真值验收。

## 1. 已完成范围

- 120 条公开候选中 106 张成功下载并完成本地视觉复核。
- 106 张照片全部写入六类项目标签目录，审核状态为 `106/106`。
- 复核方式为本地联系表上的 AI 辅助视觉复核，不是独立真人标注。
- 四个后端均完成 106/106 张推理，失败数为 0；NPU 产生 `npuVerified=true`。
- 已生成混淆矩阵、Accuracy、Macro-F1、Weighted-F1、各类 Precision/Recall 和错误样本列表。

## 2. 标签覆盖

| 类别 | 样本数 |
|---|---:|
| 单人 | 16 |
| 多人 | 18 |
| 人物与风景 | 25 |
| 风景 | 15 |
| 其他 | 32 |
| 待确认 | 0 |
| 合计 | 106 |

由于 `待确认` 类为 0 张，当前数据不能支持完整六类评估。该缺口已保留在机器报告的 `missingCategories` 字段中。

## 3. 代理评估结果

CPU、AMD Radeon 880M 核显、NVIDIA RTX 5070 Ti 独显和 AMD NPU 的当前输出指标均为：

- Accuracy：`0.2547`
- Macro-F1：`0.2413`
- Weighted-F1：`0.2899`
- 推理失败：`0/106`

四后端指标一致，只能说明当前规则和模型在四种后端上的输出一致；不能推导出真实相册泛化准确率，也不能代替独立真人真值。

## 4. F5 决策

- F5.1 预检：完成。
- F5.2 照片复核：完成，但标记为 AI 辅助复核。
- F5.3 标签评估：完成，状态为 partial / AI-assisted proxy evaluation。
- F5.4 收口：完成。
- 不修改当前分类模型、阈值或六类规则。
- 不因代理指标较低自动重开 F6c；F6c 原定两轮性能优化已经按停止规则关闭。
- 不把本报告中的 Accuracy、Macro-F1 或 Recall 写入简历作为“真实准确率”。

## 5. 证据

- `artifacts/f5-review-preflight.json`
- `artifacts/f5-assisted-review.json`
- `artifacts/open-images-human-review.json`
- `artifacts/folder-label-evaluation.json`
- `docs/performance-baseline-report.md`

## 6. 下一步与停止点

F5 已停止。下一步只进入 `F6b.1 统一功耗条件确认`：先判断是否具备四设备统一整机或统一能量测量条件。没有外部功率计或统一能量源时，记录为外部阻塞并停止该子任务，不重复使用不可比的系统传感器数据。
