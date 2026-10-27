// Guided organizing (docs/cross-app-semantics-v1.md section 14): the entry points, an Inbox card
// session (a quick choice and Next, Complete, the summary and Undo all), the overdue and waiting
// sessions, a project review page (Mark reviewed, Undo all puts the footer back), the weekly review
// (Finish records the day; the scenario resets it to the default afterwards) and the palette.
//
// It works on two throwaway Inbox tasks, deleted at the end, and puts back every change it makes,
// so it needs no re-seed and leaves the shared dataset as it found it. Suggestions come from a fake
// OpenAI-compatible model on a local port (it passes Test connection, then answers the organize
// request), and that part only looks: the dashed choices, the reason, the suggested way out, and
// Ask's agenda and starters.
import { createServer } from 'node:http'
import { localDate } from '../lib.mjs'

export const meta = {
  id: 'GO',
  wave: 6,
  title: 'Guided organizing: Inbox session, review page, weekly review, entry points',
}

const NULL_PREFIX = '0001-01-01'

/** A fake model: the Test connection probes, and suggestions for the two throwaway tasks. */
function fakeModel(tomorrow) {
  const sse = (chunks) => chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  const text = (value) => sse([{ choices: [{ delta: { content: JSON.stringify(value) } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }])
  return createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (req.method === 'GET' && req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'fake' }] }))
        return
      }
      const request = JSON.parse(body || '{}')
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (Array.isArray(request.tools) && request.tools.length > 0) {
        res.end(sse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'add_numbers', arguments: '{"a":2,"b":3}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]))
        return
      }
      const user = String(request.messages?.find((m) => m.role === 'user')?.content ?? '')
      if (!user.includes('<session>')) {
        res.end(text({ answer: 5 }))
        return
      }
      const context = JSON.parse(/<context>\n(.*)\n<\/context>/.exec(user)[1])
      const tasks = JSON.parse(/<tasks>\n([\s\S]*)\n<\/tasks>/.exec(user)[1])
      const home = context.projects.find((p) => p.title === 'Home renovation')
      const none = { said: null, date: null, time: null }
      const suggestions = tasks.flatMap((task) => {
        if (task.title === 'GO throwaway one') return [{ task_id: task.id, title: 'GO throwaway one, tidied', project_id: home?.id ?? null, when: { said: null, date: tomorrow, time: null }, clear_due: false, close: null, reason: 'Fits Home renovation' }]
        if (task.title === 'GO throwaway two') return [{ task_id: task.id, title: null, project_id: null, when: none, clear_due: false, close: 'done', reason: 'Looks finished' }]
        return []
      })
      res.end(text({ suggestions, next_step: null }))
    })
  })
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.dismiss()

  const one = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: 'GO throwaway one' })
  const two = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title: 'GO throwaway two' })
  const tomorrow = localDate(1)
  const pad = (n) => String(n).padStart(2, '0')
  const localDay = (iso) => {
    const d = new Date(iso)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const until = async (read, ok, tries = 20) => {
    let value = await read()
    for (let i = 0; i < tries && !ok(value); i++) {
      await h.wait(250)
      value = await read()
    }
    return value
  }
  const cardTitle = () => page.locator('#guided-title').inputValue()

  try {
    // Entry points: the Inbox header and the Review view.
    await h.goto('/inbox')
    await h.wait(800)
    await h.assert('Inbox header offers "Sort the Inbox"', async () => (await page.getByRole('button', { name: 'Sort the Inbox' }).count()) === 1)
    await h.goto('/review')
    await h.wait(800)
    await h.assert('Review view offers "Weekly review"', async () => (await page.getByRole('button', { name: 'Weekly review' }).count()) === 1)
    await h.capture('review-header')

    // The Inbox session: find the throwaway cards (skipping the seeded ones), Tomorrow + Next, Complete.
    await h.goto('/inbox')
    await h.wait(600)
    await page.getByRole('button', { name: 'Sort the Inbox' }).click()
    await page.locator('#guided-title').waitFor({ timeout: 8000 })
    await h.assert('the session shows how far along it is', async () => (await page.getByText(/^1 of \d+$/).count()) === 1)
    await h.capture('inbox-first-card')
    // Walk the queue: Tomorrow + Next on the first throwaway, Complete on the second, Skip the rest.
    let scheduled = false
    let completed = false
    for (let i = 0; i < 60 && (await page.locator('#guided-title').count()) > 0; i++) {
      const title = await cardTitle()
      if (title === 'GO throwaway one' && !scheduled) {
        await page.getByRole('group', { name: 'When' }).getByRole('button', { name: /^Tomorrow/ }).click()
        await h.assert('Tomorrow is pressed', async () => (await page.getByRole('group', { name: 'When' }).getByRole('button', { name: /^Tomorrow/ }).getAttribute('aria-pressed')) === 'true')
        await h.capture('inbox-card-tomorrow')
        await page.getByRole('button', { name: 'Next', exact: true }).click()
        scheduled = true
        const due = await until(async () => (await h.api('GET', `/tasks/${one.id}`)).due_date, (value) => value && localDay(value) === tomorrow)
        await h.assert('Next wrote the due date', () => ({ ok: !!due && localDay(due) === tomorrow, detail: due }))
      } else if (title === 'GO throwaway two' && !completed) {
        await page.getByRole('button', { name: /^Complete/ }).click()
        completed = true
        const done = await until(async () => (await h.api('GET', `/tasks/${two.id}`)).done, (value) => value === true)
        await h.assert('Complete wrote at once', () => done === true)
      } else {
        await h.key('s')
      }
      await h.wait(200)
    }
    await h.assert('both throwaway cards came', () => scheduled && completed)
    const summary = page.getByRole('status').filter({ hasText: /^Sorted/ })
    await h.assert('the summary says what changed', async () => ({ ok: (await summary.textContent()) === 'Sorted 2: 1 scheduled, 1 completed', detail: await summary.textContent() }))
    await h.capture('inbox-summary')
    await page.getByRole('button', { name: 'Undo all' }).click()
    const dueBack = await until(async () => (await h.api('GET', `/tasks/${one.id}`)).due_date, (value) => !value || value.startsWith(NULL_PREFIX))
    const openAgain = await until(async () => (await h.api('GET', `/tasks/${two.id}`)).done, (value) => value === false)
    await h.assert('Undo all took the date away again', () => ({ ok: !dueBack || dueBack.startsWith(NULL_PREFIX), detail: dueBack }))
    await h.assert('Undo all reopened the completed task', () => openAgain === false)
    await page.getByRole('button', { name: 'Done' }).click()
    await h.wait(500)

    // Overdue: a card from the seeded overdue tasks; Exit leaves it.
    await h.goto('/guided/overdue')
    await h.wait(1200)
    await h.assert('the overdue session shows a card or says nothing is overdue', async () =>
      (await page.locator('#guided-title').count()) === 1 || (await page.getByText('Nothing is overdue.').count()) === 1)
    await h.capture('overdue-card')
    await h.axe()

    // Waiting: the seed is fresh, so nothing has waited 60 days.
    await h.goto('/guided/waiting')
    await h.wait(1200)
    await h.capture('waiting')

    // Review: Mark reviewed on the first page, skip the rest, Undo all puts the footer back.
    await h.goto('/guided/review')
    await page.getByRole('button', { name: /Mark reviewed/ }).waitFor({ timeout: 8000 })
    const reviewed = (await page.locator('h2.text-page-title').textContent())?.trim()
    const projects = await h.api('GET', '/projects?per_page=1000')
    const project = (Array.isArray(projects) ? projects : projects.items ?? []).find((p) => p.title === reviewed)
    const before = project ? (await h.api('GET', `/projects/${project.id}`)).description : null
    await h.capture('review-page')
    await h.axe()
    await page.getByRole('button', { name: /Mark reviewed/ }).click()
    const today = localDate(0)
    const after = project ? await until(async () => (await h.api('GET', `/projects/${project.id}`)).description, (value) => value?.includes(`**Vicu review**: ${today}`)) : null
    await h.assert('Mark reviewed recorded the review', () => ({ ok: !!after?.includes(`**Vicu review**: ${today}`), detail: reviewed }))
    for (let i = 0; i < 30 && (await page.getByRole('button', { name: /Mark reviewed/ }).count()) > 0; i++) {
      await h.key('s')
      await h.wait(250)
    }
    await h.capture('review-summary')
    await page.getByRole('button', { name: 'Undo all' }).click()
    const restored = project ? await until(async () => (await h.api('GET', `/projects/${project.id}`)).description, (value) => value === before) : null
    await h.assert('Undo all put the review footer back', () => ({ ok: restored === before, detail: restored }))

    // The weekly review: the steps, Finish records the day, then back to the default.
    await h.goto('/weekly-review')
    await h.wait(1200)
    await h.assert('the weekly review lists its steps', async () => {
      const titles = await page.locator('ol[aria-label="Steps"] h2').allTextContents()
      return { ok: titles[0] === 'Sort the Inbox' && titles[1] === 'Anything on your mind?' && titles.includes('Look back') && titles.at(-1) === 'Waiting a long time', detail: titles.join(' | ') }
    })
    await h.capture('weekly')
    await h.axe()
    await page.getByRole('button', { name: 'Finish' }).click()
    await page.getByText('Weekly review done').first().waitFor({ timeout: 6000 })
    await h.capture('weekly-done')
    await h.goto('/today')
    await h.wait(300)
    await h.goto('/weekly-review')
    await h.wait(800)
    await h.assert('the weekly review was recorded today', async () => (await page.getByText('Last done today').count()) > 0)
    await page.evaluate(() => window.api.setSyncedPreference('weekly_review.last', null))

    // Suggestions from the fake model: the card is filled in, dashed, with the reason; nothing is written.
    const server = fakeModel(tomorrow)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = `http://127.0.0.1:${server.address().port}/v1`
      const tested = await page.evaluate(async (addr) => {
        await window.api.ai.saveSettings({ provider: 'ollama', address: addr, models: { dictation: 'fake', ask: 'fake' }, features: { ask: true } })
        return window.api.ai.testConnection('fake')
      }, address)
      await h.assert('the fake model passes Test connection', () => ({ ok: tested.success && tested.data.features.ask, detail: JSON.stringify(tested) }))
      await page.reload()
      await h.wait(1500)
      await h.goto('/guided/inbox')
      await page.locator('#guided-title').waitFor({ timeout: 8000 })
      let sawOne = false
      let sawTwo = false
      for (let i = 0; i < 20 && (await page.locator('#guided-title').count()) > 0 && !(sawOne && sawTwo); i++) {
        // The card's batch first: its suggestion fills the card when it comes.
        await page.getByText('A suggestion is on its way').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
        const title = await cardTitle()
        if (title === 'GO throwaway one, tidied') {
          await page.getByText('Fits Home renovation').waitFor({ timeout: 8000 })
          sawOne = true
          await h.assert('the suggested title is dashed', async () => (await page.locator('#guided-title').getAttribute('class')).includes('border-dashed'))
          await h.assert('the suggested project fills the project choice', async () => (await page.getByRole('button', { name: /^Project: .*Home renovation$/ }).count()) === 1)
          await h.assert('the suggested date is pressed and dashed', async () => {
            const button = page.getByRole('group', { name: 'When' }).getByRole('button', { name: /^Tomorrow/ })
            return (await button.getAttribute('aria-pressed')) === 'true' && (await button.getAttribute('class')).includes('border-dashed')
          })
          await h.capture('suggested-card')
          await h.key('s')
        } else if (title === 'GO throwaway two') {
          await page.getByText('Looks finished').waitFor({ timeout: 8000 })
          sawTwo = true
          await h.assert('the suggested way out is Complete, untaken', async () => (await page.getByRole('button', { name: /^Complete/ }).textContent()).includes('Suggested'))
          await h.key('s')
        } else {
          await h.key('s')
        }
        await h.wait(250)
      }
      await h.assert('both suggested cards came', () => sawOne && sawTwo)
      const untouched = await h.api('GET', `/tasks/${one.id}`)
      await h.assert('a suggestion writes nothing without a tap', () => ({ ok: untouched.title === 'GO throwaway one' && untouched.project_id === h.ids.inbox, detail: untouched.title }))
      await page.getByRole('button', { name: 'Exit' }).click().catch(() => {})
      await h.wait(400)

      // Ask's agenda and starters, in an empty conversation opened from Today.
      await h.goto('/today')
      await h.wait(400)
      await h.key('Control+J')
      await page.getByText('Needs a decision').waitFor({ timeout: 8000 })
      await h.assert('the agenda lists the Inbox first', async () => ((await page.locator('#ask-agenda + ul button').first().textContent()) ?? '').startsWith('Sort the Inbox'))
      await h.assert('the starters are the Today ones', async () => (await page.getByRole('button', { name: 'What should I do first today?' }).count()) === 1)
      await h.capture('ask-agenda')
      await page.locator('#ask-agenda + ul button').first().click()
      await page.locator('#guided-title').waitFor({ timeout: 8000 })
      await h.assert('an agenda item opens its session', () => page.url().includes('/guided/inbox'))
      await h.key('Control+J')
    } finally {
      server.close()
    }

    // The palette finds the sessions.
    await h.goto('/today')
    await h.wait(500)
    await h.key('Control+Shift+P')
    await h.wait(300)
    await h.type('weekly review')
    await h.wait(200)
    await h.key('Enter')
    await h.wait(800)
    await h.assert('the palette opens the weekly review', () => ({ ok: page.url().includes('/weekly-review'), detail: page.url() }))
  } finally {
    await h.api('DELETE', `/tasks/${one.id}`).catch(() => {})
    await h.api('DELETE', `/tasks/${two.id}`).catch(() => {})
  }
}
