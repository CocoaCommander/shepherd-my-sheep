#!/usr/bin/env node
/**
 * Colour-contrast audit of the running web app in Chromium. axe can't measure contrast in
 * jsdom (the component a11y tests turn the rule off), so this runs axe's color-contrast
 * rule against real rendering instead.
 *
 *   node scripts/contrast-audit.mjs --url http://localhost:3000 --user demo_shepherd \
 *     [--dark] [--json /tmp/contrast.json] / /people "person:Marcus Reid" signed-out:/login
 *
 * Needs the API up (`make start`), demo data (`make seed`) and a web dev server at --url.
 * Signs in once through the Sign in form as --user, with the password from
 * SEED_USER_PASSWORD (required, no fallback; never printed), then checks each page at web
 * (1280) and mWeb (390) widths, in light, and in dark too with --dark (by emulating
 * prefers-color-scheme). On a "person:" page it also checks the Log contact dialog.
 *
 * Page targets are described in session.mjs (a path, "person:<name>",
 * "signed-out:<path>" or "register").
 *
 * Prints one line per failing element (page, viewport, theme, selector, colours, ratio)
 * and exits 1 if there are any, 0 if none. Elements axe can't decide (e.g. text over an
 * image or a gradient) are counted as "incomplete" in the summary but don't fail the run.
 * --json writes every violation and incomplete node to a file.
 */
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import {
  VIEWPORTS,
  cli,
  contextOptions,
  isSignedOut,
  openTarget,
  settle,
  signIn,
} from './session.mjs'

const { values, pages, password, themes, fail } = cli('contrast-audit', {
  json: { type: 'string' },
})

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

/** Runs axe's color-contrast rule on `include` (a selector), or the whole document. */
async function audit(page, include) {
  await page.addScriptTag({ path: axePath })
  return page.evaluate(async (scope) => {
    // window.axe is defined by the script injected above.
    const result = await window.axe.run(scope ? { include: [scope] } : document, {
      runOnly: ['color-contrast'],
      resultTypes: ['violations', 'incomplete'],
    })
    const nodes = (rules) =>
      rules.flatMap((rule) =>
        rule.nodes.map((node) => {
          const data = node.any[0]?.data ?? {}
          return {
            selector: node.target.join(' '),
            fg: data.fgColor,
            bg: data.bgColor,
            ratio: data.contrastRatio,
            expected: data.expectedContrastRatio,
            reason: data.messageKey,
          }
        }),
      )
    return { violations: nodes(result.violations), incomplete: nodes(result.incomplete) }
  }, include)
}

/** Opens the Log contact dialog on a Person page and waits for it. */
async function openLogContact(page) {
  await page.getByRole('button', { name: 'Log contact', exact: true }).first().click()
  await page.locator('dialog[open]').waitFor()
  await settle(page)
}

const findings = []
const checked = []

const browser = await chromium.launch()
try {
  const { storageState, urls } = await signIn(browser, {
    base: values.url,
    user: values.user,
    password,
    pages,
    fail,
  })

  for (const theme of themes) {
    for (const [size, viewport] of Object.entries(VIEWPORTS)) {
      const options = contextOptions(viewport, theme)
      const context = await browser.newContext({ ...options, storageState })
      const signedOut = await browser.newContext(options)
      const page = await context.newPage()
      const signedOutPage = await signedOut.newPage()
      for (const [i, target] of pages.entries()) {
        const tab = isSignedOut(target) ? signedOutPage : page
        await openTarget(tab, values.url, urls[i], target)
        const surfaces = [[target, null]]
        if (target.startsWith('person:')) surfaces.push([`${target} (Log contact)`, 'dialog[open]'])
        for (const [label, include] of surfaces) {
          if (include) await openLogContact(tab)
          const { violations, incomplete } = await audit(tab, include)
          checked.push(label)
          for (const node of violations)
            findings.push({ page: label, size, theme, kind: 'violation', ...node })
          for (const node of incomplete)
            findings.push({ page: label, size, theme, kind: 'incomplete', ...node })
        }
      }
      await context.close()
      await signedOut.close()
    }
  }
} finally {
  await browser.close()
}

const violations = findings.filter((f) => f.kind === 'violation')
const incomplete = findings.filter((f) => f.kind === 'incomplete')
for (const f of violations) {
  console.log(
    `${f.page}  ${f.size}  ${f.theme}  ${f.selector}  ${f.fg} on ${f.bg}  ${f.ratio}:1 (needs ${f.expected})`,
  )
}
const surfaces = new Set(checked).size
console.log(
  `contrast-audit: ${violations.length} violations, ${incomplete.length} incomplete; ` +
    `${surfaces} surfaces × ${Object.keys(VIEWPORTS).length} widths × ${themes.length} themes`,
)
if (values.json) await writeFile(values.json, JSON.stringify(findings, null, 2))
process.exit(violations.length > 0 ? 1 : 0)
