# LensSort AI

<p align="center">
  <strong>给喜欢拍照的人做的本地照片整理工具</strong><br />
  把整理照片这件重复的小事交给 LensSort，再把时间留给真正值得看的照片
</p>

<p align="center">
  <a href="https://github.com/Old-Doggy/lenssort-ai/actions/workflows/validate.yml"><img src="https://github.com/Old-Doggy/lenssort-ai/actions/workflows/validate.yml/badge.svg" alt="构建状态" /></a>
  <img src="https://img.shields.io/badge/平台-Windows-f59e0b" alt="Windows" />
  <img src="https://img.shields.io/badge/许可证-MIT-7c3aed" alt="MIT 许可证" />
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="docs/getting-started.zh-CN.md">安装与使用</a> ·
  <a href="docs/troubleshooting.zh-CN.md">常见问题</a> ·
  <a href="docs/technical-overview.md">技术说明</a>
</p>

<p align="center">
  <img src="src/assets/lenssort-cover.svg" alt="LensSort AI 本地照片分类工具示意图" width="900" />
</p>

## 为什么做这个

我平时喜欢拍照，也一直觉得整理照片是摄影里最容易被拖延的一环。一次拍完几百张，真正花时间的往往不是按下快门，而是把人物、风景、动物这些照片从混在一起的文件夹里分出来。于是我做了 LensSort，想先把这部分重复劳动交给本地工具，再留时间慢慢看照片。

我也曾经想让它直接替我挑出“最好看”的照片，但试下来发现，审美会受到拍摄目的、当时的记忆和个人偏好的影响，很难用一个分数说清楚。所以现在的重点是把分类做得清楚、结果能够复查；辅助推荐只帮我缩小浏览范围，最后留下哪些照片，还是由自己决定。

## 现在能做什么

- 按 `单人`、`多人`、`人物与风景`、`风景`、`动物`、`植物`、`其他`、`待确认` 分类
- 在网页里选文件夹、看进度、打开大图、修改分类和删除分类副本
- 分类只生成副本，不移动、不改名、不删除来源原图
- 一批处理完自动停止；新增照片后，再点一次“一键筛选”
- 点击“刷新当前文件夹”重新核对磁盘文件，移除失效的结果卡片
- 可选用本地视觉模型补充图片解释，不把照片发到云端 API

## 先跑起来

目前主要支持 Windows。先安装 [Node.js 22.12 或更新版本](https://nodejs.org/)，下载仓库 ZIP 并解压，或使用 Git 克隆。

1. 双击 `首次安装.cmd`，等依赖、基础模型下载和网页构建完成；最后询问是否安装视觉模型，想先试用就选 `N`
2. 双击 `启动网页控制.cmd`，保留启动窗口；网页没自动打开时，打开窗口中显示的地址，默认是 `http://127.0.0.1:4317`
3. 选择照片来源和一个独立的结果文件夹，点击 **一键筛选**，等待 **分类完成，已自动停止**

不要直接打开 `index.html`，文件夹访问需要本地服务。首次安装需要联网下载资源，日常照片分析在本机进行，不需要开机启动。

完整操作、退出方式和更新方法见 [安装与使用](docs/getting-started.zh-CN.md)，遇到问题先看 [常见问题](docs/troubleshooting.zh-CN.md)。

## 要不要装大模型

基础分类不需要 Ollama。想要本地看图解释和视觉复核，可以双击 `安装本地视觉模型.cmd`，按向导安装 Ollama 并下载默认的 `Qwen 3.5 4B`。

| 选项 | 我的使用建议 |
| --- | --- |
| 基础分析 | 先跑通流程，或电脑资源比较紧张时用 |
| Qwen 3.5 4B | 日常优先尝试，兼顾效果与资源占用 |
| Gemma 3 4B | 另一个可选方案，可以结合自己的照片比较 |
| Qwen 3.5 9B | 资源充足时再试，更大不保证每张照片都更准 |

网页会显示安装情况和资源建议。基础分类设备与 Ollama 模型设备分开显示；选中了 NPU 也不代表已经用上，实际运行证据会在处理后给出。

## 还有哪些不足

口罩、遮挡、雕像、远处的小人、模糊和复杂场景仍可能分错，需要人工确认。辅助推荐也只是帮忙缩小浏览范围，不是审美结论。欢迎通过 Issue 提供复现步骤，分享前记得去掉个人照片和路径。

## 其他文档

- [技术说明](docs/technical-overview.md)：结构、模型和硬件路径
- [模型资源](public/models/README.md) · [模型来源与许可](docs/model-sources.md)
- [参与开发](CONTRIBUTING.md) · [安全与隐私](SECURITY.md)

源代码使用 [MIT License](LICENSE)，第三方模型按各自许可使用
