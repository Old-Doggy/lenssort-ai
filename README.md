# LensSort AI

<p align="center">
  <strong>A Windows photo sorter I built for my own folders</strong><br />
  Pick a folder, run one batch, and review the result in a local browser page
</p>

<p align="center">
  <a href="https://github.com/Old-Doggy/lenssort-ai/actions/workflows/validate.yml"><img src="https://github.com/Old-Doggy/lenssort-ai/actions/workflows/validate.yml/badge.svg" alt="Build status" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-f59e0b" alt="Windows" />
  <img src="https://img.shields.io/badge/license-MIT-7c3aed" alt="MIT license" />
</p>

<p align="center">
  <a href="README.zh-CN.md">中文说明</a> ·
  <a href="docs/getting-started.md">Getting started</a> ·
  <a href="docs/troubleshooting.md">Troubleshooting</a> ·
  <a href="docs/technical-overview.md">Technical notes</a>
</p>

<p align="center">
  <img src="src/assets/lenssort-cover.svg" alt="LensSort AI local photo sorting page" width="900" />
</p>

## Why I made it

I wanted a simpler way to deal with a few hundred photos after a trip or a photo walk. The first version was only a classifier. I kept the browser control page because it makes the important actions easy to see: choose folders, start one batch, inspect a photo, and correct a mistake.

LensSort works on copies in an output folder. The original folder is left alone, so it is safe to review the result before doing anything else with the photos.

## What it does

- Scans the selected folder and classifies photos into `Single person`, `Multiple people`, `People + scenery`, `Scenery`, `Animals`, `Plants`, `Other`, or `Needs review`
- Shows progress while one batch is running, then stops by itself
- Opens thumbnails and larger previews in the browser
- Lets you move an output copy to another category or delete that output copy
- Reads the current disk state again when you click **Refresh current folder**
- Offers **Assisted recommendations** as a technical shortcut for review; it does not claim to know your taste
- Can use an optional local vision model to write a short image explanation

Basic classification works without Ollama. Photos stay on the computer and are not sent to a cloud image API.

## Quick start on Windows

### 1. Install the project

Install [Node.js 22.12 or newer](https://nodejs.org/), download or clone this repository, then double-click `首次安装.cmd`.

The first-time setup script will:

1. Install the locked npm dependencies
2. Install the local Chromium runtime
3. Download and verify the small base model assets
4. Build the web page and run the environment check

The script asks whether you want to install the optional vision model. Choose `N` if you only want basic classification.

### 2. Start the browser page

Double-click `启动网页控制.cmd`. Keep the black command window open while using LensSort. It opens the local page automatically; if it does not, open the `http://127.0.0.1:4317` address printed in that window.

Do not double-click `index.html`. The browser page needs the local control service for folder access, progress, previews, and corrections.

### 3. Run a batch

1. Choose the photo source folder
2. Choose a separate output folder
3. Pick `自动选择` or a detected CPU / GPU / NPU device
4. Click **一键筛选**
5. Wait for **分类完成，已自动停止**

The batch processes the files that are present when it starts. It does not keep watching the folder after completion. Put new photos in the folder and click **一键筛选** again when you want another batch.

### 4. Review the result

Use the category buttons to browse. Open **查看详情** to see the photo, the plain-language explanation, and the optional technical details. If a label is wrong, use **修改分类**. The change moves only the output copy; the source photo stays where it is.

## Optional image explanations

The classifier and the natural-language explanation are separate pieces.

To add the explanation feature, double-click `安装本地视觉模型.cmd`. It installs the official Ollama application when needed and prepares `qwen3.5:4b` by default. The model is several gigabytes, so it is downloaded on the first install and is not stored in this repository.

You can also choose another supported model from the page after installing it:

| Model | Use it when |
| --- | --- |
| Basic analysis | You want the smallest setup and fastest classification |
| Qwen 3.5 4B | You want the recommended daily balance |
| Gemma 3 4B | You want the compatibility baseline |
| Qwen 3.5 9B | You have more memory and VRAM and want to try the larger model |

The page shows whether a model is installed and gives a resource suggestion. A forced model choice is available, but it does not download a missing model and may run out of memory.

## Hardware notes

The page detects the devices available on the current Windows computer. A device being listed does not by itself prove that a photo used it. The page only says that NPU execution was verified when the result contains the required runtime evidence.

The optional Ollama model has its own device status. It should not be confused with the device used by the basic classifier.

## If something goes wrong

- `首次安装.cmd` stops: run `运行体检.cmd` and read the first failed check
- The browser does not open: keep the launcher window open and manually open `http://127.0.0.1:4317`
- The page says the service is unavailable: run `启动网页控制.cmd` from the project folder, not from a shortcut to another directory
- Natural-language explanations are unavailable: basic classification still works; install Ollama and the optional model if you need them
- Chinese paths look wrong: stop the current batch, click **选择文件夹** again, then refresh the page
- A model is missing: use `安装本地视觉模型.cmd` or follow [`docs/troubleshooting.md`](docs/troubleshooting.md)

## Development

```powershell
npm ci
npm run doctor
npm run test:all
npm run build
npm run lint
```

The main page is `FolderControl`. The local service is in `tools/control-server.js`. Generated outputs, model weights, caches, test fixtures, and personal paths are ignored by Git.

More detail is available in [`docs/technical-overview.md`](docs/technical-overview.md), [`public/models/README.md`](public/models/README.md), and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Limits

This is a practical local tool, not a promise that every difficult photo will be labelled correctly. Small faces, masks, statues, animals in unusual poses, rotated images, blur, and mixed scenes can still need human review. That is why `Needs review`, previews, correction, and source-file protection are part of the normal workflow.

Third-party models and dependencies may have their own licences. See [`docs/model-sources.md`](docs/model-sources.md).

## License

The application source is released under the MIT License. See [`LICENSE`](LICENSE).
