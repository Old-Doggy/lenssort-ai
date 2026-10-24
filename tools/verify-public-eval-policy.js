import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { approvedPublicLicense, boundedCollectionInteger, readBoundedImage } from './public-eval-policy.js'

const checks = []
assert.equal(approvedPublicLicense('CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'), 'cc by 4.0')
assert.equal(approvedPublicLicense('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'), 'cc by-sa 4.0')
assert.equal(approvedPublicLicense('Public domain', ''), 'public-domain-or-cc0')
for (const name of ['CC BY-NC 4.0', 'CC BY-ND 4.0', 'CC BY-SA-NC 4.0', 'unknown']) {
  assert.equal(approvedPublicLicense(name, 'https://creativecommons.org/licenses/by/4.0/'), null)
}
assert.equal(approvedPublicLicense('CC BY 4.0', 'https://example.com/licenses/by/4.0/'), null)
assert.equal(approvedPublicLicense('CC BY 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'), null)
checks.push('explicit license names and official URLs required; restricted and mismatched licenses rejected')
assert.equal(boundedCollectionInteger('30', 'limit', 30), 30)
for (const value of ['0', '31', 'Infinity', '2x', '-1', '']) assert.throws(() => boundedCollectionInteger(value, 'limit', 30))
checks.push('finite integer collection limits enforced')
assert.deepEqual(await readBoundedImage(new Response('image'), 5), Buffer.from('image'))
await assert.rejects(readBoundedImage(new Response('image', { headers: { 'content-length': '6' } }), 5), /declared length/)
await assert.rejects(readBoundedImage(new Response('oversized'), 5), /streamed length/)
await assert.rejects(readBoundedImage(new Response(''), 5), /Empty image/)
await assert.rejects(readBoundedImage(new Response(null), 5), /no body/)
checks.push('actual streamed bytes limited even without a Content-Length header')
const report = { status: 'passed', createdAt: new Date().toISOString(), checks, scope: 'Local policy unit tests; not successful public download, authorization review or photo accuracy evidence' }
await writeFile('artifacts/public-eval-policy-verification.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
