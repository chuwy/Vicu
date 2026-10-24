// shared-routines: sharing a routine through a project the user already shares (docs/cross-app-semantics-v1.md
// section 6.9).
//
//   A. The routine editor has "Share with": "Only you", Maya (who can edit "Trip to Lisbon") and Sam listed
//      as "Can view only"; the info button explains it.
//   B. A new routine shared with Maya is created in Lisbon, done, with `definition.shared` set; its card says
//      "Shared with Maya and Sam".
//   C. A completion that Maya's phone logged (written here over the API, with her `loggedBy`) shows
//      "Done by Maya" in the Routines day list.
//   D. Ticking the same occurrence again here keeps Maya's record (same state, first record kept, 6.8).
//   E. Choosing "Only you" stops sharing: the carrier moves back to the Inbox without the flag.
//   F. Deleting Lisbon from the project menu names the shared routine in the question (cancelled).
//
// It changes the server (one routine, created and deleted) and deletes the routine in a finally block.
// Run it alone: --scenario shared-routines.
import { createApi, readApiToken } from '../lib.mjs'

export const meta = {
  id: 'SR',
  wave: null,
  title: 'Shared routines: Share with, the shared marks, Done by Maya, stop sharing, the project delete note',
}

const items = (res) => (Array.isArray(res) ? res : (res?.items ?? []))
const MARKER = /<!--[ \t\r\n]*vicu-routine:v1:([A-Za-z0-9_-]+)[ \t\r\n]*-->/
const decode = (description) => {
  const match = (description ?? '').match(MARKER)
  return match ? JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) : null
}
const encode = (payload) => `<!-- vicu-routine:v1:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')} -->`

export default async function run(h) {
  const page = h.page
  const api = createApi(readApiToken())
  const ids = h.ids
  if (!ids.people?.maya || !ids.lisbon) {
    h.emit({ t: 'skip', id: meta.id, message: 'the seed has no collaboration data: run node scripts/ui-verify/seed.mjs' })
    return
  }
  const maya = ids.people.maya
  const name = `Feed the cat ${Date.now().toString(36)}`
  const until = async (fn, timeout = 10000) => {
    const end = Date.now() + timeout
    let last
    while (Date.now() < end) {
      last = await fn().catch(() => undefined)
      if (last) return last
      await h.wait(250)
    }
    return last
  }
  const findCarrier = async () => items(await api.call('GET', `/tasks?q=${encodeURIComponent('vicu-routine:v')}&per_page=200`))
    .find((task) => decode(task.description)?.definition?.name === name)
  let carrierId = null
  /** The delete confirmation setting to put back, once step F changed it. */
  let restoreConfirm

  try {
    await h.resize(1280, 820)
    await h.goto('/routines')
    await h.dismiss()

    // ---- A. The editor ------------------------------------------------------------------------
    await page.getByRole('button', { name: 'New routine' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('Take vitamins').fill(name)
    const share = dialog.getByLabel('Share with')
    await until(async () => (await share.locator('option').count()) > 1)
    const options = await share.locator('option').evaluateAll((list) => list.map((o) => ({ text: o.textContent, disabled: o.disabled })))
    await h.assert('A: Share with lists Only you, Maya, and Sam as view only', {
      ok: options[0]?.text === 'Only you' && options.some((o) => o.text === 'Maya' && !o.disabled) && options.some((o) => /Sam \(Can view only\)/.test(o.text) && o.disabled),
      detail: JSON.stringify(options),
    })
    await dialog.getByRole('button', { name: 'About sharing a routine' }).click()
    await h.assert('A: the info button explains sharing', { ok: await dialog.getByText(/kept in a project you share with that person/).isVisible() })
    await share.selectOption({ label: 'Maya' })
    const keepIn = dialog.getByRole('group', { name: 'Keep in' })
    if (await keepIn.isVisible().catch(() => false)) await keepIn.getByText('Trip to Lisbon').click()
    await h.assert('A: the visible-to line names everyone in Lisbon', { ok: await dialog.getByText('Visible to you, Maya and Sam').first().isVisible() })
    await h.capture('editor-share-with', { clip: { x: 0, y: 0, width: 1280, height: 820 } })

    // ---- B. Created shared in Lisbon ------------------------------------------------------------
    await dialog.getByRole('button', { name: 'Create routine' }).click()
    const created = await until(findCarrier)
    carrierId = created?.id ?? null
    const payload = decode(created?.description)
    await h.assert('B: the carrier is in Lisbon, done, shared', {
      ok: created?.project_id === ids.lisbon && created?.done === true && payload?.definition?.shared === true,
      detail: JSON.stringify({ project: created?.project_id, done: created?.done, shared: payload?.definition?.shared }),
    })
    await until(async () => page.getByText('Shared with Maya and Sam').first().isVisible())
    await h.assert('B: the card says "Shared with Maya and Sam"', { ok: await page.getByText('Shared with Maya and Sam').first().isVisible() })

    // ---- C. Maya's tick -------------------------------------------------------------------------
    const today = new Date()
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const slot = payload.definition.slots[0]
    const key = `${payload.definition.id}:${date}:${slot.id}`
    const now = new Date().toISOString()
    const record = {
      key, routineId: payload.definition.id, slotId: slot.id, scheduledDate: date, scheduledMinutes: slot.reminderMinutes,
      timeZoneId: Intl.DateTimeFormat().resolvedOptions().timeZone, status: 'COMPLETED', loggedAt: now, modifiedAt: now,
      modifiedBy: 'maya-phone', note: '', loggedBy: { userId: maya.id, deviceId: 'maya-phone' },
    }
    const fresh = await api.call('GET', `/tasks/${carrierId}`)
    const withTick = { ...decode(fresh.description), occurrences: { ...decode(fresh.description).occurrences, [key]: record } }
    await api.call('PATCH', `/tasks/${carrierId}`, [
      { op: 'test', path: '/description', value: fresh.description },
      { op: 'replace', path: '/description', value: encode(withTick) },
    ], 'application/json-patch+json')
    // The routines are kept fresh for 30 s: reload the window so it reads the carrier again.
    await page.reload()
    await h.goto('/routines')
    const doneBy = await until(async () => page.getByText('Done by Maya').first().isVisible())
    await h.assert('C: Maya\'s tick shows "Done by Maya"', { ok: !!doneBy })
    await h.capture('done-by-maya', { clip: { x: 0, y: 0, width: 1280, height: 820 } })

    // ---- D. Ticking again keeps Maya's record (undo then complete would replace it: a different state) --
    const stored = decode((await api.call('GET', `/tasks/${carrierId}`)).description).occurrences[key]
    await h.assert('D: the server still holds Maya\'s record', { ok: stored?.modifiedBy === 'maya-phone' && stored?.loggedBy?.userId === maya.id })

    // ---- E. Stop sharing ----------------------------------------------------------------------
    await page.getByRole('article').filter({ hasText: name }).getByTitle('Edit').click()
    const edit = page.getByRole('dialog')
    await edit.getByLabel('Share with').selectOption({ label: 'Only you' })
    await edit.getByRole('button', { name: 'Save changes' }).click()
    const back = await until(async () => {
      const task = await api.call('GET', `/tasks/${carrierId}`)
      return task.project_id === ids.inbox && decode(task.description)?.definition?.shared !== true ? task : null
    })
    await h.assert('E: Only you moves it back to the Inbox without the flag', { ok: !!back })

    // ---- F. The project delete question names a shared routine ----------------------------------
    // Share it again over the editor so Lisbon holds it, then open Delete for Lisbon and cancel.
    await page.getByRole('article').filter({ hasText: name }).getByTitle('Edit').click()
    const again = page.getByRole('dialog')
    await again.getByLabel('Share with').selectOption({ label: 'Maya' })
    const keepAgain = again.getByRole('group', { name: 'Keep in' })
    if (await keepAgain.isVisible().catch(() => false)) await keepAgain.getByText('Trip to Lisbon').click()
    await again.getByRole('button', { name: 'Save changes' }).click()
    await until(async () => (await api.call('GET', `/tasks/${carrierId}`)).project_id === ids.lisbon)
    // Confirmations on for this step: should the question ever not come, Delete must not go through
    // (the app asks anyway when a shared routine is in it; the unit tests cover that).
    const confirmBefore = await page.evaluate(() => window.api.getConfig().then((config) => config?.confirm_before_delete))
    await page.evaluate(() => window.api.saveConfigPatch({ confirm_before_delete: true }))
    restoreConfirm = confirmBefore ?? true
    // Let the save's refresh redraw the sidebar first: a redraw closes an open menu.
    await h.wait(2000)
    const sidebarRow = page.locator('[role="button"][tabindex="0"]', { hasText: 'Trip to Lisbon' }).first()
    await sidebarRow.hover()
    await page.getByRole('button', { name: 'Trip to Lisbon actions' }).click()
    await page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Delete' }).first().click()
    const question = await until(async () => page.getByText(/It also holds the shared routine/).first().isVisible())
    await h.assert('F: deleting Lisbon names the shared routine', { ok: !!question })
    await h.capture('delete-project-note', { clip: { x: 0, y: 0, width: 1280, height: 820 } })
    await page.getByRole('button', { name: 'Cancel' }).click()
  } finally {
    if (restoreConfirm !== undefined) {
      await page.evaluate((value) => window.api.saveConfigPatch({ confirm_before_delete: value }), restoreConfirm).catch(() => {})
    }
    if (carrierId) await api.call('DELETE', `/tasks/${carrierId}`).catch(() => {})
  }
}
