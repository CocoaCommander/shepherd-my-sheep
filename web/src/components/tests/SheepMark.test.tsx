import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SheepMark } from '../icons'

describe('SheepMark', () => {
  it('renders an svg whose fills come from tokens, not hex colours', () => {
    const { container } = render(<SheepMark />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    for (const el of container.querySelectorAll('[fill]')) {
      expect(el.getAttribute('fill')).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
    const html = container.innerHTML
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // If fills are set inline, they must use the logo tokens and the surface token for the eye.
    if (/style=/.test(html)) {
      expect(html).toContain('--sms-logo-body')
      expect(html).toContain('--sms-logo-shade')
      expect(html).toContain('--sms-surface')
    }
  })
})
