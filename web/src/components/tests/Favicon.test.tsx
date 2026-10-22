import { render } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SheepMark } from '../icons'

const here = dirname(fileURLToPath(import.meta.url))
const webDir = join(here, '..', '..', '..')
const publicDir = join(webDir, 'public')

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const doc = new DOMParser().parseFromString(
  readFileSync(join(publicDir, 'favicon.svg'), 'utf8'),
  'image/svg+xml',
)
const svg = doc.documentElement

const ATTRS = ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'transform']
const SHAPE_TAGS = ['circle', 'ellipse', 'rect']

/** Shapes in true document order (a selector list can group by tag in XML documents). */
const shapesIn = (root: Element): Element[] =>
  [...root.querySelectorAll('*')].filter((el) => SHAPE_TAGS.includes(el.localName))

const describeShape = (el: Element) =>
  Object.fromEntries(ATTRS.map((a) => [a, el.getAttribute(a)]).filter(([, v]) => v !== null))

const tile = () => svg.querySelector('rect.tile')!
const markShapes = () => shapesIn(svg).filter((el) => el !== tile())

function ancestorClass(el: Element, names: string[]): string | undefined {
  for (let e: Element | null = el; e && e !== svg; e = e.parentElement) {
    const hit = names.find((n) => e!.classList.contains(n))
    if (hit) return hit
  }
  return undefined
}

function inheritedFill(el: Element): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const m = /fill\s*:\s*([^;]+)/.exec(e.getAttribute('style') ?? '')
    if (m) return m[1]
  }
  return ''
}

/** Returns the body of the block starting at the first match of `open`, by brace matching. */
function blockAfter(css: string, open: RegExp): string {
  const m = open.exec(css)
  if (!m) return ''
  const start = m.index + m[0].length
  let depth = 1
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i)
  }
  return ''
}

/** Colour (hex) set for `.cls` in a css chunk, from `fill` or `background`. */
function colourOf(css: string, cls: string): string | undefined {
  const body = blockAfter(css, new RegExp(`\\.${cls}\\s*\\{`))
  return /(?:fill|background)\s*:\s*(#[0-9a-fA-F]{3,8})/.exec(body)?.[1]?.toLowerCase()
}

const styleCss = stripComments(svg.querySelector('style')?.textContent ?? '')
const darkCss = blockAfter(styleCss, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/)
const lightCss = styleCss.replace(darkCss, '')

describe('favicon.svg', () => {
  it('is a 64 by 64 svg with a title', () => {
    expect(svg.tagName).toBe('svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 64 64')
    expect(svg.querySelector('title')?.textContent?.trim()).toBeTruthy()
  })

  it('has a full-size rounded tile', () => {
    const t = tile()
    expect(t).not.toBeNull()
    expect(t.getAttribute('width')).toBe('64')
    expect(t.getAttribute('height')).toBe('64')
    expect(t.getAttribute('rx')).toBe('14.336')
  })

  it('draws exactly the same shapes as SheepMark, in order', () => {
    const { container } = render(<SheepMark />)
    const component = shapesIn(container).map(describeShape)
    expect(component.length).toBeGreaterThan(0)
    expect(markShapes().map(describeShape)).toEqual(component)
  })

  it('classes each shape to match its SheepMark colour token', () => {
    const { container } = render(<SheepMark />)
    const component = shapesIn(container)
    const shapes = markShapes()
    expect(shapes).toHaveLength(component.length)
    const byToken: Record<string, string> = {
      '--sms-logo-body': 'wool',
      '--sms-logo-shade': 'head',
      '--sms-surface': 'eye',
    }
    component.forEach((el, i) => {
      const fill = inheritedFill(el)
      const token = Object.keys(byToken).find((t) => fill.includes(t))
      expect(token, `shape ${i} fill`).toBeDefined()
      expect(ancestorClass(shapes[i], ['wool', 'head', 'eye']), `shape ${i}`).toBe(byToken[token!])
    })
  })

  it('uses the light colours by default', () => {
    expect(colourOf(lightCss, 'tile')).toBe('#3b6e4f')
    expect(colourOf(lightCss, 'wool')).toBe('#ffffff')
    expect(colourOf(lightCss, 'head')).toBe('#cfe0d5')
    expect(colourOf(lightCss, 'eye')).toBe('#2d5a3f')
  })

  it('uses the dark colours under prefers-color-scheme: dark', () => {
    expect(darkCss).not.toBe('')
    expect(colourOf(darkCss, 'tile')).toBe('#1d2125')
    expect(colourOf(darkCss, 'wool')).toBe('#8fcaa6')
    expect(colourOf(darkCss, 'head')).toBe('#5fa07c')
    expect(colourOf(darkCss, 'eye')).toBe('#1d2125')
  })

  it('dark colours match the dark theme tokens', () => {
    const tokens = stripComments(readFileSync(join(here, '..', 'tokens.css'), 'utf8'))
    const dark = blockAfter(tokens, /:root\[data-theme='dark'\]\s*\{/)
    const token = (name: string) =>
      new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`).exec(dark)?.[1]?.toLowerCase()
    expect(colourOf(darkCss, 'wool')).toBe(token('--sms-logo-body'))
    expect(colourOf(darkCss, 'head')).toBe(token('--sms-logo-shade'))
    expect(colourOf(darkCss, 'tile')).toBe(token('--sms-surface'))
  })

  it('has no script and no external references', () => {
    expect(svg.querySelector('script')).toBeNull()
    for (const el of svg.querySelectorAll('*')) {
      for (const attr of ['href', 'xlink:href']) {
        expect(el.getAttribute(attr) ?? '').not.toMatch(/^https?:/i)
      }
    }
    expect(styleCss).not.toMatch(/https?:|@import|url\(/i)
  })
})

describe('index.html icons', () => {
  const html = new DOMParser().parseFromString(
    readFileSync(join(webDir, 'index.html'), 'utf8'),
    'text/html',
  )
  const link = (sel: string) => html.head.querySelector<HTMLLinkElement>(sel)
  const pngSize = (file: string) => {
    const buf = readFileSync(join(publicDir, file))
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
  }

  it('links the svg favicon, which exists in public', () => {
    const l = link('link[rel="icon"][type="image/svg+xml"]')
    expect(l?.getAttribute('href')).toBe('/favicon.svg')
    expect(existsSync(join(publicDir, 'favicon.svg'))).toBe(true)
  })

  it('links a 32x32 png favicon', () => {
    const l = link('link[rel="icon"][type="image/png"]')
    expect(l?.getAttribute('sizes')).toBe('32x32')
    expect(l?.getAttribute('href')).toBe('/favicon-32.png')
    expect(pngSize('favicon-32.png')).toEqual([32, 32])
  })

  it('links a 180x180 apple touch icon', () => {
    const l = link('link[rel="apple-touch-icon"]')
    expect(l?.getAttribute('href')).toBe('/apple-touch-icon.png')
    expect(pngSize('apple-touch-icon.png')).toEqual([180, 180])
  })
})
