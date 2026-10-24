import { modelAssets } from './model-assets.js'
import { verifyAsset } from './asset-install.js'
import { projectRoot } from './runtime-paths.js'

const results = []
for (const asset of modelAssets) results.push(await verifyAsset(projectRoot, asset))
const failed = results.filter(asset => !asset.verified)
console.log(JSON.stringify({ status: failed.length ? 'failed' : 'passed', root: projectRoot, failed, assets: results }, null, 2))
if (failed.length) process.exitCode = 1
