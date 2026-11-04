# Troubleshooting

## The setup window closes or reports an error

Run `运行体检.cmd` from the project folder and read the first check marked `fail`.

- Node.js must be 22.12 or newer
- The project needs a working npm installation
- Repair the browser runtime with `npx playwright install chromium`
- Check base assets with `npm run verify:models`

If a download was interrupted, run `首次安装.cmd` again. Verified files are skipped. Do not copy model weights into GitHub or the source tree.

## The browser page does not open

Keep the command window from `启动网页控制.cmd` open and look for the local address in its output. Open `http://127.0.0.1:4317` manually if needed.

If the port is already in use, close the old LensSort window first. The service is intended for the same computer and should not be exposed to the public internet.

Do not open `index.html` directly. The page needs the local service for folder selection, progress, image previews, and safe file operations.

## The page says that the local service is unavailable

Start the service from the project root, where `package.json` is located. If the page was opened before the service started, refresh the browser after the command window reports the local address.

## Chinese folder names look wrong

Stop the current batch, use the page's **选择文件夹** button again, and then click **刷新当前文件夹**. Avoid pasting a path while a batch is running. Check the displayed path before starting a new batch.

## A photo is missing or an old card remains

After deleting a source photo or an output copy in File Explorer, click **刷新当前文件夹**. The result should then match the files that exist on disk.

## The result is classified incorrectly

Open the photo details and use **修改分类**. This moves the output copy and leaves the source photo unchanged. Difficult cases such as masks, statues, small people, blur, rotation, and mixed scenes can still need manual review; use `待确认` when the evidence is weak.

## The local vision model is unavailable

Basic classification does not need Ollama. For image explanations, run `安装本地视觉模型.cmd` and wait for the model to finish downloading. Then restart `启动网页控制.cmd`.

Useful checks:

```powershell
npm run doctor
ollama list
```

If Ollama is installed but not running, the LensSort launcher tries to start or reuse its local service. It does not stop a service that was already running before LensSort started.

## The computer runs out of memory

Switch to **基础分析** or the 4B model, close other GPU-heavy applications, and retry. The 9B model is optional and needs considerably more memory. Forced model use skips the automatic downgrade safeguard and may fail; it does not download a missing model.

## NPU or GPU is listed but does not show as used

Detection and actual execution are separate. Choose the device, run a batch, and open the technical details of a finished result. The page only marks NPU as verified when the result contains runtime evidence. Drivers, Windows ML support, and the hardware provider must all be available.

## How to report a problem

Include the Windows and Node.js versions, the action sequence, the first error message, and whether one test photo reproduces it. Remove personal folder paths, photos, tokens, and model cache details before opening an issue.
