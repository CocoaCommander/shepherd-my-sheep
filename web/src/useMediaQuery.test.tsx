import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NARROW, useMediaQuery } from './useMediaQuery'

function Probe() {
  return <p>{useMediaQuery(NARROW) ? 'narrow' : 'wide'}</p>
}

const original = window.matchMedia
afterEach(() => {
  window.matchMedia = original
})

describe('useMediaQuery', () => {
  it('is false where matchMedia is missing', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    render(<Probe />)
    expect(screen.getByText('wide')).toBeInTheDocument()
  })

  it('follows the query, including a change event, and unsubscribes', () => {
    const listeners = new Set<() => void>()
    const list = {
      matches: false,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }
    const matchMedia = vi.fn(() => list)
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia

    const { unmount } = render(<Probe />)
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 719px)')
    expect(screen.getByText('wide')).toBeInTheDocument()

    list.matches = true
    act(() => listeners.forEach((fn) => fn()))
    expect(screen.getByText('narrow')).toBeInTheDocument()

    list.matches = false
    act(() => listeners.forEach((fn) => fn()))
    expect(screen.getByText('wide')).toBeInTheDocument()

    unmount()
    expect(listeners.size).toBe(0)
  })
})
