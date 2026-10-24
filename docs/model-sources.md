# 模型来源记录

## MobileNetV4

- 模型标识：`onnx-community/mobilenetv4_conv_small.e2400_r224_in1k`
- 使用方式：Transformers.js `image-classification`
- 代码入口：`src/model.ts`
- 目标路径：WebGPU 优先，WASM 回退
- 本地目录约定：`public/models/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k/`
- 模型主页：`https://huggingface.co/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k`
- 固定 commit：`3ba07f12712fa58fd6b3d661f9909c9e332c5005`
- 基础模型：`timm/mobilenetv4_conv_small.e2400_r224_in1k`
- 基础模型许可证：Apache-2.0（基础模型仓库元数据）；ONNX 转换仓库未单独声明许可证，因此公开部署前仍需人工复核转换仓库和权重再分发条款。
- 2026-10-03 验证状态：已完成 T4.1。浏览器使用本地文件通过 WebGPU `fp32` 完成推理，WASM `q8` 文件已准备为回退路径。
- 本地资源约定：仅放入已获许可且与同一模型版本匹配的配置、预处理文件和 ONNX 文件；模型大文件不提交 Git。

### 已下载文件与 SHA-256

| 文件 | 大小（字节） | SHA-256 | 用途 |
|---|---:|---|---|
| `config.json` | 69895 | `AE99506E66F8E19BC73809E5B4C3AE31FC7C2BCA53752DC7CB89C1E47831A335` | 模型配置 |
| `preprocessor_config.json` | 441 | `21BB2BCCBD790DED22CA9AC77758578BAE4D90D8FC578A612097BD38E9D40B2F` | 图像预处理 |
| `quantize_config.json` | 1477 | `45EFFDF587FCEAA8C1F5BFC92F632983F5C7735F2C564B936B3BF80D36224720` | 量化配置 |
| `onnx/model.onnx` | 15086122 | `CA5B8DBF490F54E83C5D72F787821565447EA94347935F6B834CF0A4AF0E8D37` | WebGPU `fp32` |
| `onnx/model_quantized.onnx` | 3931745 | `270717121EFB0960D60FEB712574D55FA27B585F3C4AFC14741D81EA980BCD9A` | WASM `q8` |

下载日期：2026-10-03。模型文件已被 `.gitignore` 排除，不进入 Git 提交。

## T4.1 本地资源预检

应用会在单图推理前检查以下路径：

```text
<project-root>/public/models/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k/config.json
<project-root>/public/models/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k/preprocessor_config.json
```

预检只确认配置文件可以通过 HTTP 读取、响应不是 HTML 且 `Content-Type` 为 JSON；预检通过不等于模型推理成功。还必须核对与同一版本匹配的 ONNX 权重、其他 Transformers.js 必需文件、许可证和 SHA-256。预检失败时的含义如下：

- `本地模型文件不存在`：目录或配置文件尚未放入 `public/models/`，或路径层级不正确。
- `本地模型配置不完整`：部分配置文件存在，另一部分缺失或格式不正确。
- `本地模型资源无法访问`：开发服务器、浏览器权限或网络访问导致文件无法读取。
- `推理错误`：配置预检后，模型初始化、设备后端或图片推理仍然失败。

当前本地预检状态：**2026-10-03：通过。**

## MediaPipe Face Detector

- 模型标识：`blaze_face_short_range`
- 使用方式：MediaPipe Tasks Vision `FaceDetector`，`runningMode: IMAGE`
- 代码入口：`src/face-detector.ts`
- 本地 WASM 目录：`public/models/mediapipe/wasm/`
- 本地模型路径：`public/models/mediapipe/face_detector/blaze_face_short_range.tflite`
- 模型来源：`https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`
- npm 依赖：`@mediapipe/tasks-vision@1.0.1`
- 模型文件大小：`229746` 字节
- SHA-256：`B4578F35940BF5A1A655214A1CCE5CAB13EBA73C1297CD78E1A04C2380B0152F`
- 本地 WASM 运行时：`vision_wasm_internal.js`、`vision_wasm_internal.wasm`、`vision_wasm_module_internal.js`、`vision_wasm_module_internal.wasm`、`vision_wasm_nosimd_internal.js`、`vision_wasm_nosimd_internal.wasm`
- 许可证和公开再分发边界：本轮只记录官方模型下载地址与本地验证结果；若公开部署或再分发，需要单独复核 MediaPipe Tasks Vision、模型文件及其依赖的许可证条款。

### T4.3/T4.4 验证记录

- 验证日期：2026-10-03
- 测试图片：`data/eval/similarity_cases_extra/case11_rotate5_a.png`
- 实际结果：人脸数量 `0`、面积占比 `0%`、最高置信度 `0%`、检测耗时 `79 ms`
- 资源访问：本地 WASM JavaScript、WASM 二进制和 `.tflite` 模型均通过开发服务器返回 HTTP `200`
- 运行边界：浏览器控制台显示 MediaPipe 图计算成功启动，并出现 CPU/XNNPACK 日志；这不等于 NPU 推理，项目当前不宣称 NPU 已使用。

## MediaPipe Face Landmarker

- 模型标识：`face_landmarker`
- 使用方式：MediaPipe Tasks Vision `FaceLandmarker`，`runningMode: IMAGE`
- 代码入口：`src/face-landmarker.ts`
- 本地 WASM 目录：`public/models/mediapipe/wasm/`
- 本地模型路径：`public/models/mediapipe/face_landmarker/face_landmarker.task`
- 模型来源：`https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- npm 依赖：`@mediapipe/tasks-vision@1.0.1`
- 模型文件大小：`3758596` 字节
- SHA-256：`64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF`
- 配置：最多 `5` 张脸，输出 face landmarks 和 blendshape 分类数量；本轮不把 blendshape 转成闭眼或表情产品结论。
- 许可证和公开再分发边界：本轮只记录官方模型下载地址与本地验证结果；若公开部署或再分发，需要单独复核 MediaPipe Tasks Vision、模型文件及其依赖的许可证条款。

### T4.5 验证记录

- 验证日期：2026-10-03
- 测试图片：`data/eval/similarity_cases_extra/case11_rotate5_a.png`
- 实际结果：人脸数量 `0`、关键点运行耗时 `117 ms`；结果状态为成功而非失败。
- 资源访问：本地 `face_landmarker.task` 通过开发服务器返回 HTTP `200`；WASM 运行时与 T4.3/T4.4 共用并已验证可启动。
- 持久化：刷新页面并重新选中照片后，关键点成功卡片和 `117 ms` 仍显示。
- 运行边界：CPU/XNNPACK 和 WebGL 日志只说明 MediaPipe WASM 运行时已启动；这不等于 NPU 推理。由于测试图没有人脸，本记录不代表正向人像关键点精度评测。

### T4.6 闭眼风险记录

- 代码入口：`src/face-landmarker.ts`、`src/App.tsx`
- 输入：Face Landmarker 输出的 `eyeBlinkLeft` 和 `eyeBlinkRight` blendshape 分数
- 聚合：单脸取左右眼平均值；多脸取有效人脸中的最大值
- 阈值：`< 0.35` 为“未发现明显风险”；`>= 0.35` 为“建议人工确认”
- 低置信度处理：缺少任一侧眼部数据为“数据不足”；无检测人脸为“无可判断人脸”；不输出“确定闭眼”
- 验证图片：`data/eval/similarity_cases_extra/case11_rotate5_a.png`
- 实际结果：无可判断人脸；页面显示“未检测到人脸，无法判断闭眼风险”；刷新后状态恢复
- 说明：该字段用于静态照片的保守筛选提示，不等同于连续视频眨眼识别或医疗结论。

## CLIP image embedding

- 模型标识：`Xenova/clip-vit-base-patch32`
- 使用方式：Transformers.js `image-feature-extraction`，WASM `q8`
- 代码入口：`src/clip-embedder.ts`
- 本地模型目录：`public/models/Xenova/clip-vit-base-patch32/`
- 本地文件：`config.json`、`preprocessor_config.json`、`onnx/vision_model_quantized.onnx`
- 资源来源：Hugging Face 模型仓库 `Xenova/clip-vit-base-patch32`；浏览器实际使用项目内本地资源，不依赖运行时下载
- 文件大小与 SHA-256：`config.json` 4524 字节，`493EF57FF783E42D1530C91B53469B7FDF8DB8A9C1408E86998FCB7899A4F495`；`preprocessor_config.json` 520 字节，`6F638FB9401A6D6296FEFF533EE7EFE657B787C49F954F82F5906B36EF2A1B1F`；`onnx/vision_model_quantized.onnx` 89117001 字节，`583FD1110A514667812FEE7D684952AAF82A99B959760C8D7DCA7E0AB9839299`
- 向量处理：输出向量做 L2 归一化；余弦相似度保留三位小数；维度不一致或空向量不返回相似度

### T4.7 验证记录

- 验证日期：2026-10-03
- 固定评测图片：`data/eval/similarity_cases_extra/case11_rotate5_a.png`、`case11_rotate5_b.png`、`case19_alt_scene_a_a.png`
- 实际结果：三张图片均成功返回 `512` 维 embedding；WASM `q8` 单图耗时分别为 `556 ms`、`344 ms`、`359 ms`
- 余弦相似度：相似图 A/B 为 `0.951`；相似图 A/不同图为 `0.924`
- 解释边界：当前不同图相似度仍较高，说明仅凭三张图不足以建立筛选阈值；本轮只证明本地模型初始化、三次 embedding、归一化和相似度计算链路成功，不进入 30 张批量推理或产品排序。
- 运行边界：使用 WASM `q8`；没有证据证明 NPU 已被使用，因此不宣称 NPU 推理。

## T4.9 批量端到端验证记录

- 验证日期：2026-10-04
- 输入数量：30 张项目内公开评测图片，来自 `data/eval/similarity_cases/` 和 `data/eval/similarity_cases_extra/`
- 传统分析：30 张均完成缩略图、清晰度、曝光和 dHash/pHash 相似分组；页面显示质量风险 4 张、相似照片 18 张
- MobileNetV4：30/30 完成，30 张成功，0 张失败
- Face Detector：30/30 完成，30 张成功，0 张失败
- 持久化：逐张结果写入 IndexedDB；刷新后恢复 30 张照片、30/30 完成、30 张模型成功和 0 张模型失败
- 运行边界：MobileNetV4 使用 WebGPU 优先策略；Face Detector 使用本地 MediaPipe WASM；控制台 XNNPACK/WebGL 日志不作为 NPU 证据，本轮不宣称 NPU
- 证据：`artifacts/t4.9-batch-evaluation.json` 与浏览器端到端快照

## 记录模板

| 字段 | 内容 |
|---|---|
| 模型主页 | `onnx-community/mobilenetv4_conv_small.e2400_r224_in1k` |
| 具体版本或 commit | `3ba07f12712fa58fd6b3d661f9909c9e332c5005` |
| 文件名与大小 | 见上表 |
| 许可证 | 基础模型 Apache-2.0；ONNX 转换仓库未单独声明 |
| 下载日期 | 2026-10-03 |
| SHA-256 | 见上表 |
| 是否允许公开部署 | 当前不直接作肯定结论，需复核 ONNX 转换仓库再分发条款 |
