# LensSort AI

> **Local-first photo organization with explainable AI.**
>
> **本地优先、可解释、可人工修正的 AI 照片整理工具。**

LensSort AI is a desktop-oriented web controller that scans a user-selected photo folder and copies images into human-readable categories such as `单人`, `多人`, `人物与风景`, `风景`, `动物`, `植物`, `其他`, and `待确认`. Original files are never deleted, moved, or uploaded.

LensSort AI 是一个面向桌面端的网页控制工具：用户选择照片来源文件夹后，系统自动分析并复制到“单人、多人、人物与风景、风景、动物、植物、其他、待确认”等目录。原图始终保留，不上传、不移动、不删除。

## Why this project

This project focuses on the practical trade-off between recognition quality, inference speed, hardware compatibility, and user trust. When evidence conflicts, the system prefers `待确认` and provides a manual correction path instead of silently inventing certainty.

这个项目关注照片整理中最实际的产品问题：识别准确度、推理速度、不同硬件兼容性与用户信任之间的平衡。对于遮挡、模糊、雕像与真人混合等边界场景，系统允许进入“待确认”，并提供网页人工修正，而不是伪造确定结果。

## Highlights

- **One-click workflow** — choose folders, click “一键筛选”, and monitor clear per-photo progress.
- **Local processing** — images stay on the selected computer; Ollama is optional and only used for local visual review.
- **Multi-signal classification** — MobileNetV4, MediaPipe Face Detector, YOLOX person detection, CLIP scene signals, and optional local VLM review.
- **Conservative person counting** — deduplicated body boxes, statue/artwork safeguards, masked-face guidance, and bounded rotation re-checks.
- **Hardware-aware inference** — CPU, integrated GPU, discrete GPU, and experimental Windows ML NPU paths with truthful device evidence.
- **Human-in-the-loop correction** — open the original image, change its label, and move only the classification copy.
- **Safe operations** — refreshes reflect current disk state; source images are protected; model downloads use size and SHA-256 checks.
- **辅助推荐** — technical quality and similarity hints are available, but subjective aesthetic selection is not the acceptance goal.

## Quick start on Windows

1. Install Node.js `22.12+` (Node.js 24 LTS recommended).
2. Clone or download this repository to any path, including paths with Chinese characters or spaces.
3. Double-click `首次安装.cmd`.
4. Double-click `启动网页控制.cmd`.
5. Select the source and output folders in the browser, then click `一键筛选`.

The first installation runs `npm ci`, installs the browser runtime, verifies/downloads fixed local model assets, and builds the web app. The black service window must remain open while using the browser.

首次安装会执行依赖安装、浏览器运行时安装、本地模型资源校验/下载和网页构建。日常使用双击 `启动网页控制.cmd`，在网页中选择来源目录和结果目录，然后点击“一键筛选”。

## Useful commands

Run commands from the project directory. If you do not want to change directories on Windows, use `npm --prefix "<project-root>" <command>`.

```powershell
npm run doctor          # Check Node, Python, browser, models and Ollama
npm run verify:models  # Verify fixed model assets and SHA-256 digests
npm run test:all       # Run the complete Node test suite
npm run build          # Build the production web app
npm run lint           # Run oxlint
```

Do not double-click `index.html`: the browser UI requires the local control server. Ollama is optional; the basic classifier remains usable without it. An explicitly forced advanced model is never silently replaced.

## Architecture

```text
Browser UI (React/Vite)
        │ localhost control API
        ▼
Control server ── folder scan / progress / copy / manual correction
        │
        ├─ MobileNetV4 image classification
        ├─ MediaPipe face detection + bounded rotation retry
        ├─ YOLOX person boxes + high-resolution tile fallback
        ├─ CLIP scene signals
        └─ Optional local Ollama vision review
```

The classifier separates three questions: whether a real person is present, what the main subject is, and how many recognizable people are supported by the evidence. A statue, toy, poster, screen, hand, or masked face is not treated as a shortcut to a definite count.

## Model and privacy boundary

- Model assets are downloaded locally from `tools/model-assets.js`.
- Model files, photos, generated reports, caches, virtual environments, and output folders are excluded from Git by `.gitignore`.
- The project does not install startup services and does not require background monitoring.
- GPU/NPU availability depends on the target computer, drivers, Windows ML runtime, and available memory. The UI reports the actual provider instead of promising identical performance across computers.
- This repository does not claim commercial-closed-model accuracy or independent human-annotated accuracy. Ambiguous photos can remain `待确认`.

## Project status

The engineering prototype is feature-complete for the current scope: local folder classification, progress reporting, manual correction, safe output handling, model lifecycle controls, hardware evidence, and regression coverage are in place. The latest local validation passed `134/134` Node tests, production build, model verification `21/21`, and project doctor checks.

工程测试版已完成当前范围：本地文件夹分类、进度提示、人工修正、安全输出、模型生命周期控制、设备证据和回归测试均已具备。最近一次本机验证通过 `134/134` 项 Node 测试、生产构建、`21/21` 模型资源校验和项目体检。

## Resume-ready summary

**中文：** 独立设计并实现本地优先的 AI 照片分类工具，整合图像分类、人脸/人体检测、场景语义、可选本地视觉大模型与 CPU/GPU/NPU 设备探测；通过保守置信策略、人工纠错、原图保护、模型资源校验和端到端回归测试，完成从需求拆解到可运行交付的产品闭环。

**English:** Independently designed and built a local-first AI photo organization tool combining image classification, face/person detection, scene semantics, optional local VLM review, and CPU/GPU/NPU-aware inference. Shipped a usable product loop from folder selection and progress feedback to explainable results, human correction, source-file protection, model integrity checks, and end-to-end regression testing.

## License and third-party models

The application source license and third-party model/weight redistribution terms must be reviewed before public release. Model sources, versions, SHA-256 digests, and known redistribution boundaries are documented in `docs/model-sources.md` and `public/models/README.md`.

公开发布前请确认应用源码许可证，并分别复核第三方模型、权重、转换仓库及依赖的再分发条款。来源、版本、SHA-256 和边界记录见 `docs/model-sources.md` 与 `public/models/README.md`。
