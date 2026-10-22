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
 * Page targets are described in session.mjs (a path, "person:<name>",
 * "signed-out:<path>" or "register").
 * Files are named <page>-<web|mweb>-<light|dark>.png.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import {
  VIEWPORTS,
  cli,
  contextOptions,
  isSignedOut,
  openTarget,
  signIn,
  slug,
} from './session.mjs'

const { values, pages, password, themes, fail } = cli('screenshots', { out: { type: 'string' } }, [
  'out',
])

const browser = await chromium.launch()
try {
  // Sign in once and reuse the stored token in every context.
  const { storageState, urls } = await signIn(browser, {
    base: values.url,
    user: values.user,
    password,
    pages,
    fail,
  })

  await mkdir(values.out, { recursive: true })
  for (const theme of themes) {
    for (const [size, viewport] of Object.entries(VIEWPORTS)) {
      const options = contextOptions(viewport, theme)
      const context = await browser.newContext({ ...options, storageState })
      const signedOut = await browser.newContext(options)
      const page = await context.newPage()
      const signedOutPage = await signedOut.newPage()
      for (const [i, target] of pages.entries()) {
        const shot = isSignedOut(target) ? signedOutPage : page
        await openTarget(shot, values.url, urls[i], target)
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
