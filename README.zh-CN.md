# LensSort AI

<p align="center">
  <strong>把照片放进文件夹，LensSort 负责整理</strong><br />
  本地优先的 AI 照片分类工具，支持网页控制、人工修正和原图保护
</p>

<p align="center">
  <a href="https://github.com/Old-Doggy/lenssort-ai/actions/workflows/validate.yml"><img src="https://github.com/Old-Doggy/lenssort-ai/actions/workflows/validate.yml/badge.svg" alt="构建状态" /></a>
  <img src="https://img.shields.io/badge/运行方式-本地优先-0f766e" alt="本地优先" />
  <img src="https://img.shields.io/badge/许可证-MIT-7c3aed" alt="MIT 许可证" />
  <img src="https://img.shields.io/badge/平台-Windows-f59e0b" alt="Windows 平台" />
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="docs/technical-overview.md">技术总览</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

<p align="center">
  <img src="src/assets/lenssort-cover.svg" alt="LensSort AI 照片整理工作台" width="900" />
</p>

## 它解决什么问题

LensSort AI 面向几百张照片的本地整理场景：选择来源文件夹和输出文件夹，点击 **一键筛选**，照片就会自动分析并复制到分类目录

支持的常见分类包括：`单人`、`多人`、`人物与风景`、`风景`、`动物`、`植物`、`其他` 和 `待确认`

## 核心体验

- **网页控制**：选择文件夹、设备和模型，不需要逐张上传照片
- **自动分类**：照片放入来源文件夹后，系统自动等待文件写入稳定并处理
- **人工可控**：发现错误可以在网页上查看大图、删除输出副本或修改分类
- **原图安全**：分类只复制输出副本，原图不移动、不改名、不删除
- **本地运行**：基础分类不依赖 Ollama，图片不会发送到云端 API
- **辅助推荐**：提供技术质量初筛，不把主观审美包装成准确答案

不确定的照片会进入 `待确认`，而不是被强行归入错误类别

## 三步运行

### 1. 首次安装

安装 Node.js `22.12+`，克隆仓库后双击 `首次安装.cmd`

脚本会安装依赖、浏览器运行时、基础模型并构建网页。最后可选择是否准备本地视觉大模型

### 2. 可选：启用自然语言图片解释

双击 `安装本地视觉模型.cmd`

脚本会在缺少时安装官方 Ollama，并默认下载 `Qwen 3.5 4B`。模型权重较大且有独立许可，因此不直接放入 GitHub

### 3. 开始整理

双击 `启动网页控制.cmd`，打开显示的本地地址，选择文件夹后点击 **一键筛选**

不要直接双击 `index.html`，文件夹访问和进度更新需要本地控制服务

## 模型选择

| 模式 | 适合场景 |
| --- | --- |
| 基础分析 | 不安装 Ollama，速度快，适合低配置电脑 |
| Qwen 3.5 4B | 推荐日常使用，平衡速度、资源和描述能力 |
| Gemma 3 4B | 兼容性基线 |
| Qwen 3.5 9B | 主动选择的精度优先模式，需要更多内存和显存 |

网页会显示安装状态和资源建议；模型不足或资源紧张时，基础分类仍可独立运行

## 重要边界

- 这是本地优先的工程型工具，不承诺所有复杂照片都能正确识别
- `辅助推荐` 只用于减少浏览时间，不代表个人审美判断
- NPU 是否可用取决于 Windows ML、驱动和设备；页面只展示实际探测到的路径
- 本地控制服务只应绑定本机，不要暴露到公网
- 第三方模型和依赖可能有独立许可证，详见 [`docs/model-sources.md`](docs/model-sources.md)

## 文档入口

- [`技术总览`](docs/technical-overview.md)：架构、模型、硬件、隐私和验证边界
- [`模型资源说明`](public/models/README.md)：基础模型和本地视觉模型安装
- [`贡献指南`](CONTRIBUTING.md)：开发、测试和提交要求
- [`安全与隐私`](SECURITY.md)：漏洞报告和本地服务边界

## 许可证

应用源代码采用 MIT License，详见 [`LICENSE`](LICENSE)
