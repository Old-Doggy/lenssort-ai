# LensSort AI 有限工程交付报告

版本：2026-10-13
项目目录：`<project-root>`
项目定位：本地优先的 AI 照片文件夹自动整理与技术质量初筛工具

## 1. 交付结论

核心产品链路已达到可演示、可复现的交付状态：

1. 用户在网页中设置一次输入/输出目录和推理设备。
2. 点击“一键筛选”后，把照片放入输入文件夹即可自动等待写入稳定、分析、分类和复制。
3. 网页实时展示分类、缩略图、失败原因、设备和处理状态。
4. 点击“一键挑好看”后，系统按清晰度、曝光、人脸等技术信号生成精选副本。
5. 原图不删除、不移动；相同内容去重；重复精选幂等。
6. CPU、AMD 核显、NVIDIA 独显和 AMD NPU 均有实际推理证据；NPU 明确为 NPU+CPU 辅助算子混合，不称纯 NPU。

## 2. 当前验收状态

| 模块 | 状态 | 证据 |
|---|---|---|
| 文件夹监听、稳定写入、增量处理 | 通过 | `artifacts/folder-sorter-verification.json` |
| 人脸/场景融合分类主链路 | 工程链路通过，真实准确率待评估 | `artifacts/folder-model-verification.json` |
| 网页 API 控制与安全边界 | 通过 | `artifacts/control-api-verification.json` |
| 一键筛选/一键挑好看 | 通过 | `artifacts/quick-actions-verification.json` |
| 精选去重、原图保护、幂等 | 通过 | `artifacts/photo-curator-verification.json` |
| 核显/独显/NPU 网页推理 | 通过 | `artifacts/control-browser-verification.json` |
| Chrome/Edge 兼容性 | 通过 | `artifacts/control-browser-compatibility.json` |
| CPU/NPU 千文件长批 | 通过 | `artifacts/folder-long-batch-verification.json` |
| Windows 原子状态保存修复 | 通过 | `artifacts/atomic-state-verification.json` |
| 启动项管理与后台启动 | 隔离验收通过；真实登录触发未测 | `artifacts/startup-verification.json`、`artifacts/background-launcher-verification.json`、`artifacts/startup-isolation-verification.json` |
| 手动网页主入口与 F7.1 闭环 | 通过；不需要开机启动 | `artifacts/f7-manual-closeout.json`、`artifacts/f7-manual-control-verification.json` |
| NVIDIA 独显设备级瓦数观察 | 部分完成 | `artifacts/dgpu-power-observation.json` |
| 106 张公开候选代理评估 | 已收口（partial），识别质量不足 | `artifacts/f5-closeout.json`、`artifacts/folder-label-evaluation.json` |
| 六类真实照片准确率 | 未完成，缺少独立真人真值和完整类别 | `docs/f5-evaluation-boundary-report.md` |
| 三轮真人试用 | 外部阻塞 | `artifacts/f7.2-human-trial-boundary-2026-10-13.json`，等待真实参与者 |

## 3. 长批稳定性结果

测试使用 20 张工程源文件生成 1,000 个实际唯一的有效 JPEG 输入；这些样本证明管线稳定性，不代表真实相册分类准确率。最新报告时间为 2026-10-10T01:54:36.31Z；吞吐包含夹具生成、复制和状态写入，是本机工程负载观察，不是公平纯模型加速比较。

| 设备 | 成功 | 失败 | 分析调用 | 重启重复分析 | 批处理吞吐 | 持续推理 |
|---|---:|---:|---:|---:|---:|---:|
| CPU | 1000/1000 | 0 | 1000 | 0 | 15.367 张/秒 | 约 300 秒、7471 次 |
| AMD NPU | 1000/1000 | 0 | 1000 | 0 | 13.558 张/秒 | 约 300 秒、5913 次 |

NPU 记录包含 `npuVerified=true`，并在 profile 中确认 `VitisAIExecutionProvider` 内核。批处理 RSS 只记录 Node 进程，不包含 Edge 和 Python/WinML 子进程，因此不能当作整条管线内存峰值。

## 4. 已修复的真实问题

首次千文件测试发现 Windows 下状态 JSON 原子替换偶发 `EPERM`，导致 999 条完成、1 条失败。问题已记录在 `docs/folder-automation-incidents.md`，修复方式是 `tools/atomic-state.js`：临时文件独占创建、可重试错误指数退避、失败清理和旧状态保留。修复后原子状态 5 项回归与千文件长批均通过。

## 5. 功耗边界

当前仅能读取 NVIDIA 独显的 `power.draw`：设备级观察中 idle 平均约 9.86 W，照片管线观察平均约 13.95 W。该数据不包含整机、CPU、核显、NPU、屏幕、磁盘和背景负载，因此不支持“谁更省电”的结论。四设备统一能耗比较需要外部功率计或统一可校准的能量源。

## 6. 未完成与停止条件

- F5：106 张已完成 AI 辅助视觉复核与四后端代理评估；Accuracy 0.2547、Macro-F1 0.2413、Weighted-F1 0.2899。待确认类没有真值样本，标签不是独立真人真值，不能宣称真实相册准确率。结果偏低，不能称为高精度产品；规则与模型改进不在本次冻结范围。
- F6c：两轮优化均未通过至少 10% 的速度改善门槛，保留原始串行基线；不宣称已提速或 NPU 更快。
- F6b 功耗：等待统一外部测量条件；不继续无限尝试系统传感器。
- F7.2 真人试用：当前没有参与者，保持外部阻塞；自动化浏览器、演示视频和开发者自测不替代真人满意度。
- 演示视频：已录制 `output/playwright/lenssort-folder-demo.webm`，1440×900、2:19.56，无旁白、有字幕。实际展示网页按钮、目录新增照片、NPU 混合推理及去重精选；自动化录制不替代真人反馈。视频播放页为 `output/playwright/lenssort-demo-player.html`，工程记录为 `output/playwright/lenssort-folder-demo.json`；公开传播前仍须复核样本授权。
- 启动管理：不属于日常必需能力；历史隔离证据保留，但不宣称真实 Windows 登录触发已验收。

本报告的停止点是“软件核心链路+有限稳定性+网页主入口闭环+交付材料”完成；F5 真实准确率、F6b 统一功耗和 F7.2 真人试用仍按证据标记为未完成/外部阻塞。后续只处理明确外部输入或阻塞性问题，不继续无限扩展功能。
