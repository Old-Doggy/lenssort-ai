# F6b 功耗边界收口报告

日期：2026-10-11
状态：F6b 功耗部分已收口，统一整机功耗为外部阻塞；稳定性子任务仍按既有证据完成。

## 可报告内容

- NVIDIA RTX 5070 Ti 有设备级 `nvidia-smi power.draw` 观察。
- 既有设备级观察报告记录 idle 约 `9.86 W`、照片管线约 `13.95 W`；该数据只代表 NVIDIA 设备传感器，不代表整机。
- CPU、AMD Radeon 880M 核显和 AMD NPU 没有在同一口径下获得可比功耗/能量读数。

## 不可报告内容

- 不报告 CPU、核显、独显、NPU 的整机功耗排名。
- 不报告每张照片的统一能耗。
- 不报告 NPU 比 CPU 更省电或更高效。
- 不把电池容量、系统电源方案或 GPU 设备瓦数换算成整机功耗。

## 结论

F6b.1 已确认当前机器缺少外部功率计或统一能量源；F6b.2 按停止规则关闭功耗测量子任务，状态为 `external-blocked`。后续如获得外部测量设备，可以新建独立测量任务，但不能在本计划中无限等待或重复不可比采样。

## 证据

- `artifacts/f6b-power-condition.json`
- `artifacts/dgpu-power-observation.json`
- `artifacts/folder-long-batch-verification.json`
- `artifacts/atomic-state-verification.json`

## 下一步

进入 `F7.1 真实 Windows 登录触发验证`。该步骤只验证用户级启动项在隔离条件下的登录触发行为，不自动处理照片，不修改现有用户启动项。
