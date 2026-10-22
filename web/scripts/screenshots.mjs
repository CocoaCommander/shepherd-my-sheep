#!/usr/bin/env node
/**
 * Full-page screenshots of the running web app, for PR descriptions.
 *
 *   node scripts/screenshots.mjs --url http://localhost:3101 --user demo_shepherd \
 *     --out /tmp/shots [--dark] /people "person:Marcus Reid" /prayer
 *
 * Signs in once through the Sign in form as --user, with the password from
 * SEED_USER_PASSWORD (required, no fallback), then shoots each page at web (1280)
 * and mWeb (390) widths, in light, and in dark too with --dark.
 *
 * A page is a path ("/people") or "person:<name>", the Person page of the first
 * link with that name on My people, so a Person page needs no id.
 * "signed-out:<path>" shoots that path without the stored token (e.g. signed-out:/login),
 * and "register" shoots /login signed out after following its "Create an account" link.
 * Files are named <page>-<web|mweb>-<light|dark>.png.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const VIEWPORTS = {
  web: { width: 1280, height: 900 },
  mweb: { width: 390, height: 844 },
}

const { values, positionals: pages } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    user: { type: 'string' },
    out: { type: 'string' },
    dark: { type: 'boolean', default: false },
  },
})

function fail(message) {
  console.error(`screenshots: ${message}`)
  process.exit(1)
}

const password = process.env.SEED_USER_PASSWORD
if (!values.url || !values.user || !values.out) fail('--url, --user and --out are required')
if (!password) fail('SEED_USER_PASSWORD is not set; it is the demo users’ password in .env')
if (pages.length === 0) fail('name at least one page, e.g. /people or "person:Marcus Reid"')

const themes = values.dark ? ['light', 'dark'] : ['light']

/** "/people/abc" → "people-abc", "person:Marcus Reid" → "person-marcus-reid", "/" → "home". */
function slug(page) {
  const s = page
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return s || 'home'
}

/** Waits for the page's data: no requests in flight and no "Loading…" left. */
async function settle(page) {
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
async function resolve(page, target) {
  if (target === 'register') return '/login'
  if (target.startsWith('signed-out:')) return target.slice('signed-out:'.length)
  if (!target.startsWith('person:')) return target
  const name = target.slice('person:'.length)
  await page.goto(new URL('/people', values.url).href)
  await settle(page)
  const href = await page.getByRole('link', { name }).first().getAttribute('href')
  if (!href) fail(`no link named "${name}" on My people`)
  return href
}

async function open(page, url) {
  await page.goto(new URL(url, values.url).href)
  await settle(page)
}

const browser = await chromium.launch()
try {
  // Sign in once and reuse the stored token in every context.
  const login = await browser.newContext()
  const loginPage = await login.newPage()
  await loginPage.goto(new URL('/login', values.url).href)
  // exact: the Password field's Show / Hide toggle is labelled "Show password".
  await loginPage.getByLabel('Username', { exact: true }).fill(values.user)
  await loginPage.getByLabel('Password', { exact: true }).fill(password)
  await loginPage.getByRole('button', { name: 'Sign in' }).click()
  await loginPage.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 })
  const storageState = await login.storageState()
  const urls = []
  for (const target of pages) urls.push(await resolve(loginPage, target))
  await login.close()

  await mkdir(values.out, { recursive: true })
  for (const theme of themes) {
    for (const [size, viewport] of Object.entries(VIEWPORTS)) {
      const options = {
        viewport,
        colorScheme: theme,
        reducedMotion: 'reduce',
        deviceScaleFactor: 2,
      }
      const context = await browser.newContext({ ...options, storageState })
      const signedOut = await browser.newContext(options)
      const page = await context.newPage()
      const signedOutPage = await signedOut.newPage()
      for (const [i, target] of pages.entries()) {
        const outside = target === 'register' || target.startsWith('signed-out:')
        const shot = outside ? signedOutPage : page
        await open(shot, urls[i])
        if (target === 'register') {
          await shot.getByRole('button', { name: 'New here? Create an account' }).click()
        }
        const file = path.join(values.out, `${slug(target)}-${size}-${theme}.png`)
        await shot.screenshot({ path: file, fullPage: true, animations: 'disabled' })
        console.log(file)
      }
      await context.close()
      await signedOut.close()
    }
  }
} finally {
  await browser.close()
}
