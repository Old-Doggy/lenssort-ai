# LensSort AI

<p align="center">
  <strong>Put photos in a folder. LensSort sorts them.</strong><br />
  A local-first AI photo classifier with browser control, human correction, and source-file protection
</p>

<p align="center">
  <a href="https://github.com/Old-Doggy/lenssort-ai/actions/workflows/validate.yml"><img src="https://github.com/Old-Doggy/lenssort-ai/actions/workflows/validate.yml/badge.svg" alt="Build status" /></a>
  <img src="https://img.shields.io/badge/runtime-local--first-0f766e" alt="Local-first runtime" />
  <img src="https://img.shields.io/badge/license-MIT-7c3aed" alt="MIT license" />
  <img src="https://img.shields.io/badge/platform-Windows-f59e0b" alt="Windows platform" />
</p>

<p align="center">
  <a href="README.zh-CN.md">中文文档</a> ·
  <a href="docs/technical-overview.md">Technical overview</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="src/assets/lenssort-cover.svg" alt="LensSort AI photo sorting workspace" width="900" />
</p>

## What it does

LensSort AI is built for local photo folders containing a few hundred images. Choose an input folder and an output folder, click **One-click sort**, and let the app analyze and copy photos into categories

Typical categories include `Single person`, `Multiple people`, `People + scenery`, `Scenery`, `Animals`, `Plants`, `Other`, and `Needs review`

## Why use it

- **Browser-controlled**: choose folders, devices, and models without uploading photos one by one
- **Automatic classification**: wait for files to finish copying, then analyze them in the selected folder
- **Human-in-the-loop**: preview, delete output copies, or correct a category from the browser
- **Source-safe**: classification creates output copies; originals are not moved, renamed, or deleted
- **Local-first**: basic classification works without Ollama and images are not sent to a cloud API
- **Assisted recommendations**: technical quality screening helps reduce browsing time without pretending to know personal taste

Uncertain photos go to `Needs review` instead of being forced into a confident-looking mistake

## Quick start on Windows

### 1. Install

Install Node.js `22.12+`, clone the repository, and double-click `首次安装.cmd`

The script installs dependencies, the browser runtime, base model assets, and the production build. At the end, you can choose whether to prepare a local vision-language model

### 2. Optional: local image explanations

Double-click `安装本地视觉模型.cmd`

It installs the official Ollama package when needed and downloads `Qwen 3.5 4B` by default. The weights are large and have separate terms, so they are not bundled in GitHub

### 3. Sort photos

Double-click `启动网页控制.cmd`, open the local URL it prints, choose folders, and click **One-click sort**

Do not double-click `index.html`: folder access and progress updates require the local control service

## Model choices

| Mode | Best for |
| --- | --- |
| Basic analysis | No Ollama, fastest path, lower-resource machines |
| Qwen 3.5 4B | Recommended daily balance of speed, resources, and descriptions |
| Gemma 3 4B | Compatibility baseline |
| Qwen 3.5 9B | Opt-in precision-first mode with higher memory and VRAM needs |

The browser shows installation status and resource guidance. Basic classification remains available when a vision-language model is missing or resources are limited

## Boundaries

- This is a local engineering tool, not a promise of perfect recognition for difficult photos
- `Assisted recommendations` reduce review time; they do not replace personal taste
- NPU availability depends on Windows ML, drivers, and hardware; the UI reports only verified paths
- Keep the local control service on the local machine; do not expose it to the public internet
- Third-party models and dependencies may have separate licenses; see [`docs/model-sources.md`](docs/model-sources.md)

## Documentation

- [`Technical overview`](docs/technical-overview.md): architecture, models, hardware, privacy, and validation boundaries
- [`Model resources`](public/models/README.md): base assets and local vision-model setup
- [`Contributing`](CONTRIBUTING.md): development, testing, and pull-request rules
- [`Security and privacy`](SECURITY.md): reporting and local-service boundaries

## License

The application source is released under the MIT License. See [`LICENSE`](LICENSE)
