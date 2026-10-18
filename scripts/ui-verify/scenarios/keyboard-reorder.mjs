// keyboard-reorder: Move up and Move down for task rows (cross-app semantics 12.4), the keyboard
// twin of E10's drag. In the default order ("Due date, then manual") only undated rows move, among
// themselves.
//
//   A. Alt+Shift+Up on the second undated row of a project swaps it with the first one: the page
//      shows the new order, the focus stays on the moved row, the move is announced, the server
//      holds the new order.
//   B. Alt+Shift+Down moves it back.
//   C. Alt+Shift+Up on the first undated row does nothing and says why (the dated row above stays).
//   D. The row menu (the menu key) offers only the moves the row can make, with their shortcuts.
export const meta = {
  id: 'KRO',
  wave: 4,
  title: 'Keyboard reorder: Alt+Shift+Up/Down move a row, focus stays, announced, saved; the menu has Move up/down',
}

const items = (res) => (Array.isArray(res) ? res : (res?.items ?? []))
const NULL_DATE = '0001-01-01T00:00:00Z'
const undated = (t) => !t.due_date || t.due_date === NULL_DATE

/** The open tasks of a project's list view, in the order the server holds them. */
async function serverTasks(h, projectId) {
  const views = items(await h.api('GET', `/projects/${projectId}/views`))
  const list = views.find((v) => v.view_kind === 'list')
  const tasks = items(await h.api('GET', `/projects/${projectId}/views/${list.id}/tasks?filter=${encodeURIComponent('done = false')}&per_page=100`))
  return tasks.filter((t) => !t.done).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
}

const domOrder = (h) => h.page.evaluate(() => [...document.querySelectorAll('[data-task-id]')].map((el) => Number(el.getAttribute('data-task-id'))))
const focusedRow = (h) => h.page.evaluate(() => Number(document.activeElement?.closest('[data-task-id]')?.getAttribute('data-task-id') ?? 0))
const announced = (h) => h.page.evaluate(() => document.querySelector('[data-announcer]')?.textContent?.trim() ?? '')

export default async function run(h) {
  await h.resize(1280, 820)

  // The first seeded project with at least three undated open tasks.
  let projectId = null
  let undatedIds = new Set()
  for (const key of ['inbox', 'website', 'q4', 'home', 'lisbon', 'personal', 'work']) {
    const tasks = await serverTasks(h, h.ids[key]).catch(() => [])
    const ids = tasks.filter(undated).map((t) => t.id)
    if (ids.length >= 3) {
      projectId = h.ids[key]
      undatedIds = new Set(ids)
      break
    }
  }
  if (projectId === null) {
    h.emit({ t: 'skip', id: meta.id, wave: meta.wave, message: 'no seeded project has three undated open tasks' })
    return
  }

  await h.goto(`/project/${projectId}`)
  await h.dismiss()
  const before = (await domOrder(h)).filter((id) => undatedIds.has(id))
  await h.assert('the project shows at least three undated rows', { ok: before.length >= 3, detail: before.join(',') })
  const [first, second] = before
  const row = (id) => h.page.locator(`[data-task-id="${id}"]`)

  // A. Move the second undated row up.
  await row(second).focus()
  await h.key('Alt+Shift+ArrowUp')
  await h.wait(150)
  const afterUp = (await domOrder(h)).filter((id) => undatedIds.has(id))
  await h.assert('Alt+Shift+Up swaps the row with the one above', { ok: afterUp[0] === second && afterUp[1] === first, detail: afterUp.join(',') })
  await h.assert('the focus stays on the moved row', { ok: (await focusedRow(h)) === second, detail: await focusedRow(h) })
  let saved = []
  for (let i = 0; i < 10; i++) {
    await h.wait(300)
    saved = (await serverTasks(h, projectId)).filter(undated).map((t) => t.id)
    if (saved[0] === second) break
  }
  await h.assert('the server holds the new order', { ok: saved[0] === second && saved[1] === first, detail: saved.slice(0, 4).join(',') })
  await h.assert('the move is announced', { ok: /^Moved “.+” up$/.test(await announced(h)), detail: await announced(h) })
  await h.capture('moved-up')

  // B. And back down.
  await h.key('Alt+Shift+ArrowDown')
  await h.wait(150)
  const afterDown = (await domOrder(h)).filter((id) => undatedIds.has(id))
  await h.assert('Alt+Shift+Down moves it back', { ok: afterDown[0] === first && afterDown[1] === second, detail: afterDown.join(',') })
  await h.assert('the focus is still on the moved row', { ok: (await focusedRow(h)) === second, detail: await focusedRow(h) })
  await h.wait(800)

  // C. The first undated row cannot go up: past a dated row or the top of the list.
  const all = await domOrder(h)
  await row(first).focus()
  await h.key('Alt+Shift+ArrowUp')
  await h.wait(300)
  await h.assert('the first undated row stays where it is', { ok: JSON.stringify(await domOrder(h)) === JSON.stringify(all), detail: (await domOrder(h)).slice(0, 5).join(',') })
  await h.assert('it says why', { ok: /already/.test(await announced(h)), detail: await announced(h) })
  await h.assert('the focus stays on the row', { ok: (await focusedRow(h)) === first, detail: await focusedRow(h) })

  // D. The row menu has Move down but not Move up for the first undated row; both for the second.
  const menuItems = async (id) => {
    // The menu key on the focused row (Shift+F10 opens it on Windows; a right click opens the same
    // menu, but on macOS neither reaches the row from the harness, see context-menu-keys).
    await row(id).focus()
    await h.key('ContextMenu')
    await h.wait(300)
    const names = await h.page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((x) => x.textContent.trim()))
    await h.key('Escape')
    await h.wait(150)
    return names
  }
  const firstMenu = await menuItems(first)
  await h.assert('the first undated row offers Move down only', {
    ok: firstMenu.some((n) => n.startsWith('Move down')) && !firstMenu.some((n) => n.startsWith('Move up')),
    detail: firstMenu.filter((n) => n.startsWith('Move')).join('|'),
  })
  const secondMenu = await menuItems(second)
  await h.assert('the second undated row offers Move up and Move down with their shortcuts', {
    ok: secondMenu.some((n) => n.startsWith('Move up') && n.includes('↑')) && secondMenu.some((n) => n.startsWith('Move down') && n.includes('↓')),
    detail: secondMenu.filter((n) => n.startsWith('Move')).join('|'),
  })
  await h.capture('menu-checked')
  await h.dismiss()
}
