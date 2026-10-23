// The screens of the website (site/): the main views, the card, the composer, the date popover,
// Quick Entry, Quick View, the palette, the comments pane and the list editor. It switches the profile
// to the default Todoist syntax (@label) and makes two custom lists when they are missing ("This
// week", "Waiting on others"); nothing else is saved. Run it with `--scale 2` for both themes, then
// convert the captures with `node site/tools/screens.mjs <light run> <dark run>`.
export const meta = {
  id: 'site-screens',
  wave: null,
  title: 'Website screens: Today, Upcoming, shared project, card, composer, date popover, Quick Entry, Quick View, palette, comments, list editor, Review, Logbook',
}

export default async function run(h) {
  const { page, ids } = h
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const shot = (name) => h.capture(name)
  const row = (title) => page.locator('[data-task-id]', { hasText: title }).first()
  const dark = h.options.theme === 'dark'

  // The default quick-add syntax, as people see it
  await page.evaluate(() => window.api.saveConfigPatch({ nlp_syntax_mode: 'todoist' }))
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await h.settle(page, 800)
  // The captures paint web content only: give the sidebar the opaque colour instead of the vibrancy
  // that would show through it in the real window.
  await page.evaluate((c) => document.documentElement.style.setProperty('--bg-sidebar', c), dark ? '#2C2C2E' : '#F5F5F7')

  // Two custom lists in the sidebar (made once; the server keeps them until the next seed)
  for (const [name, setup] of [
    ['This week', async (d) => d.locator('select').nth(3).selectOption('this_week')],
    ['Waiting on others', async (d) => d.getByLabel('Assigned').selectOption('others')],
  ]) {
    if (await page.getByRole('button', { name, exact: true }).count()) continue
    await page.getByRole('button', { name: 'New list' }).click()
    const d = page.locator('dialog[open]')
    await d.waitFor({ timeout: 5000 })
    await d.getByLabel('Name', { exact: true }).fill(name)
    await setup(d).catch(() => {})
    await d.getByRole('button', { name: 'Create' }).click()
    await page.getByRole('button', { name, exact: true }).waitFor({ timeout: 8000 }).catch(() => {})
    await h.wait(400)
  }

  // The main views
  for (const [name, route] of [
    ['today', '/today'],
    ['upcoming', '/upcoming'],
    ['anytime', '/anytime'],
    ['inbox', '/inbox'],
    ['logbook', '/logbook'],
    ['review', '/review'],
    ['routines', '/routines'],
    ['project-website', `/project/${ids.website}`],
    ['project-home', `/project/${ids.home}`],
  ]) {
    await h.goto(route)
    await h.wait(600)
    await shot(name)
  }

  // A shared project: avatars and comment counts
  await h.goto(`/project/${ids.lisbon}`)
  await row('Book flights to Lisbon').locator('[aria-label^="Assigned to"]').waitFor({ timeout: 10000 }).catch(() => {})
  await h.wait(600)
  await shot('project-lisbon')

  // The comments pane on the flights task
  await row('Book flights to Lisbon').locator('button[aria-label*="comment"]').click()
  await page.locator('#comments-pane li[aria-label]').nth(1).waitFor({ timeout: 10000 }).catch(() => {})
  await h.wait(900)
  await shot('comments')
  await h.key(`${mod}+Shift+C`)
  await h.dismiss()

  // An open card with a checklist and subtasks
  await h.goto('/today')
  await h.click('Draft Q4 roadmap')
  await h.wait(900)
  await shot('card')
  await h.dismiss()

  // The date popover
  await h.goto('/today')
  const plants = row('Water the plants')
  await plants.click({ position: { x: 180, y: 12 } })
  await h.wait(700)
  await plants.locator('button[data-prop="schedule"]').click()
  await h.wait(600)
  await shot('when')
  await h.dismiss()

  // A custom list
  await h.goto('/today')
  await page.getByRole('button', { name: 'This week', exact: true }).click().catch(() => {})
  await h.wait(900)
  await shot('custom-list')

  // The composer with parsed text
  await h.goto('/today')
  await h.click('button[aria-label="New task"]')
  await h.wait(400)
  await h.type('Call Ana about the weekend tomorrow at 3pm @call !high')
  await h.wait(900)
  await shot('composer')
  await h.dismiss()

  // The context menu
  await h.goto('/today')
  await h.rightClick('Water the plants')
  await h.wait(500)
  await shot('context-menu')
  await h.dismiss()

  // The command palette
  await h.goto('/today')
  await h.key(`${mod}+Shift+P`)
  await h.wait(600)
  await shot('palette')
  await h.key('Escape')
  await h.dismiss()

  // The custom list editor (closed without saving)
  await h.goto('/today')
  await page.getByRole('button', { name: 'New list' }).click()
  const dialog = page.locator('dialog[open]')
  await dialog.waitFor({ timeout: 5000 }).catch(() => {})
  await dialog.getByLabel('Name', { exact: true }).fill('This week at work').catch(() => {})
  await h.wait(500)
  await shot('list-editor')
  await h.key('Escape')
  await h.dismiss()

  // Quick Entry with parsed text, and Quick View
  const qe = await h.showQuick('entry')
  await h.wait(800)
  await qe.keyboard.type('Pick up dry cleaning friday @errand', { delay: 25 })
  await h.wait(900)
  await h.capture('quick-entry', { page: qe, transparent: true })
  await qe.keyboard.press('Escape')
  await h.hideQuick('entry')

  const qv = await h.showQuick('view')
  await qv.getByText('Renew passport').first().waitFor({ timeout: 10000 }).catch(() => {})
  await h.wait(1200)
  await h.capture('quick-view', { page: qv, transparent: true })
  await qv.keyboard.press('Escape')
  await h.hideQuick('view')
}
