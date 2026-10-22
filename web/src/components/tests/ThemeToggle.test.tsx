import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { THEME_KEY } from '../../theme'
import { ThemeToggle } from '..'

const original = window.matchMedia

function stubOsDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

const toggle = () => screen.getByRole('button', { name: 'Dark mode' })

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  stubOsDark(false)
})
afterEach(() => {
  window.matchMedia = original
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('ThemeToggle', () => {
  it('is not pressed by default when the OS is light', () => {
    render(<ThemeToggle />)
    expect(toggle()).toHaveAttribute('type', 'button')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('is pressed by default when the OS is dark', () => {
    stubOsDark(true)
    render(<ThemeToggle />)
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
  })

  it('reflects a stored theme over the OS', () => {
    stubOsDark(true)
    localStorage.setItem(THEME_KEY, 'light')
    render(<ThemeToggle />)
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('flips the theme on each click', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(toggle())
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')

    await user.click(toggle())
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('goes light on the first click when the OS is dark', async () => {
    stubOsDark(true)
    render(<ThemeToggle />)
    await userEvent.setup().click(toggle())
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('shows no visible text unless showLabel is set, and keeps its name when it is', () => {
    const { rerender } = render(<ThemeToggle />)
    expect(toggle()).toHaveTextContent('')
    rerender(<ThemeToggle showLabel />)
    expect(toggle()).toHaveTextContent('Dark mode')
    expect(screen.getByText('Dark mode')).toBeVisible()
  })
})
