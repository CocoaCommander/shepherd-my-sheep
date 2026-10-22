import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { Header } from './Header'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const mocks: MockedResponse[] = [
  {
    request: { query: G.MeDocument },
    result: {
      data: { me: { __typename: 'User', id: 'u-1', name: 'Daniel Okafor', username: 'daniel' } },
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  },
  {
    request: { query: G.ContactAlertsDocument },
    result: { data: { contactAlerts: [] } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  },
]

const original = window.matchMedia

/** Answers each query on its own: only the ones in `matching` match. */
function stubMatchMedia(matching: string[]) {
  window.matchMedia = ((query: string) => ({
    matches: matching.includes(query),
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function renderHeader() {
  render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    </MockedProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})
afterEach(() => {
  window.matchMedia = original
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('Header theme toggle', () => {
  it('is in the bar at desktop width, without a visible label', () => {
    stubMatchMedia([])
    renderHeader()
    const toggle = screen.getByRole('button', { name: 'Dark mode' })
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Dark mode' })).toBe(
      toggle,
    )
    expect(toggle).toHaveTextContent('')
    expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('is inside the folded menu panel, with its label, below 720px', () => {
    stubMatchMedia(['(max-width: 719px)'])
    renderHeader()
    // jsdom applies the CSS module but not its phone media query, so the Menu button stays
    // display: none there and out of role queries; AppHeader.test finds it by label too.
    const menu = screen.getByLabelText('Menu')
    const panel = document.getElementById(menu.getAttribute('aria-controls') as string)
    expect(panel).not.toBeNull()
    const toggle = within(panel as HTMLElement).getByRole('button', { name: 'Dark mode' })
    expect(toggle).toHaveTextContent('Dark mode')
  })

  it('reflects an OS dark preference', () => {
    stubMatchMedia(['(prefers-color-scheme: dark)'])
    renderHeader()
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
