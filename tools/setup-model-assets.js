import { installAsset } from './asset-install.js'
import { modelAssets } from './model-assets.js'
import { projectRoot } from './runtime-paths.js'

const repair = process.argv.includes('--repair')
for (const asset of modelAssets) {
  try { console.log(JSON.stringify(await installAsset(projectRoot, asset, { repair }))) }
  catch (error) { console.error(JSON.stringify({ id: asset.id, path: asset.path, status: 'failed', error: error.message })); process.exitCode = 1; break }
}
if (!process.exitCode) console.log(JSON.stringify({ status: 'passed', note: 'Ollama vision models are optional and are not downloaded by this script.' }))
