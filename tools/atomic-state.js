import { randomUUID } from 'node:crypto'
import { unlink, writeFile, rename } from 'node:fs/promises'

const retryableErrors = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM'])
const retryCount = 7

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function writeAtomicJson(destination, value, options = {}) {
  const temporary = destination + '.' + randomUUID() + '.tmp'
  const replace = options.replace ?? rename
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' })
    let lastError
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        await replace(temporary, destination)
        return
      } catch (error) {
        lastError = error
        if (!retryableErrors.has(error.code) || attempt === retryCount) throw error
        await sleep(Math.min(25 * 2 ** (attempt - 1), 250))
      }
    }
    throw lastError
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
