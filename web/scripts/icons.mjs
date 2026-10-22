#!/usr/bin/env node
/**
 * Generates the favicon and app icons from SheepMark (src/components/icons.tsx).
 *
 *   npm run icons
 *
 * Writes public/favicon.svg (the mark on a rounded green tile, a dark tile under
 * prefers-color-scheme: dark), public/favicon-32.png (that tile at 32x32, transparent
 * corners) and public/apple-touch-icon.png (180x180, a full green square with the mark at
 * 76%; iOS applies its own mask). The PNGs use the light colours. Run it again after
 * changing SheepMark and commit all three; Favicon.test.tsx fails if favicon.svg is stale.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = path.join(webDir, 'public')

// Tile colours (the canvas's t-green and t-dark sets). The dark tile, wool and head are the
// dark --sms-surface, --sms-logo-body and --sms-logo-shade; Favicon.test.tsx checks that.
const LIGHT = { tile: '#3b6e4f', wool: '#ffffff', head: '#cfe0d5', eye: '#2d5a3f' }
const DARK = { tile: '#1d2125', wool: '#8fcaa6', head: '#5fa07c', eye: '#1d2125' }

// SheepMark's tokens and the favicon class each becomes.
const FILL_CLASS = {
  'var(--sms-logo-body)': 'wool',
  'var(--sms-logo-shade)': 'head',
  'var(--sms-surface)': 'eye',
}
const GAP_STROKE = 'var(--sms-logo-gap)'

/** SheepMark's drawing (the children of its <svg>), loaded through Vite so the TSX compiles. */
async function sheepMarkMarkup() {
  const vite = await createServer({
    root: webDir,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    const { SheepMark } = await vite.ssrLoadModule('/src/components/icons.tsx')
    const svg = renderToStaticMarkup(createElement(SheepMark))
    const inner = /^<svg[^>]*>([\s\S]*)<\/svg>$/.exec(svg)
    if (!inner) throw new Error(`SheepMark did not render one <svg>: ${svg}`)
    return inner[1]
  } finally {
    await vite.close()
  }
}

/** Turns each inline token style into a class (and stroke-width attribute); fails on anything else. */
function tokensToClasses(markup) {
  return markup.replace(/ style="([^"]*)"/g, (_, style) => {
    const classes = []
    let attrs = ''
    for (const decl of style.split(';').filter(Boolean)) {
      const [prop, value] = decl.split(':').map((s) => s.trim())
      if (prop === 'fill' && FILL_CLASS[value]) classes.push(FILL_CLASS[value])
      else if (prop === 'stroke' && value === GAP_STROKE) classes.push('gap')
      else if (prop === 'stroke-width') attrs += ` stroke-width="${value}"`
      else throw new Error(`SheepMark: no favicon mapping for "${decl}"`)
    }
    return ` class="${classes.join(' ')}"${attrs}`
  })
}

/** One tag per line, indented by nesting depth; empty elements self-close. */
function indent(markup, depth) {
  const lines = []
  const tags = markup.replace(/<(\w+)([^>]*)><\/\1>/g, '<$1$2/>').match(/<[^>]+>/g)
  for (const tag of tags) {
    if (tag.startsWith('</')) depth--
    lines.push('  '.repeat(depth) + tag)
    if (!tag.startsWith('</') && !tag.endsWith('/>')) depth++
  }
  return lines.join('\n')
}

function colours({ tile, wool, head, eye }, pad) {
  return [
    `.tile { fill: ${tile} }`,
    `.wool { fill: ${wool} }`,
    `.head { fill: ${head} }`,
    `.gap { stroke: ${tile} }`,
    `.eye { fill: ${eye} }`,
  ]
    .map((rule) => pad + rule)
    .join('\n')
}

const mark = indent(tokensToClasses(await sheepMarkMarkup()), 2)
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- Generated from SheepMark by scripts/icons.mjs (npm run icons); don't edit by hand. -->
  <title>Shepherd My Sheep</title>
  <style>
${colours(LIGHT, '    ')}
    @media (prefers-color-scheme: dark) {
${colours(DARK, '      ')}
    }
  </style>
  <rect class="tile" width="64" height="64" rx="14.336"/>
  <g transform="translate(1.92 1.92) scale(.94)">
${mark}
  </g>
</svg>
`
await writeFile(path.join(publicDir, 'favicon.svg'), favicon)
console.log('wrote public/favicon.svg')

/** Replaces exactly one occurrence, so a template change fails loudly instead of drifting. */
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
