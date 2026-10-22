/**
 * The parts screenshots.mjs and contrast-audit.mjs share: the command line, the two
 * viewports, signing in through the Sign in form, and page targets.
 *
 * Both take --url, --user, --dark and pages as positionals. The password comes from
 * SEED_USER_PASSWORD (required, no fallback) and is never printed.
 *
 * A page is a path ("/people") or "person:<name>", the Person page of the first
 * link with that name on My people, so a Person page needs no id.
 * "signed-out:<path>" opens that path without the stored token (e.g. signed-out:/login),
 * and "register" opens /login signed out and follows its "Create an account" link.
 */
import { parseArgs } from 'node:util'

export const VIEWPORTS = {
  web: { width: 1280, height: 900 },
  mweb: { width: 390, height: 844 },
}

/**
 * Parses the shared options plus `options`, and fails (prefixed with `name`) unless
 * --url, --user, every name in `required`, SEED_USER_PASSWORD and one page are given.
 */
export function cli(name, options = {}, required = []) {
  const fail = (message) => {
    console.error(`${name}: ${message}`)
    process.exit(1)
  }
  const { values, positionals: pages } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      user: { type: 'string' },
      dark: { type: 'boolean', default: false },
      toggled: { type: 'boolean', default: false },
      ...options,
    },
  })
  const missing = ['url', 'user', ...required].filter((key) => !values[key])
  if (missing.length > 0) fail(`${missing.map((key) => `--${key}`).join(', ')} required`)
  const password = process.env.SEED_USER_PASSWORD
  if (!password) fail('SEED_USER_PASSWORD is not set; it is the demo users’ password in .env')
  if (pages.length === 0) fail('name at least one page, e.g. /people or "person:Marcus Reid"')
  const themes = values.dark ? ['light', 'dark'] : ['light']
  return { values, pages, password, themes, fail }
}

/** "/people/abc" → "people-abc", "person:Marcus Reid" → "person-marcus-reid", "/" → "home". */
export function slug(target) {
  const s = target
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return s || 'home'
}

/** True for targets opened without the stored token. */
export function isSignedOut(target) {
  return target === 'register' || target.startsWith('signed-out:')
}

/** Waits for the page's data: no requests in flight and no "Loading…" left. */
export async function settle(page) {
  await page.waitForLoadState('networkidle')
  await page
    .getByText('Loading…')
    .first()
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => {})
}

/**
 * "person:<name>" → that person's path, found from My people at web width (phones show one
 * status tab at a time, so the link may be hidden there). Paths pass through.
 */
async function resolve(page, base, target, fail) {
  if (target === 'register') return '/login'
  if (target.startsWith('signed-out:')) return target.slice('signed-out:'.length)
  if (!target.startsWith('person:')) return target
  const name = target.slice('person:'.length)
  await page.goto(new URL('/people', base).href)
  await settle(page)
  const href = await page.getByRole('link', { name }).first().getAttribute('href')
  if (!href) fail(`no link named "${name}" on My people`)
  return href
}

/**
 * Signs in once as `user` and resolves every target to a path. Returns the storage state
 * to reuse in each context (it holds the token) and the paths, in `pages` order.
 */
export async function signIn(browser, { base, user, password, pages, fail }) {
  const login = await browser.newContext()
  const loginPage = await login.newPage()
  await loginPage.goto(new URL('/login', base).href)
  // exact: the Password field's Show / Hide toggle is labelled "Show password".
  await loginPage.getByLabel('Username', { exact: true }).fill(user)
  await loginPage.getByLabel('Password', { exact: true }).fill(password)
  await loginPage.getByRole('button', { name: 'Sign in' }).click()
  await loginPage.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 })
  const storageState = await login.storageState()
  const urls = []
  for (const target of pages) urls.push(await resolve(loginPage, base, target, fail))
  await login.close()
  return { storageState, urls }
}

/** Opens a resolved target and waits for it; "register" also switches to Create an account. */
export async function openTarget(page, base, url, target) {
  await page.goto(new URL(url, base).href)
  await settle(page)
  if (target === 'register') {
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
  }
}

/** Context options for one theme at one viewport. */
function contextOptions(viewport, theme) {
  return { viewport, colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: 2 }
}

/**
 * A browser context showing `theme`. Normally by emulating that OS setting; with `toggled`,
 * the OS says the opposite and the header toggle's stored choice (shepherd.theme) says
 * `theme`, so the run proves the choice overrides the OS.
 */
export async function themedContext(browser, viewport, theme, toggled, extra = {}) {
  const os = toggled ? (theme === 'dark' ? 'light' : 'dark') : theme
  const context = await browser.newContext({ ...contextOptions(viewport, os), ...extra })
  if (toggled) {
    await context.addInitScript((stored) => localStorage.setItem('shepherd.theme', stored), theme)
  }
  return context
}
