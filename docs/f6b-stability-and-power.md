# F6b 有限稳定性与功耗验收

日期：2026-10-10。范围只包含现有文件夹管线的可重复负载验收，不新增模型、竞品或产品入口。

## 验收口径

- 保留四设备 20 张短基准报告 `artifacts/folder-device-benchmark.json` 和 CPU/NPU 各 40 条小批量报告 `artifacts/folder-stability-verification.json`，不覆盖历史证据。
- 新的批处理验收使用 20 张工程源文件，各生成 50 个 JPEG 字节流，共 1,000 个文件；每个文件应实际调用分析器，不能依赖五种 JPEG 编码变体的去重结果充当千次推理。
- 字节唯一性通过本地亮度/编码变换与 JPEG 尾部测试标记实现。尾部标记不代表新的视觉内容，工程源文件也不是 1,000 张独立真实照片；不能据此计算真实分类准确率。
- CPU 和 NPU 顺序测试，分别检查分类成功数、失败数、唯一输出数、每个原图与副本的 SHA-256、真实设备、重启后状态数量和重复分析次数。
- 每台设备批处理后追加五分钟实际推理；NPU 的照片结果必须已验证，且重新读取 profile 确认 VitisAIExecutionProvider 内核。
- 记录批处理墙钟耗时与 Node RSS 峰值；墙钟包含工程夹具生成、复制和状态写入，不等同于纯模型耗时。RSS 不含 Edge 和 Python/WinML 子进程，不能当作整条管线内存峰值。
- 五分钟持续负载是有限工程验收，不是全天、隔夜或无限期服务稳定性证明。

## 执行方式

先进行短预检：

```powershell
node tools/verify-long-batch.js --source-limit=2 --copies=2 --backends=cpu --sustained-ms=1000 --report=artifacts/long-batch-smoke.json
```

通过后执行正式有限负载：

```powershell
node tools/verify-long-batch.js --source-limit=20 --copies=50 --backends=cpu,npu --sustained-ms=300000 --report=artifacts/folder-long-batch-verification.json
```

正式报告退出码与全部断言均通过，才能标记该子步骤完成。首次模型初始化、持续负载、恢复初始化需等待；预期总时长约十几分钟。临时夹具留在系统临时目录以便复核，禁止扫描私人相册代替测试样本。

## 功耗采集边界

本机只读探测：nvidia-smi 可返回 RTX 5070 Ti 的 power.draw；Win32_PowerMeter 与 Win32_PerfFormattedData_Counters_EnergyMeter 返回“无效类”，MSAcpi_ThermalZoneTemperature 返回“拒绝访问”。不提升权限、不安装内核传感器驱动，也不将利用率、温度或电源计划冒充能耗。

`tools/measure-dgpu-power.js` 在长批结束后顺序读取 15 秒桌面空闲和 30 秒独显照片推理的 NVIDIA 设备瓦数，报告保存为 `artifacts/dgpu-power-observation.json`。只说明该设备传感器的本机观察值，不是整机瓦数，也不证明 CPU、核显、NPU 谁更省电。报告总体状态保持 partial，即使独显子测量成功。

四设备等口径整机能耗比较需要外部功率计或可核实的统一整机能量来源，固定供电/屏幕/背景负载、测基线后再进行相同照片管线的负载测量。未取得该来源时，功耗任务保持未完成，禁止估算后当实测。

## 当前结果（2026-10-10）

- `artifacts/folder-long-batch-verification.json`（2026-10-10T01:54:36.31Z）：CPU/NPU 各 1,000 个实际唯一输入，均 `classified=1000`、`failed=0`、`analysisCalls=1000`、`restartAnalysisCalls=0`、`restartStateCount=1000`；CPU 吞吐 15.367 张/秒、持续推理约 300 秒 7,471 次，NPU 吞吐 13.558 张/秒、约 300 秒 5,913 次，NPU profile 验证通过。该工程负载观察不是公平的纯模型加速比较。
- 首次长批暴露 Windows `EPERM` 原子替换失败，历史失败证据为 `artifacts/folder-long-batch-failure-20261009-234909.json`；`tools/atomic-state.js` 增加 7 次指数退避并通过 `artifacts/atomic-state-verification.json`，随后正式长批通过。
- `artifacts/dgpu-power-observation.json`：RTX 5070 Ti 设备级 idle 平均约 9.86 W、照片管线观察平均约 13.95 W；报告状态保持 `partial`，因为它不是整机能耗，也不能代表 CPU/核显/NPU。

## 停止步与后续

- 本轮在千文件/五分钟测试、独显可用瓦数观察、报告复核和计划同步后停止扩展 F6b 工具。
- F6b 的四设备等口径功耗缺口不靠无限重试传感器解决；需要用户提供外部测量条件后再继续该子任务。
- F5 等待六类带人工标签的真实照片；不得把当前工程样本或模型标签当作人工真值。
- 本轮子步骤结束后，允许按主计划转入 F7 可独立完成的软件交付；真实使用反馈、开机启动与求职材料仍须各自证据，不因这份文档而完成。
