import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SheepMark } from '../icons'

/** Value of a style property on the element or its nearest ancestor that sets it. */
function inherited(el: Element, prop: string): string | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const m = new RegExp(`${prop}\\s*:\\s*([^;]+)`).exec(e.getAttribute('style') ?? '')
    if (m) return m[1].trim()
  }
  return null
}

describe('SheepMark', () => {
  it('renders an svg whose colours come from tokens, not hex colours', () => {
    const { container } = render(<SheepMark />)
    expect(container.querySelector('svg')).not.toBeNull()
    for (const el of container.querySelectorAll('[fill], [stroke]')) {
      expect(el.getAttribute('fill') ?? '').not.toMatch(/#[0-9a-fA-F]{3,8}/)
      expect(el.getAttribute('stroke') ?? '').not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
    const html = container.innerHTML
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(html).toContain('--sms-logo-body')
    expect(html).toContain('--sms-logo-shade')
    expect(html).toContain('--sms-surface')
    expect(html).toContain('--sms-logo-gap')
  })

  it('uses the 64 by 64 viewBox', () => {
    const { container } = render(<SheepMark />)
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 64 64')
  })

  it('strokes the head and ear with the gap colour', () => {
    const { container } = render(<SheepMark />)
    const ellipses = [...container.querySelectorAll('ellipse')]
    expect(ellipses).toHaveLength(2)
    for (const e of ellipses) {
      expect(inherited(e, 'stroke')).toContain('--sms-logo-gap')
      expect(inherited(e, 'fill')).toContain('--sms-logo-shade')
    }
  })

  it('fills the wool with body, the legs with shade and the eye with surface', () => {
    const { container } = render(<SheepMark />)
    const circles = [...container.querySelectorAll('circle')]
    expect(circles).toHaveLength(6)
    const fills = circles.map((c) => inherited(c, 'fill') ?? '')
    expect(fills.slice(0, 5).every((f) => f.includes('--sms-logo-body'))).toBe(true)
    expect(fills[5]).toContain('--sms-surface')
    const legs = [...container.querySelectorAll('rect')]
    expect(legs).toHaveLength(2)
    for (const l of legs) expect(inherited(l, 'fill')).toContain('--sms-logo-shade')
  })

  it('is decorative and not focusable', () => {
    const svg = render(<SheepMark />).container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
  })

  it('defaults to 26 and sizes width and height from size', () => {
    const def = render(<SheepMark />).container.querySelector('svg')!
    expect(def.getAttribute('width')).toBe('26')
    expect(def.getAttribute('height')).toBe('26')
    const big = render(<SheepMark size={48} />).container.querySelectorAll('svg')[0]
    expect(big.getAttribute('width')).toBe('48')
    expect(big.getAttribute('height')).toBe('48')
  })
})
