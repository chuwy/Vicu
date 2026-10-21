// PP (contract section 5.3): "when I get home" typed in the composer and in Quick Entry, for a place a
// phone saved.
//
//   Setup. Writes `place.ui-gym` (Gym) and `place.ui-studio` (Studio) into the test user's preferences
//      carrier on the server, the way a phone saves a place, and has the app sync them. The names are
//      ones a phone run on the shared server does not save (it saves Home).
//   A. Composer: "PP call mom when I get to the gym" highlights the phrase, shows a place chip
//      "Arrive: Gym", and Enter saves the task "PP call mom" with `location_reminder.<id>` (Gym, arrive,
//      200 m), which reaches the carrier on the server.
//   B. Quick Entry: "PP water plants when I leave the studio" shows "Leave: Studio" and saves the
//      reminder too.
//   C. Dismissing the place chip keeps the words in the title and sets no reminder.
//
// The tasks it creates are deleted, and their reminders and the two places are reset, at the end.

export const meta = {
  id: 'PP',
  wave: 6,
  title: 'Place phrases: "when I get home" in the composer and Quick Entry sets the location reminder',
}

const MARKER = /<!--[ \t\r\n]*vicu-prefs:v(\d+):([A-Za-z0-9_-]+={0,2})[ \t\r\n]*-->/
const PLACES = { 'place.ui-gym': { name: 'Gym' }, 'place.ui-studio': { name: 'Studio' } }
const PHRASE_HIGHLIGHT = (root, selector, phrase) =>
  root.evaluate(({ selector, phrase }) =>
    [...document.querySelectorAll(selector)].some((el) => el.textContent.replace(/\u00a0/g, ' ').toLowerCase().includes(phrase)), { selector, phrase })

const decode = (b64) => JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
const encode = (doc) => `<!-- vicu-prefs:v1:${Buffer.from(JSON.stringify(doc), 'utf8').toString('base64url')} -->`
const items = (body) => (Array.isArray(body) ? body : (body?.items ?? []))

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()
  const created = []

  // The carrier as the server has it: the task and its document.
  const readCarrier = async () => {
    const found = items(await h.api('GET', '/tasks?q=vicu-prefs&per_page=50'))
      .filter((t) => t.created_by?.id === h.ids.me?.id || !h.ids.me)
      .map((t) => ({ task: t, marker: String(t.description ?? '').match(MARKER) }))
      .filter((c) => c.marker)
      .sort((a, b) => a.task.id - b.task.id)
    return found[0] ? { task: found[0].task, doc: decode(found[0].marker[2]) } : null
  }
  // Writes entries as a phone would: each with a revision newer than the document's.
  const writeEntries = async (values) => {
    const now = Date.now()
    let carrier = await readCarrier()
    const doc = carrier?.doc ?? { version: 1, entries: {} }
    const wall = Math.max(now, ...Object.values(doc.entries).map((e) => e.revision.wall_time_ms))
    let counter = 0
    for (const [key, value] of Object.entries(values)) {
      doc.entries[key] = { value, revision: { wall_time_ms: wall + 1, counter: counter++, device_id: 'ui-verify-phone' } }
    }
    if (carrier) {
      await h.api('PATCH', `/tasks/${carrier.task.id}`, { description: encode(doc) })
    } else {
      await h.api('POST', `/projects/${h.ids.inbox}/tasks`, {
        title: 'Vicu preferences (sync metadata — do not delete)',
        description: encode(doc),
        done: true,
      })
    }
  }
  const appValues = () => page.evaluate(async () => (await window.api.getSyncedPrefs()).values)
  const syncApp = async () => {
    await page.evaluate(() => window.api.syncSyncedPrefs())
    await h.wait(300)
  }
  const waitForTask = async (title) => {
    for (let i = 0; i < 30; i++) {
      const hit = items(await h.api('GET', `/tasks?q=${encodeURIComponent(title)}&per_page=50`)).find((t) => t.title === title && !created.includes(t.id))
      if (hit) {
        created.push(hit.id)
        return hit
      }
      await h.wait(250)
    }
    return null
  }
  const waitForReminder = async (taskId) => {
    for (let i = 0; i < 20; i++) {
      const value = (await appValues())[`location_reminder.${taskId}`]
      if (value) return value
      await h.wait(250)
    }
    return null
  }
  const input = () => page.getByPlaceholder('New task').first()
  const chipsOf = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-chip-type]')].map((el) => ({
        type: el.getAttribute('data-chip-type'),
        text: el.textContent.replace(/×/g, '').trim(),
      })),
    )
  const openComposer = async () => {
    await h.goto('/inbox')
    await h.dismiss()
    await page.locator('button[aria-label="New task"]').last().click()
    await h.wait(400)
    await input().click()
  }

  try {
    // ---- Setup: two places a phone saved ---------------------------------------------------------
    await writeEntries(PLACES)
    await syncApp()
    await h.assert('the app reads the places a phone saved', async () => {
      const values = await appValues()
      return { ok: values['place.ui-gym']?.name === 'Gym' && values['place.ui-studio']?.name === 'Studio', detail: JSON.stringify(Object.keys(values)) }
    })

    // ---- A. Composer ------------------------------------------------------------------------------
    await openComposer()
    await h.type('PP call mom when I get to the gym', { delay: 15 })
    await h.wait(500)
    await h.capture('composer-typed')
    await h.assert('the composer shows the place chip "Arrive: Gym"', async () => {
      const chips = await chipsOf()
      return { ok: chips.some((c) => c.type === 'place' && c.text === 'Arrive: Gym'), detail: JSON.stringify(chips) }
    })
    await h.assert('the phrase is highlighted', async () =>
      PHRASE_HIGHLIGHT(page, '[aria-hidden="true"] span[style*="background"]', 'when i get to the gym'))
    await h.key('Enter')
    const a = await waitForTask('PP call mom')
    await h.assert('the composer saved the title without the phrase', async () => ({ ok: !!a, detail: a ? a.title : 'no task "PP call mom"' }))
    if (a) {
      const reminder = await waitForReminder(a.id)
      await h.assert('the composer set the location reminder at Gym, arriving, 200 m', async () => ({
        ok: reminder?.place === 'ui-gym' && reminder?.trigger === 'arrive' && reminder?.radius_m === 200,
        detail: JSON.stringify(reminder),
      }))
      await syncApp()
      await h.assert('the reminder reached the carrier on the server, for the phone', async () => {
        const entry = (await readCarrier())?.doc.entries[`location_reminder.${a.id}`]
        return { ok: entry?.value?.place === 'ui-gym' && entry?.value?.trigger === 'arrive', detail: JSON.stringify(entry ?? null) }
      })
    }

    // ---- C. Dismissing the chip ---------------------------------------------------------------------
    await openComposer()
    await h.type('PP lock the door when I leave the gym', { delay: 15 })
    await h.wait(400)
    await page.locator('[data-chip-type="place"] button').first().click()
    await h.wait(300)
    await h.assert('a dismissed place chip is gone', async () => !(await chipsOf()).some((c) => c.type === 'place'))
    await input().click()
    await h.key('End')
    await h.key('Enter')
    const c = await waitForTask('PP lock the door when I leave the gym')
    await h.assert('the words stay in the title', async () => ({ ok: !!c, detail: c ? c.title : 'no task with the full title' }))
    if (c) {
      await h.wait(800)
      await h.assert('and no reminder is set', async () => !(await appValues())[`location_reminder.${c.id}`])
    }

    // ---- B. Quick Entry ---------------------------------------------------------------------------
    const qe = await h.showQuick('entry')
    await h.wait(800)
    await qe.keyboard.type('PP water plants when I leave the studio', { delay: 20 })
    await h.wait(500)
    await h.capture('quick-entry', { page: qe, transparent: true })
    await h.assert('Quick Entry shows the place chip "Leave: Studio"', async () => {
      const chips = await qe.evaluate(() => [...document.querySelectorAll('.parse-chip')].map((el) => [el.getAttribute('data-chip-type'), el.textContent.replace(/×/g, '').trim()]))
      return { ok: chips.some(([type, text]) => type === 'place' && text === 'Leave: Studio'), detail: JSON.stringify(chips) }
    })
    await h.assert('Quick Entry highlights the phrase', async () => PHRASE_HIGHLIGHT(qe, '.token-place', 'when i leave the studio'))
    await qe.keyboard.press('Enter')
    const b = await waitForTask('PP water plants')
    await h.assert('Quick Entry saved the title without the phrase', async () => ({ ok: !!b, detail: b ? b.title : 'no task "PP water plants"' }))
    if (b) {
      const reminder = await waitForReminder(b.id)
      await h.assert('Quick Entry set the location reminder at Studio, leaving', async () => ({
        ok: reminder?.place === 'ui-studio' && reminder?.trigger === 'leave' && reminder?.radius_m === 200,
        detail: JSON.stringify(reminder),
      }))
    }
  } finally {
    await h.dismiss().catch(() => {})
    for (const id of created) {
      await page.evaluate((key) => window.api.setSyncedPreference(key, null), `location_reminder.${id}`).catch(() => {})
      await h.api('DELETE', `/tasks/${id}`).catch(() => {})
    }
    await syncApp().catch(() => {})
    await writeEntries({ 'place.ui-home': null, 'place.ui-work': null, 'place.ui-gym': null, 'place.ui-studio': null }).catch(() => {})
  }
}
