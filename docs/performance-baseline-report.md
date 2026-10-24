# LensSort AI 性能基线与停止报告

日期：2026-10-10
状态：两轮有限优化完成，保留原始串行基线并停止继续试错

## 数据边界

- Open Images 验证集索引已保存到 `data/eval/public-indexes/`。
- 自动生成 120 条候选，有限下载成功 106 张唯一图片，14 条源地址返回 404/410 或尺寸不足。
- 候选记录保留来源页面、媒体地址、许可证、原始标签、人框数量、SHA-256 和本地路径。
- 106 张仍是需要人工审核的索引辅助候选，不是项目六类人工真值；本报告不填写 accuracy、macro-F1 或 recall。

## 基线

基线和候选使用同一批 20 张已下载图片、同一顺序、同一机器、同一模型与人脸输入设置。完整四设备基线见 `artifacts/folder-performance-baseline.json`。

主要 p50 单图耗时：CPU `72.37 ms`、核显 `72.22 ms`、独显 `71.69 ms`、NPU `82.35 ms`。NPU 记录包含 `npuVerified=true` 和 VitisAI 证据；初始化时间单独记录，不混入单图比较。

分段观察显示，人脸检测是主要耗时段，其次是解码/预处理和质量分析；读取与 MobileNet 分类不是主要瓶颈。该结论只适用于本机这批样本。

## 两轮试验

### 第一轮：共享 Sharp 输入

共享旋转后的 Sharp 源，未改模型权重、阈值、输入分辨率、类别规则或人脸检测设置；质量分数等价回归通过。

- CPU p50 改善 `3.40%`，但 p95 变慢 `57.61%`。
- 核显 p50 变慢 `13.25%`，p95 变慢 `19.67%`。
- 独显 p50 改善 `4.64%`，但 p95 变慢 `9.29%`。
- NPU p50 基本不变，改善 `-0.04%`；NPU 验证仍通过。

未达到同设备 p50 或 p95 至少改善 10% 的门槛，不保留该候选为生产优化。

### 第二轮：并发度 2

只测量单个 analyzer/session 同时处理两张照片，不启动第二个 NPU session，不改变模型或阈值。四个后端均 0 失败，NPU 仍有 VitisAI 证据，但端到端 p50 全部变差：CPU `-37.81%`、核显 `-26.23%`、独显 `-14.74%`、NPU `-16.25%`。

该轮不采用，也不把并发度 2 写入网页默认工作流。

## 最终决定

- 保留原始串行分析器作为生产基线。
- 不继续尝试更小模型、量化、降低人脸输入分辨率或跳过人脸检测；这些方案可能改变分类边界，且当前缺少人工真值无法做联合验收。
- 性能插入任务到达停止点：两轮已完成，均未达到速度—精度联合门槛；不无限扩大数据、不无限尝试优化。
- 后续只有在 106 张候选完成必要人工审核后，才可做六类混淆统计；若继续优化，必须新建独立轮次并重新建立基线。

证据索引：`artifacts/open-images-candidates.json`、`artifacts/open-images-download-manifest.json`、`artifacts/folder-performance-baseline.json`、`artifacts/folder-performance-candidate.json`、`artifacts/folder-performance-concurrency-baseline.json`、`artifacts/folder-performance-report.json`、`artifacts/open-images-candidates-verification.json`。
