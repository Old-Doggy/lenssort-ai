# 本地模型资源

在项目根目录执行 `npm run setup:models` 下载固定版本资源，`npm run verify:models` 复核文件大小与 SHA-256。唯一清单位于 `tools/model-assets.js`。

已有但不匹配的文件不会被静默覆盖；确认需要替换时执行 `npm run setup:models -- --repair`。下载失败可重新执行，已校验资源会跳过。模型权重不上传 GitHub；来源许可证由下载者复核。

MediaPipe 人脸检测/关键点资源也包含在清单中。Ollama 视觉模型需另外安装，项目不会自动下载数 GB 大模型。旧 `legacy=1` 实验界面不属于默认安装支持范围；主入口为网页文件夹控制台。
