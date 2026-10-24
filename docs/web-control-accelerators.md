# 网页控制与实际硬件推理

2026-10-09，已验收网页启动/停止、目录配置、自动结果、核显/独显/NPU 真实人像分类和两个一键主入口。不是竞品报告。

## 实现

- 网页默认主入口 FolderControl；旧 App 通过 ?legacy=1 保留。Node loopback 服务承载已构建网页，API 同源校验 + 随机会话 token；只开放 dist/assets 与记录内缩略图，不暴露整个照片磁盘。
- 一次启动本地网页服务，日常设置与控制全部在网页完成。纯静态 HTML 不能不经本地服务任意监听 Windows 文件系统；本地服务是网页控制的执行器，不让用户手动按照片分类。
- 首页日常路径只有两个动作：`一键筛选` 启动/停止监听并自动分类；`一键挑好看` 对已完成分析的照片做技术质量初筛。输入/输出目录与设备在“高级设置”中配置一次即可。
- 精选输出到 `输出目录\精选\<批次哈希>`，清单为 `输出目录\精选\selection.json`；相同内容去重，重复点击幂等，原图不删除、不移动。质量排序不等于审美判断。
- CPU/GPU 使用现有 MobileNetV4 FP32；DXGI 工具按运行时真实适配器枚举并把对应 deviceId 传给 DirectML，不从 Win32_VideoController 顺序猜编号。2026-10-08 本机实测 NVIDIA RTX 5070 Ti 为 deviceId=0、AMD Radeon 880M 为 deviceId=1；编号可能随机器变化。DirectML 会话显式禁止 CPU fallback，profile 有 DmlExecutionProvider。
- AMD NPU 使用 Python 3.12 WinML 1.27.1、wasdk 2.3.2.dev10，bootstrap 明确使用已安装稳定 Windows App SDK 2.5/2.5.1.0。通过 ExecutionProviderCatalog ensure_ready 与 register_execution_provider_library 选择硬件 type=NPU，实际 provider 为 VitisAIExecutionProvider。
- 官方 NPU provider 原始 WindowsApps 路径导致 AIE Peano 的 VFS 参数截断；只复制当前 provider 文件到 data/npu-cache/provider，不改系统包/驱动。DLL 私有缓存约 737 MB；不打包再分发，许可证人工复核后方可公开发布。
- NPU 会话常驻，用标准输入/输出 JSON 传归一化 Float32 tensor；照片不上传。首张照片执行后解析 ORT profile，必须有 VitisAIExecutionProvider kernel 才标 npuVerified=true。允许 CPU shape 辅助算子，表示 NPU+CPU 混合执行；MediaPipe 人脸检测仍使用 CPU/WASM。

## 已验证证据

- artifacts/gpu-device-verification.json：两个 GPU 的适配器、deviceId、冷/热推理耗时与每个设备 profile；合成输入不是分类准确率。
- artifacts/npu-verification.json：MobileNet 原图模型经 VitisAI 转换并推理，profile 有 NPU kernel，辅以 CPU 辅助算子。合成输入不是照片准确率；热推理约 5 ms 是少量短跑，不宣称完整速度优势。
- artifacts/control-api-verification.json：配置/启动/停止、token/路径约束、自动结果缩略图与私人 data 不静态暴露。
- artifacts/control-browser-verification.json：网页分别启动核显、独显、NPU，启动后新放入公开人像自动分类为单人；NPU 记录与 profile 再次检查。控制网页无 pageerror、390 px 布局不溢出。
- artifacts/quick-actions-verification.json：网页点击一键筛选后自动分类，点击一键挑好看后生成精选副本；检查原图字节保持、内容去重、重复精选幂等、移动端无溢出和无 pageerror。测试夹具为公开人像的工程亮度变换，不代表真实准确率或审美效果。
- artifacts/control-web-desktop.png、artifacts/control-web-mobile.png：实际页面截图。

## 开源实现依据

- AMD RyzenAI-SW WinML ResNet 教程与 Python EP discovery/registration（https://github.com/amd/RyzenAI-SW/tree/main/WinML/CNN/ResNet）：用于核实 Catalog、register_execution_provider_library、get_ep_devices、NPU provider 选择；最终仍使用现有 MobileNet，并未下载 ResNet。
- AMD 安装/卸载证明文档（https://ryzenai.docs.amd.com/en/latest/inst.html）：真实 offloading 判据，不把“检测到 NPU”当使用证据。
- Microsoft onnxruntime Node DirectML binding：执行提供者 deviceId 传给 OrtSessionOptionsAppendExecutionProvider_DML。
- 检索快照 artifacts/accelerator-source-check.json；当前 NPU 驱动 32.0.20102.3930，未修改驱动。

## 复现依赖

本机环境已安装；无需用户再下载权重。新机器从 Python 3.12 创建项目 .venv-winml，只装一个 WindowsML ORT 包，避免 onnxruntime-winml 与 onnxruntime-windowsml 文件相互覆盖：

```powershell
& 'C:\Python312\python.exe' -m venv .venv-winml
& '.\.venv-winml\Scripts\python.exe' -m pip install --pre 'wasdk-Microsoft.Windows.AI.MachineLearning[all]==2.3.2.dev10' 'wasdk-Microsoft.Windows.ApplicationModel.DynamicDependency.Bootstrap==2.3.2.dev10' numpy --no-input --index-url https://pypi.org/simple
& '.\.venv-winml\Scripts\python.exe' tools/winml-discover.py --ensure
```

当前配套 onnxruntime-windowsml 为 1.27.1.202607110137。Windows App SDK 2.5.1 已在机器上；其他机器必须匹配其稳定 runtime。NPU 首次 ensure_ready 需要下载厂商 provider，编译约数分钟，有启动超时控制；后续编译缓存可复用。

## 边界/停止步

当前已达到网页控制+三类加速器真实照片推理；CPU/NPU 长批稳定性、开机启动子任务和有限交付材料已有独立证据。多人、自然风景准确率仍待 F5；四设备统一功耗、真人试用和演示视频仍未完成。官方 protobuf UTF-8 / plugin EndProfiling 日志仍出现但本轮退出 0、profile 与结果有证据；不能声称没有日志警告或纯 NPU。
