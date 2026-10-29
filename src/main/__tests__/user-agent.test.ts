import { beforeEach, describe, expect, it, vi } from 'vitest'

// Vikunja lists a session under the User-Agent of its sign-in, so it names the app and the computer.

vi.mock('electron', () => ({ app: { getVersion: () => '2.5.1' } }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  hostname: () => 'DESKTOP-4K2H1',
}))

async function load() {
  vi.resetModules()
  return await import('../user-agent')
}

describe('the User-Agent sent to Vikunja', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('names the app version, the platform and the computer', async () => {
    const { buildUserAgent } = await load()
    expect(buildUserAgent('2.5.1', 'Windows', 'DESKTOP-4K2H1')).toBe('Vicu/2.5.1 (Windows; DESKTOP-4K2H1)')
    expect(buildUserAgent('2.5.1', 'macOS', 'Rendys-MacBook-Pro.local')).toBe(
      'Vicu/2.5.1 (macOS; Rendys-MacBook-Pro.local)',
    )
  })

  it('leaves out characters a header or a comment cannot hold', async () => {
    const { buildUserAgent } = await load()
    expect(buildUserAgent('2.5.1', 'Linux', 'Rendy’s  PC (2);\n')).toBe('Vicu/2.5.1 (Linux; Rendys PC 2)')
    expect(buildUserAgent('2.5 .1/', 'Linux', '\\()')).toBe('Vicu/2.5.1 (Linux)')
  })

  it('keeps only what is known', async () => {
    const { buildUserAgent } = await load()
    expect(buildUserAgent('', 'Windows', ' ')).toBe('Vicu (Windows)')
    expect(buildUserAgent('', '', '')).toBe('Vicu')
  })

  it('cuts a long computer name short', async () => {
    const { buildUserAgent } = await load()
    expect(buildUserAgent('2.5.1', 'Linux', 'x'.repeat(200))).toBe(`Vicu/2.5.1 (Linux; ${'x'.repeat(64)})`)
  })

  it('names the platforms the app ships on', async () => {
    const { platformName } = await load()
    expect(platformName('win32')).toBe('Windows')
    expect(platformName('darwin')).toBe('macOS')
    expect(platformName('linux')).toBe('Linux')
    expect(platformName('freebsd')).toBe('freebsd')
  })

  it('is built from the app version, this platform and the host name', async () => {
    const { vikunjaUserAgent, platformName } = await load()
    expect(vikunjaUserAgent()).toBe(`Vicu/2.5.1 (${platformName(process.platform)}; DESKTOP-4K2H1)`)
  })
})
