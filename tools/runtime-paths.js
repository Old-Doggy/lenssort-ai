import path from 'node:path'
import { fileURLToPath } from 'node:url'
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function resolveInside(root, relative) {
  const destination = path.resolve(root, relative)
  const resolved = path.relative(path.resolve(root), destination)
  if (!resolved || resolved.startsWith('..' + path.sep) || resolved === '..' || path.isAbsolute(resolved)) throw new Error('路径必须位于项目目录内部')
  return destination
}
