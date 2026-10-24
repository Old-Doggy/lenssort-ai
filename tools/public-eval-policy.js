export function approvedPublicLicense(shortName, licenseUrl) {
  const name = shortName.trim().toLowerCase()
  if (['public domain', 'cc0', 'cc0 1.0'].includes(name)) return 'public-domain-or-cc0'
  if (!/^cc[ -]by(?:[ -]sa)?(?:[ -]\d\.\d)?$/.test(name)) return null
  let url
  try { url = new URL(licenseUrl) } catch { return null }
  if (url.protocol !== 'https:' || !['creativecommons.org', 'www.creativecommons.org'].includes(url.hostname)) return null
  if (!/^\/licenses\/by(?:-sa)?\/\d\.\d\/?$/.test(url.pathname)) return null
  if (name.includes('sa') !== url.pathname.includes('by-sa')) return null
  return name
}

export function boundedCollectionInteger(value, name, maximum) {
  if (!/^\d+$/.test(value)) throw new Error(name + ' must be an integer')
  const number = Number(value)
  if (number < 1 || number > maximum) throw new Error(name + ' must be between 1 and ' + maximum)
  return number
}

export async function readBoundedImage(response, maximumBytes = 12 * 1024 * 1024) {
  const length = Number(response.headers.get('content-length'))
  if (length > maximumBytes) throw new Error('Image declared length exceeds the download limit')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Image response has no body')
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) throw new Error('Image streamed length exceeds the download limit')
      chunks.push(Buffer.from(value))
    }
    if (!total) throw new Error('Empty image body')
    return Buffer.concat(chunks, total)
  } finally { await reader.cancel(); reader.releaseLock() }
}
