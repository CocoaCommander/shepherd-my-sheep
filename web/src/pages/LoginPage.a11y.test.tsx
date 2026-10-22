import { MockedProvider } from '@apollo/client/testing'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: false, signIn: vi.fn(), signOut: vi.fn() }),
}))

async function violations(before?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) {
  const user = userEvent.setup()
  const { container } = render(
    <MockedProvider mocks={[]}>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/people' } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  await screen.findByRole('button', { name: 'Sign in' })
  await before?.(user)
  const results = await axe.run(container, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)
}

const toRegister = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'New here? Create an account' }))

describe('Login page accessibility (axe-core, WCAG 2.2 A/AA)', () => {
  it('sign in mode', async () => {
    expect(await violations()).toEqual([])
  })

  it('register mode with help lines', async () => {
    expect(await violations(toRegister)).toEqual([])
  })

  it('sign in with inline errors showing', async () => {
    expect(
      await violations(async (user) => {
        await user.click(screen.getByRole('button', { name: 'Sign in' }))
        await screen.findByText('Enter your username.')
      }),
    ).toEqual([])
  })

  it('register with inline errors showing', async () => {
    expect(
      await violations(async (user) => {
        await toRegister(user)
        await user.click(screen.getByRole('button', { name: 'Create account' }))
        await screen.findByText('Enter your name.')
      }),
    ).toEqual([])
  })
})
