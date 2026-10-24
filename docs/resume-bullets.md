# LensSort AI 简历要点

以下数字均来自项目证据；根据岗位选择 2–4 条，不要全部堆在简历上。

## 中文：AI 产品经理方向

- 独立设计并落地本地优先 AI 照片整理产品 LensSort AI：将“照片放入文件夹后自动分类”的需求拆解为网页控制、目录监听、稳定写入、模型推理、可解释精选和异常恢复闭环。
- 负责从用户入口到技术边界的产品设计：将首页收敛为“一键筛选/一键挑好看”两个主动作，把目录与设备配置下沉至高级设置，并明确技术质量初筛不等于审美判断。
- 组织 CPU、AMD 核显、NVIDIA 独显和 AMD NPU 的真实推理验证；NPU 通过 WinML/VitisAI profile 确认算子卸载，同时保留 CPU 辅助算子边界，避免将硬件探测包装成推理结果。
- 建立本地化质量与安全闭环：原图不删除、内容哈希去重、精选输出幂等、路径/符号链接校验、loopback API 和 token 校验，支持失败重试与重启恢复。
- 通过 1,000 文件 CPU/NPU 长批和约 5 分钟持续推理验证稳定性：两种设备均 1,000/1,000 成功、0 次重启重复分析；发现并修复 Windows 原子状态保存的瞬时 `EPERM`。
- 如实管理模型质量边界：106 张公开候选仅形成 AI 辅助代理评估（Accuracy 0.2547、Macro-F1 0.2413），不冒称独立真人准确率，并据此停止无证据的继续扩展。

## 中文：互联网/快消产品经理方向

- 将复杂 AI 能力包装为低学习成本的双入口产品：用户无需逐张导入或选择类别，照片进入目录后自动处理；页面同步展示状态、数量、原因和下一步提示。
- 围绕“信任成本”设计原图保护、隐私说明、失败可解释、待确认分类和人工可控停止，兼顾自动化效率与用户安全感。
- 用 Chrome/Edge、移动端无横向溢出、API 安全边界和端到端自动化验收验证产品可用性，而不是只展示模型 demo。
- 通过实际 `启动网页控制.cmd` 验收“未启动不处理—一键筛选—自动分类—一键挑好看—停止”闭环；真人满意度仍未测，不把自动化浏览器写成用户反馈。

## 中文：销售/解决方案方向

- 能将 AI 推理、GPU/NPU 加速、隐私和部署限制转译成客户可理解的价值：本地处理、不上传照片、网页控制、设备可切换、失败可解释。
- 以证据驱动售前表达：区分准确率、吞吐、稳定性、设备瓦数和用户满意度，明确哪些已验证、哪些需要客户现场或真实样本补测。

## English: AI Product Manager

- Built LensSort AI, a local-first photo organization product that turns a folder drop into an end-to-end workflow: file stability detection, incremental inference, category routing, explainable quality curation, persistence, and recovery.
- Simplified the daily experience to two primary actions—“One-click Filter” and “One-click Curate”—while moving paths and accelerator selection into advanced settings.
- Validated CPU, AMD iGPU, NVIDIA dGPU, and AMD NPU inference; verified VitisAI execution-provider kernels for NPU runs and explicitly documented required CPU auxiliary operators.
- Designed local privacy and trust controls including original-file preservation, SHA-256 deduplication, idempotent curation, path/symlink validation, loopback-only APIs, and token-protected controls.
- Ran a 1,000-file CPU/NPU long-batch test plus roughly five minutes of sustained inference per backend: 0 failures and 0 duplicate analyses after restart on both backends.

## 面试自我介绍中的一句话

“我做的不是只调用一个模型的 demo，而是把照片整理问题做成了一个本地可运行、网页可控制、支持 GPU/NPU、可解释、可恢复并且有明确验证边界的完整产品。”
