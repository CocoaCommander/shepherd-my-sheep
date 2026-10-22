import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyStoredTheme, readStoredTheme, setTheme, THEME_KEY, useTheme } from './theme'

const original = window.matchMedia

/** Stubs matchMedia so only the dark-scheme query is answered; returns a way to fire a change. */
function stubOs(dark: boolean) {
  const listeners = new Set<() => void>()
  const list = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  window.matchMedia = vi.fn((query: string) =>
    query === '(prefers-color-scheme: dark)'
      ? list
      : { matches: false, addEventListener: () => {}, removeEventListener: () => {} },
  ) as unknown as typeof window.matchMedia
  return (nowDark: boolean) => {
    list.matches = nowDark
    act(() => listeners.forEach((fn) => fn()))
  }
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})
afterEach(() => {
  vi.restoreAllMocks()
  window.matchMedia = original
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('theme storage', () => {
  it('has no theme when nothing is stored, and applyStoredTheme sets no attribute', () => {
    expect(readStoredTheme()).toBeNull()
    applyStoredTheme()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('setTheme stores and applies dark and light', () => {
    setTheme('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(readStoredTheme()).toBe('dark')

    setTheme('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(readStoredTheme()).toBe('light')
  })

  it('ignores a junk stored value', () => {
    localStorage.setItem(THEME_KEY, 'blue')
    expect(readStoredTheme()).toBeNull()
    applyStoredTheme()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('applyStoredTheme applies a stored theme and clears a stale attribute', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    applyStoredTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    localStorage.clear()
    applyStoredTheme()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readStoredTheme()).toBeNull()
    expect(() => applyStoredTheme()).not.toThrow()
    expect(() => setTheme('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('useTheme', () => {
  it('follows the OS when nothing is stored', () => {
    stubOs(true)
    expect(renderHook(() => useTheme()).result.current.theme).toBe('dark')
  })

  it('is light when the OS is light and nothing is stored', () => {
    stubOs(false)
    expect(renderHook(() => useTheme()).result.current.theme).toBe('light')
  })

  it('is light where matchMedia is missing', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    expect(renderHook(() => useTheme()).result.current.theme).toBe('light')
  })

  it('prefers a stored light over an OS dark', () => {
    stubOs(true)
    localStorage.setItem(THEME_KEY, 'light')
    expect(renderHook(() => useTheme()).result.current.theme).toBe('light')
  })

  it('prefers a stored dark over an OS light', () => {
    stubOs(false)
    localStorage.setItem(THEME_KEY, 'dark')
    expect(renderHook(() => useTheme()).result.current.theme).toBe('dark')
  })

  it('follows live OS changes while nothing is stored', () => {
    const fire = stubOs(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    fire(true)
    expect(result.current.theme).toBe('dark')
    fire(false)
    expect(result.current.theme).toBe('light')
  })

  it('stops following the OS once a theme is stored', () => {
    const fire = stubOs(false)
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('light'))
    fire(true)
    expect(result.current.theme).toBe('light')
  })

  it('re-renders after setTheme from the hook and from the module function', () => {
    stubOs(false)
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('dark'))
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    act(() => setTheme('light'))
    expect(result.current.theme).toBe('light')
  })
})
