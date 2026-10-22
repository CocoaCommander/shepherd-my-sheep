#!/usr/bin/env node
/**
 * Renders the PNG icons from public/favicon.svg, for browsers and the iOS home screen.
 *
 *   npm run icons
 *
 * Writes public/favicon-32.png (the favicon tile at 32x32, transparent corners) and
 * public/apple-touch-icon.png (180x180, a full green square with the mark at 76%; iOS
 * applies its own mask). Both use the light colours. Run it again after changing the SVG
 * and commit the PNGs.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const favicon = await readFile(path.join(publicDir, 'favicon.svg'), 'utf8')

/** Replaces exactly one occurrence, so a changed favicon.svg fails loudly instead of drifting. */
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`favicon.svg: expected one "${from}"`)
  return text.replace(from, to)
}

// The touch icon: square tile, mark drawn at 76% of it and centred.
const touchIcon = replaceOnce(
  replaceOnce(favicon, 'rx="14.336"', 'rx="0"'),
  'transform="translate(1.92 1.92) scale(.94)"',
  'transform="translate(7.68 7.68) scale(.76)"',
)

const icons = [
  { file: 'favicon-32.png', svg: favicon, size: 32 },
  { file: 'apple-touch-icon.png', svg: touchIcon, size: 180 },
]

const browser = await chromium.launch()
try {
  for (const { file, svg, size } of icons) {
    // Light, so the SVG's prefers-color-scheme: dark block never applies.
    const context = await browser.newContext({
      viewport: { width: size, height: size },
      colorScheme: 'light',
    })
    const page = await context.newPage()
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    )
    await page.screenshot({ path: path.join(publicDir, file), omitBackground: true })
    await context.close()
    console.log(`wrote public/${file}`)
  }
} finally {
  await browser.close()
}
