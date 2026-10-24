globalThis.verifyGroupInteractions = async (page) => {
  const report = { generatedAt: new Date().toISOString(), stage: 'T5.7', checks: {}, rounds: [] }
  const check = (name, passed, details = null) => {
    report.checks[name] = { passed: Boolean(passed), details }
    if (!passed) throw new Error(`Acceptance failed: ${name}: ${JSON.stringify(details)}`)
  }
  const names = [
    'similarity_cases/case01_exact_a.png',
    'similarity_cases/case01_exact_b.png',
    'similarity_cases/case03_brightness_a.png',
    'similarity_cases/case03_brightness_b.png',
    'similarity_cases_extra/case14_crop80_b.png',
    'similarity_cases_extra/case16_zoom_b.png',
    'similarity_cases_extra/case19_alt_scene_a_a.png',
    'similarity_cases_extra/case19_alt_scene_a_b.png',
  ]
  const saved = () => page.locator('.workspace-section > .curation-status').filter({ hasText: '\u672c\u5730\u9009\u62e9\u5df2\u4fdd\u5b58' }).waitFor()
  const readStorage = () => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lenssort-ai')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const result = await new Promise((resolve, reject) => {
      const transaction = db.transaction(['photos', 'curation'], 'readonly')
      const photos = transaction.objectStore('photos').getAll()
      const state = transaction.objectStore('curation').get('current')
      transaction.oncomplete = () => resolve({ version: db.version, photos: photos.result.map(({ thumbnail: _thumbnail, ...photo }) => photo), state: state.result ?? null })
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
    return result
  })
  try {
    await page.reload()
    await page.locator('.workspace-section > .curation-status').filter({ hasText: '\u672c\u5730\u9009\u62e9\u5df2\u6062\u590d' }).waitFor()
    await page.getByRole('button', { name: '\u6e05\u9664\u672c\u6b21\u6570\u636e', exact: true }).click()
    await page.locator('.workspace-section > .curation-status').filter({ hasText: '\u7167\u7247\u548c\u672c\u5730\u9009\u62e9\u5df2\u6e05\u9664' }).waitFor()
    await page.locator('input[type=file]').setInputFiles(names.map(name => `E:/ai\u9879\u76ee/data/eval/${name}`))
    await page.locator('.analysis-status').filter({ hasText: '8 \u5f20\u672c\u5730\u7167\u7247' }).waitFor()
    check('importEightPublicImages', (await readStorage()).photos.length === 8)
    check('threeGroupsVisible', await page.locator('.similar-group-card').count() === 3)
    const group = page.locator('.similar-group-card').filter({ hasText: 'case01_exact_a.png' })
    const currentTitle = () => group.locator('.group-current').textContent()
    const initial = await currentTitle()
    for (let round = 0; round < 3; round += 1) {
      await group.getByRole('button', { name: '\u5c55\u5f00\u76f8\u4f3c\u7ec4', exact: false }).click()
      const members = group.locator('.group-member')
      check(`round${round + 1}Expand`, await members.count() === 4)
      const visited = []
      for (let offset = 0; offset < 4; offset += 1) {
        visited.push(await currentTitle())
        await group.getByRole('button', { name: '\u6362\u4e00\u5f20', exact: true }).click()
        await saved()
      }
      check(`round${round + 1}Cycle`, new Set(visited).size === 4 && await currentTitle() === visited[0], visited)
      await group.getByRole('button', { name: '\u6362\u4e00\u5f20', exact: true }).click()
      await saved()
      const chosen = await currentTitle()
      await group.getByRole('button', { name: '\u4fdd\u7559\u8fd9\u5f20', exact: true }).click()
      await saved()
      const before = await readStorage()
      await page.reload()
      await group.getByRole('status').filter({ hasText: '\u5df2\u4fdd\u7559\u5f53\u524d\u7167\u7247' }).waitFor()
      const after = await readStorage()
      check(`round${round + 1}Refresh`, await currentTitle() === chosen && JSON.stringify(before.state) === JSON.stringify(after.state))
      await group.getByRole('button', { name: '\u5c55\u5f00\u76f8\u4f3c\u7ec4', exact: false }).click()
      const chosenName = chosen.replace('\u5f53\u524d\u5019\u9009\uff1a', '')
      const chosenRow = group.locator('.group-member').filter({ hasText: chosenName })
      await chosenRow.getByRole('button', { name: '\u8df3\u8fc7', exact: true }).click()
      await saved()
      check(`round${round + 1}Skip`, (await chosenRow.textContent()).includes('\u5df2\u8df3\u8fc7'))
      await chosenRow.getByRole('button', { name: '\u64a4\u9500\u9009\u62e9', exact: true }).click()
      await saved()
      check(`round${round + 1}Undo`, Object.keys((await readStorage()).state.feedback).length === 0)
      await group.getByRole('button', { name: '\u6062\u590d\u7cfb\u7edf\u63a8\u8350', exact: true }).click()
      await saved()
      check(`round${round + 1}Reset`, await currentTitle() === initial)
      await group.getByRole('button', { name: '\u6536\u8d77\u76f8\u4f3c\u7ec4', exact: true }).click()
      report.rounds.push({ round: round + 1, completed: true, candidate: chosen })
    }
    await group.getByRole('button', { name: '\u4fdd\u7559\u8fd9\u5f20', exact: true }).click()
    await saved()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '\u5bfc\u51fa JSON', exact: true }).click()
    const download = await downloadPromise
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    check('jsonExportKeptPhoto', exported.photos?.some(photo => photo.title === initial.replace('\u5f53\u524d\u5019\u9009\uff1a', '')) || exported.selected?.some(photo => photo.title === initial.replace('\u5f53\u524d\u5019\u9009\uff1a', '')) || (Array.isArray(exported) && exported.some(photo => photo.title === initial.replace('\u5f53\u524d\u5019\u9009\uff1a', ''))), exported)
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put
      window.__originalCurationPut = original
      IDBObjectStore.prototype.put = function(...args) {
        if (this.name === 'curation') throw new DOMException('Injected test failure', 'QuotaExceededError')
        return original.apply(this, args)
      }
    })
    await group.getByRole('button', { name: '\u6362\u4e00\u5f20', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '\u672c\u5730\u9009\u62e9\u4fdd\u5b58\u5931\u8d25' }).waitFor()
    check('failureVisible', await page.getByRole('button', { name: '\u91cd\u8bd5\u4fdd\u5b58\u9009\u62e9', exact: true }).isEnabled())
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.__originalCurationPut; delete window.__originalCurationPut })
    await page.getByRole('button', { name: '\u91cd\u8bd5\u4fdd\u5b58\u9009\u62e9', exact: true }).click()
    await saved()
    check('retrySaved', await page.getByRole('alert').filter({ hasText: '\u672c\u5730\u9009\u62e9\u4fdd\u5b58\u5931\u8d25' }).count() === 0)
    await page.getByRole('button', { name: '\u8fd0\u884c\u7ec4\u5185 CLIP \u9a8c\u8bc1', exact: true }).click()
    await page.getByRole('button', { name: '\u8fd0\u884c\u7ec4\u5185 CLIP \u9a8c\u8bc1', exact: true }).waitFor({ timeout: 120000 })
    const clip = (await readStorage()).photos.filter(photo => photo.clipSimilarityStatus === 'succeeded')
    check('clipReferencesPersisted', clip.length === 5 && clip.every(photo => photo.clipRepresentativeId && photo.clipRepresentativeTitle), clip.map(photo => ({ title: photo.title, reference: photo.clipRepresentativeTitle, similarity: photo.clipSimilarityToRepresentative })))
    const clipBefore = JSON.stringify(clip.map(photo => ({ id: photo.id, score: photo.clipSimilarityToRepresentative, reference: photo.clipRepresentativeId })))
    await group.getByRole('button', { name: '\u6362\u4e00\u5f20', exact: true }).click()
    await saved()
    const clipAfter = (await readStorage()).photos.filter(photo => photo.clipSimilarityStatus === 'succeeded')
    check('manualChoiceDoesNotChangeClip', clipBefore === JSON.stringify(clipAfter.map(photo => ({ id: photo.id, score: photo.clipSimilarityToRepresentative, reference: photo.clipRepresentativeId }))))
    await page.setViewportSize({ width: 390, height: 844 })
    check('mobileNoHorizontalOverflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: '\u6e05\u9664\u672c\u6b21\u6570\u636e', exact: true }).click()
    await page.locator('.workspace-section > .curation-status').filter({ hasText: '\u7167\u7247\u548c\u672c\u5730\u9009\u62e9\u5df2\u6e05\u9664' }).waitFor()
    const cleared = await readStorage()
    check('clearBothStores', cleared.photos.length === 0 && cleared.state === null, cleared)
    await page.reload()
    await page.locator('.demo-tag').filter({ hasText: '\u6f14\u793a\u6570\u636e' }).waitFor()
    check('clearSurvivesRefresh', (await readStorage()).photos.length === 0 && (await readStorage()).state === null)
    report.passed = true
  } catch (error) {
    report.passed = false
    report.error = error.message
  } finally {
    await page.evaluate(report => { window.__t57Report = report }, report)
  }
}
