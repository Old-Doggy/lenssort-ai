import { writeFile, mkdir } from 'node:fs/promises'

const resources = [
  'https://raw.githubusercontent.com/amd/RyzenAI-SW/main/WinML/CNN/ResNet/README.md',
  'https://raw.githubusercontent.com/amd/RyzenAI-SW/main/WinML/CNN/ResNet/requirements.txt',
  'https://raw.githubusercontent.com/amd/RyzenAI-SW/main/CNN-examples/image_classification/image_classification.py',
  'https://raw.githubusercontent.com/amd/RyzenAI-SW/main/CNN-examples/image_classification/README.md',
  'https://raw.githubusercontent.com/amd/RyzenAI-SW/main/CNN-examples/image_classification/vaiml_config.json',
  'https://api.github.com/repos/amd/RyzenAI-SW/contents/WinML/CNN/ResNet/python',
  'https://ryzenai.docs.amd.com/en/latest/inst.html',
  'https://pypi.org/pypi/onnxruntime-winml/json',
]
const results = []
for (const url of resources) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) })
    let text = await response.text()
    if (url.endsWith('/json')) {
      const info = JSON.parse(text)
      text = JSON.stringify({ version: info.info?.version, requiresPython: info.info?.requires_python, files: info.urls?.map(file => ({ filename: file.filename, url: file.url, size: file.size })) })
    } else if (url.endsWith('.html')) {
      const links = [...text.matchAll(/href="([^"]+)"/g)].map(match => match[1]).filter(link => /\.exe|\.zip/.test(link))
      text = text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      text = text.slice(text.indexOf('Prerequisites')) + '\nDOWNLOAD LINKS: ' + JSON.stringify(links)
    }
    results.push({ url, status: response.status, text })
    console.log(url, response.status, text.slice(0, 16000))
  } catch (error) { results.push({ url, error: error.message }); console.log(url, error.message) }
}
await mkdir('artifacts', { recursive: true })
await writeFile('artifacts/accelerator-source-check.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2))
