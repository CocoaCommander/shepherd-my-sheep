import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', '..')
const tokensPath = join(here, '..', 'tokens.css')

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Returns the body of the block whose selector (text before `{`) matches, found by brace matching. */
function blockBody(css: string, selector: string): string | null {
  const re = new RegExp(
    `(^|[}{;])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\s*\\{`,
  )
  const m = re.exec(css)
  if (!m) return null
  const start = m.index + m[0].length
  let depth = 1
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i)
  }
  return null
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    out.set(m[1], m[2].trim().replace(/\s+/g, ' '))
  return out
}

const css = stripComments(readFileSync(tokensPath, 'utf8'))
const root = declarations(blockBody(css, ':root') ?? '')
const mediaBody = blockBody(css, '@media (prefers-color-scheme: dark)')
const autoDark = declarations(
  mediaBody ? (blockBody(mediaBody, ":root:not([data-theme='light'])") ?? '') : '',
)
const explicitDark = declarations(blockBody(css, ":root[data-theme='dark']") ?? '')
const rawAuto = mediaBody ? (blockBody(mediaBody, ":root:not([data-theme='light'])") ?? '') : ''
const rawExplicit = blockBody(css, ":root[data-theme='dark']") ?? ''

describe('dark theme tokens', () => {
  it('defines the bare :root light tokens', () => {
    expect(root.size).toBeGreaterThan(0)
    expect(blockBody(css, ':root')).toMatch(/color-scheme:\s*light/)
  })

  it('has the new tokens in :root', () => {
    for (const name of [
      '--sms-danger-text',
      '--sms-toast',
      '--sms-brand-icon',
      '--sms-logo-body',
      '--sms-logo-shade',
      '--sms-backdrop',
      '--sms-shadow-tab',
    ]) {
      expect(root.has(name), name).toBe(true)
    }
  })

  it('has both dark blocks, each setting color-scheme: dark', () => {
    expect(rawAuto).toMatch(/color-scheme:\s*dark/)
    expect(rawExplicit).toMatch(/color-scheme:\s*dark/)
    expect(autoDark.size).toBeGreaterThan(0)
    expect(explicitDark.size).toBeGreaterThan(0)
  })

  it('defines the same properties with identical values in both dark blocks', () => {
    expect([...autoDark.keys()].sort()).toEqual([...explicitDark.keys()].sort())
    for (const [name, value] of autoDark) expect(explicitDark.get(name), name).toBe(value)
  })

  it('redefines every colour token in both dark blocks', () => {
    // A token built only from other tokens (e.g. var(--sms-border)) follows the theme through them.
    const colourTokens = [...root].filter(([, value]) => /#|rgb/.test(value))
    expect(colourTokens.length).toBeGreaterThan(0)
    for (const [name] of colourTokens) {
      expect(autoDark.has(name), `auto: ${name}`).toBe(true)
      expect(explicitDark.has(name), `explicit: ${name}`).toBe(true)
    }
  })

  it('redefines shadows and the backdrop', () => {
    for (const name of ['--sms-shadow-toast', '--sms-shadow-tab', '--sms-backdrop']) {
      expect(autoDark.has(name), name).toBe(true)
    }
    // The avatar ring is the border colour in both themes, so it follows --sms-border.
    expect(root.get('--sms-shadow-avatar-ring')).toMatch(/var\(--sms-border\)/)
  })

  it('does not redefine non-colour tokens', () => {
    for (const name of [...autoDark.keys(), ...explicitDark.keys()]) {
      expect(name).not.toMatch(/^--sms-(space|radius|size|font)-/)
    }
  })

  it('only redefines tokens that exist in :root', () => {
    for (const name of [...autoDark.keys(), ...explicitDark.keys()])
      expect(root.has(name), name).toBe(true)
  })
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory())
      return entry === 'node_modules' || entry === 'tests' ? [] : sourceFiles(path)
    if (path === tokensPath) return []
    if (/\.test\.[tj]sx?$/.test(entry)) return []
    return /\.(css|tsx?)$/.test(entry) ? [path] : []
  })
}

describe('colour literals', () => {
  const hex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/
  const files = sourceFiles(srcDir)

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files.map((f) => [f.slice(srcDir.length + 1), f]))(
    '%s has no hex or rgb() colour',
    (_name, file) => {
      const text = stripComments(readFileSync(file, 'utf8'))
      expect(text).not.toMatch(hex)
      expect(text).not.toMatch(/\brgba?\(/)
    },
  )
})
