# 文件夹自动识别与分类主线

> 历史实施计划（2026-10-13 标记）：下方是先前设计与进度快照，不是当前待办。阶段推进唯一依据是 `docs/LensSort_AI_唯一主流程.md`，状态见 `LensSort_AI_执行清单.md` 顶部。当前 C10 有限冻结已完成；F7.2 真人试用外部阻塞，真实登录不再是验收条件。

更新：2026-10-10。用户明确目标为照片放入目标文件夹后自动分类；竞品报告与原型退出关键路径。本文件优先于旧 UX 计划，原型审阅不再阻塞核心实现。

## 当前审计

- 旧方案尚未全部完成：T6.7 真人测试、统一功耗、演示视频和最终冻结未收口；当前软件核心链路与有限交付材料已完成。
- 历史缺口已补齐：本地服务监控目录并自动复制分类，网页默认入口负责目录与设备设置、启动/停止、实时结果。
- F2 已融合 MobileNet 场景信号与 MediaPipe 人脸人数；白名单与置信度规则仍为首版，真实多人、人物与风景及自然风景准确率等待 F5 验收。
- Node 使用 CPU/DirectML，NPU 通过独立 Python 3.12 WinML/VitisAI 桥接，已有真实推理及卸载 profile；GPU 与 NPU 证据分开，不混淆。

## 产品入口原则

- 默认首页只保留两个核心动作：`一键筛选` 和 `一键挑好看`。
- `一键筛选`：使用当前目录和设备配置启动监听；照片放入来源文件夹后自动分类，用户不需要逐张导入或选择类别。
- `一键挑好看`：对已经完成分析的照片按清晰度、曝光、主体检测等本地质量信号排序，将精选结果复制到输出目录下的 `精选` 文件夹；页面明确说明这是技术质量排序，不冒充审美真值。
- 输入目录、输出目录和设备收进折叠的“高级设置”，默认值可直接运行；停止、失败和待确认仍在主界面可见。本轮不新增阈值编辑入口。
- 一键操作必须有明确状态、结果数量和下一步提示；不能把复杂参数暴露为日常入口。

## 主路径

2026-10-07 用户补充优先约束：网页是主控制入口（设置目录、开始/停止、设备切换、实时结果），cmd 仅启动承载网页的本地服务，不作为日常控制界面。F4 与 F6 提到当前迭代：先 DXGI 枚举并分别核显/独显真推理，随后按 AMD 开源 WinML/Vitis AI EP 注册真实 NPU；请求 GPU/NPU 时失败必须显式报错，不静默换 CPU。NPU 不能只探测硬件或 provider，需要照片推理成功及算子卸载证据。停止步为网页全链路 + 核显/独显验证 + NPU 实测或明确外部资源阻碍，不再写竞品报告。

启动本地服务并打开网页 → 首次设置输入/输出文件夹和设备 → 一键筛选 → 向输入目录放照片 → 等待写入稳定 → 自动分析与分类复制 → 网页展示结果 → 一键挑好看 → 精选副本与原因展示。

默认输入 `data/inbox`，输出 `data/sorted`；原图不删除、不移动。服务运行期间自动发现新文件，重启补扫遗漏。开机自动启动是后续任务，首版不能声称已是系统服务。

类别：单人、多人、人物与风景、风景、其他、待确认。结合人脸人数与场景信号；低置信度或人脸失败保守进入待确认。人脸数不等于真实人数，阈值需验证；首版不做同一人物身份聚类。

## 2026-10-10 插入任务：自主数据与保精度加速

用户时间有限，默认不再要求用户提供大量照片。由项目收集来源/许可可追溯的公开数据，保留原有人工标签并明确AI辅助复核边界；先建立独立标签基线，再做最多两轮性能优化。详细任务、字段、门槛及停止条件见 `docs/public-eval-and-performance-plan.md`。本节优先于后文“只等待用户真实样本”的旧安排。

执行顺序为F5a公开采集与审核 → F5基线评估 → F6c分段计时与有限优化 → 更新报告并停止。F7软件已完成的部分不重做；真人反馈和统一功耗可以等待，不阻塞公开数据准备。不新增主页按钮或复杂性能参数。

- [x] F5a-P 计划：源码/现有数据审计及有限任务定义完成；未下载新样本、未修改识别行为。
- [x] F5a 候选与下载：Open Images 验证集索引已保存到 `data/eval/public-indexes/`；生成 120 条六类候选，按许可证、来源、人工标签和人框证据记录；有限下载 120 条，106 张唯一图片成功，14 个源地址返回 404/410 或尺寸不足。证据：`artifacts/open-images-candidates.json`、`artifacts/open-images-download-manifest.json`、`artifacts/open-images-candidates-verification.json`。
- [ ] F5a 人工审核：已提供独立本地审核页 `/?review=1`；支持 1–6 键/按钮确认、断点续审、原子状态和六类 `data/eval/labeled` 目录落盘。106 张仍未审核，六类映射来自公开数据集人工标签的保守规则，不等同于项目六类人工真值；在审核完成前不输出完整 accuracy/macro-F1，也不以代理标签放行性能门槛。证据：`artifacts/review-api-verification.json`、`output/playwright/public-review-page.png`。
- [x] F6c 性能：已完成CPU/核显/独显/NPU读取、解码/分类/人脸/质量分段基线；共享Sharp输入和并发度2各完成一轮单变量试验。会话复用与哈希去重已存在，不重复计功；未改小模型、输入分辨率、量化或人脸阈值。
- [x] F6c 验收与停止：两轮均未达到同设备p50或p95改善≥10%，共享输入在核显变慢，并发度2在四后端变慢；NPU两轮仍有真实VitisAI证据。由于候选缺项目六类人工真值，精度门槛保持不可评估，原始串行基线保留，按停止规则不再继续试验。证据：`artifacts/folder-performance-report.json`、`docs/performance-baseline-report.md`。
- 停止：最多两轮、第一轮达标即停；不达标保留基线并记录原因。数据/许可不足保持partial，不用模型标签伪造真值；用户只需必要的少量确认。

## 有限任务

- [x] F1：监控、写入稳定检测、增量队列、分类复制、持久记录。八项文件系统验收通过；复制原始字节、内容哈希去重、重启恢复、坏图隔离、不覆写输出。证据：artifacts/folder-sorter-verification.json。
- [x] F2：复用本地 MobileNet/MediaPipe，融合人数与场景；10 项规则边界通过，公开真实人像检测 1 张脸并进入单人，CPU/DirectML 都实际推理。证据：artifacts/folder-model-verification.json。仅完成首版工程链路，不代表多人/人物与风景/自然风景准确率达标。
- [x] F3：启动自动分类.cmd 和 npm run start:folder；可配置三个目录与后端，正常停止释放资源与锁。实际 CLI 启动后放入公开人像自动输出，退出 0。证据：artifacts/folder-entry-verification.json。停止步 A 到达；服务运行期间才自动分类，尚非开机常驻服务。
- [x] F4：网页设置目录/设备、开始/停止、实时结果/缩略图/失败状态。证据：artifacts/control-api-verification.json、artifacts/control-browser-verification.json。
- [x] F4b：一键式主入口重构完成；首页只突出一键筛选与一键挑好看，目录/设备收进高级设置，精选结果写入 `精选\<批次哈希>` 并显示数量与技术质量解释。证据：artifacts/quick-actions-verification.json、artifacts/photo-curator-verification.json。
- [ ] F5：先由F5a自主收集具原始人工标签的公开样本并记录AI辅助审核，再做六类混淆统计；当前已有 106 张下载样本但仍缺项目六类人工复核，因此保持 partial。确有证据才评估完整CLIP语义补充，最多一次模型补充迭代，不与F6c两轮性能试验无限叠加。
- [x] F6a：CPU、Radeon 880M、RTX 5070 Ti、AMD NPU 实际推理验证通过；GPU 显式 deviceId + 无 CPU 回退 profile，NPU 为 VitisAI + CPU 辅助算子混合。证据：artifacts/gpu-device-verification.json、artifacts/npu-verification.json、artifacts/control-browser-verification.json。
- [ ] F6b：稳定性子任务已完成；四设备统一功耗仍未完成。20 张四设备短基准、CPU/NPU 各 40 条小批量、CPU/NPU 各 1,000 条长批和各 5 分钟持续推理均通过，0 失败、0 重启重复分析，NPU profile 含 VitisAI 内核。证据：artifacts/folder-device-benchmark.json、artifacts/folder-stability-verification.json、artifacts/folder-long-batch-verification.json、artifacts/atomic-state-verification.json。功耗仅完成 NVIDIA 独显设备级观察，不宣称 NPU 比 CPU 快。
- [ ] F7：启动管理软件、Chrome/Edge和交付材料/2:19.56视频已完成；实际登录与三轮真人试用仍未测。冻结新增入口，允许上述用户新增F5a/F6c有限插入任务，不重做已验收软件交付。

F4b 后界面只服务自动工作流。F6 不阻塞 F1；历史 UX/工程证据仅代表旧范围，各阶段按真实验收打勾。

## F4b 验收边界

- `一键筛选` 是网页主路径：启动/停止监听，照片放入来源目录后自动分类，用户不逐张导入。
- `一键挑好看` 只做技术质量初筛：清晰度、曝光、主体信号和内容去重；不宣称审美判断、闭眼判断或真实相册准确率。
- 精选副本写入 `输出目录\精选\<批次哈希>`，清单为 `输出目录\精选\selection.json`；原图不删除、不移动，重复点击幂等。
- 本轮浏览器证据覆盖一键入口、自动分类、精选复制、原图字节保持、重复精选、移动端无横向溢出和页面无错误。

## 本轮工具异常

完整证据与防再发规则见 docs/folder-automation-incidents.md。

## 停止步 A 交付说明

- 网页默认优先核显，无核显则 CPU；配置保存后复用用户所选设备。输入 data/inbox，输出 data/sorted，网页记录在 data/control；旧 CLI 记录在 data/service-state。默认目录被 Git 忽略，不附带私人照片。
- 网页支持 CPU/核显/独显/NPU。核显/独显明确指定 DirectML DXGI 设备；NPU 真实照片推理有 VitisAI profile 才记录 npuVerified=true，允许必要 CPU 辅助算子，不能称纯 NPU。
- 本地 Edge 无界面承担 MediaPipe 的运行环境，HTTP 仅绑定 loopback 且仅提供白名单模型资源，阻止远程请求；照片不上传。
- 已完成 npm run lint 与 npm run build；构建仍有原浏览器 bundle 大于 500 kB 的提示，不影响本轮目录功能验收。
- 公开人像来源 https://storage.googleapis.com/mediapipe-assets/portrait.jpg，SHA-256 见真实模型报告；只用于本地验证，不打包再分发。自然风景下载失败，不把合成图当自然风景精度证据。
- 本轮“网页控制 + 核显/独显/NPU 真实照片自动分类”停止步已到达；下一有限步骤 F5 标注分类评估、F6b 稳定性/功耗、F7 自动启动/真人试用，不新增报告分支。
- 2026-10-10 已完成 F4b、F6b 稳定性子任务、F7 开机启动子任务和有限交付材料；下一步只处理 F5 真实样本、统一功耗、真人试用或视频中的一个，不新增产品分支。
- 2026-10-10 F7 子任务：开机启动使用当前用户 Startup 文件夹快捷方式；安装/查看/卸载和后台 `/api/status` 均通过。它只启动本地网页服务，不自动开始筛选；任务计划方式因当前用户权限返回 Access is denied，未采用且未留下任务。
- 2026-10-10 已生成有限交付文档、架构/用户/排序三图、简历要点、面试问答与2:19.56实机网页视频；播放器 `output/playwright/lenssort-demo-player.html`。视频证据包含实际NPU profile、自动目录分类、去重精选、原图保护；播放与SHA-256检查通过。自动录制不算真人反馈，公开分享需复核样本授权。
- 2026-10-10 启动验收已修成临时配置和精确子进程清理；已有同名服务、调用环境与真实启动项保持原状的回归通过。只证明管理/后台启动，不证明实际Windows登录触发。
- 当前停止在有限软件交付：F5等待六类人工标注照片，F6b等待统一功耗来源，F7等待三轮真人反馈和实际登录验证；不新增入口/模型/竞品，不重复已通过的千文件長批。人工测试使用 `docs/user-testing-t6.7.md` 新A–E流程。

尝试在 orchestration store 保存函数触发 `failed to serialize JavaScript value: expected value at line 1 column 1`，未执行文件编辑。store 仅保存可序列化字符串/对象，不保存函数；后续补丁用字符串命令模板。
