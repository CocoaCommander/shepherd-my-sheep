import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NETWORK_MESSAGE } from '../errors'
import * as G from '../generated/graphql'
import { LoginPage } from './LoginPage'

const auth = { isSignedIn: false, signIn: vi.fn(), signOut: vi.fn() }
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }))

const USER = { __typename: 'User', id: 'user-sam', name: 'Sam Test', username: 'sam_test' }
const PASSWORD = 'correct-horse'

beforeEach(() => {
  auth.isSignedIn = false
  auth.signIn = vi.fn()
})

function authResult(field: 'login' | 'register') {
  return { data: { [field]: { __typename: 'AuthPayload', token: 'tok-123', user: USER } } }
}

function loginMock(result: MockedResponse['result'] = authResult('login'), password = PASSWORD) {
  const fn = vi.fn(() => result as never)
  return {
    fn,
    mock: {
      request: {
        query: G.LoginDocument,
        variables: { input: { username: 'sam_test', password } },
      },
      result: fn,
    } as MockedResponse,
  }
}

function registerMock(
  input = { name: 'Sam Test', username: 'sam_test', password: PASSWORD },
  result: MockedResponse['result'] = authResult('register'),
) {
  const fn = vi.fn(() => result as never)
  return {
    fn,
    mock: {
      request: { query: G.RegisterDocument, variables: { input } },
      result: fn,
    } as MockedResponse,
  }
}

/** `from` is the page the user came from; null renders /login with no previous page. */
function renderPage(mocks: MockedResponse[] = [], from: string | null = '/people') {
  render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: from ? { from } : undefined }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/people" element={<div>People page marker</div>} />
          <Route path="/" element={<div>Home page marker</div>} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return userEvent.setup()
}

const password = () => screen.getByLabelText('Password', { exact: true }) as HTMLInputElement
const username = () => screen.getByLabelText('Username') as HTMLInputElement
const name = () => screen.getByLabelText('Name') as HTMLInputElement
const submit = (label: string) => screen.getByRole('button', { name: label })

async function toRegister(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New here? Create an account' }))
}

describe('LoginPage sign in mode', () => {
  it('shows the welcome heading first, the sub line and only Username and Password', () => {
    renderPage()
    const headings = screen.getAllByRole('heading')
    expect(headings[0]).toHaveTextContent('Welcome back')
    expect(headings[0].tagName).toBe('H1')
    expect(screen.getByText('Sign in to see who needs contact today.')).toBeInTheDocument()
    expect(username()).toBeInTheDocument()
    expect(password()).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(submit('Sign in')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New here? Create an account' })).toBeInTheDocument()
  })

  it('has no help lines under Username and Password', () => {
    renderPage()
    expect(screen.queryByText('Other shepherds use this to find you.')).not.toBeInTheDocument()
    expect(screen.queryByText('At least 8 characters.')).not.toBeInTheDocument()
  })

  it('has noValidate and no native required or minLength, with the right input attributes', () => {
    renderPage()
    const form = username().closest('form') as HTMLFormElement
    expect(form).toHaveAttribute('novalidate')
    for (const input of [username(), password()]) {
      expect(input).not.toBeRequired()
      expect(input).not.toHaveAttribute('minlength')
    }
    expect(username()).toHaveAttribute('maxlength', '50')
    expect(username()).toHaveAttribute('autocomplete', 'username')
    expect(username()).toHaveAttribute('autocapitalize', 'none')
    expect(password()).toHaveAttribute('autocomplete', 'current-password')
  })

  it('shows nothing before the first submit', () => {
    renderPage()
    expect(screen.queryByText('Enter your username.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(username()).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('shows and hides the password', async () => {
    const user = renderPage()
    expect(password()).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password()).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password()).toHaveAttribute('type', 'password')
  })

  it('signs in and lands on the page the user came from', async () => {
    const { fn, mock } = loginMock()
    const user = renderPage([mock])
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await user.click(submit('Sign in'))
    expect(await screen.findByText('People page marker')).toBeInTheDocument()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(auth.signIn).toHaveBeenCalledWith('tok-123')
  })

  it('lands on / when there is no previous page', async () => {
    const user = renderPage([loginMock().mock], null)
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await user.click(submit('Sign in'))
    expect(await screen.findByText('Home page marker')).toBeInTheDocument()
    expect(auth.signIn).toHaveBeenCalledWith('tok-123')
  })

  it('accepts a 7 character password on sign in', async () => {
    const { fn, mock } = loginMock(undefined, 'abc1234')
    const user = renderPage([mock])
    await user.type(username(), 'sam_test')
    await user.type(password(), 'abc1234')
    await user.click(submit('Sign in'))
    expect(await screen.findByText('People page marker')).toBeInTheDocument()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('disables the button and says Please wait while the request is in flight', async () => {
    const mock = { ...loginMock().mock, delay: 100 }
    const user = renderPage([mock])
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await user.click(submit('Sign in'))
    const busy = screen.getByRole('button', { name: 'Please wait…' })
    expect(busy).toBeDisabled()
    expect(await screen.findByText('People page marker')).toBeInTheDocument()
  })

  it('shows the server message without blaming a field when credentials are wrong', async () => {
    const { mock } = loginMock({
      errors: [
        new GraphQLError('Invalid username or password', {
          extensions: { code: 'BAD_USER_INPUT' },
        }),
      ],
    })
    const user = renderPage([mock])
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await user.click(submit('Sign in'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Invalid username or password$/)
    expect(username()).not.toHaveAttribute('aria-invalid', 'true')
    expect(password()).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/^Enter your /)).not.toBeInTheDocument()
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('shows the network message when the server cannot be reached', async () => {
    const mock: MockedResponse = {
      ...loginMock().mock,
      result: undefined,
      error: new Error('Failed to fetch'),
    }
    const user = renderPage([mock])
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await user.click(submit('Sign in'))
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_MESSAGE)
    expect(auth.signIn).not.toHaveBeenCalled()
  })
})

describe('LoginPage register mode', () => {
  it('shows the register heading, sub line, fields, help lines and buttons', async () => {
    const user = renderPage()
    await toRegister(user)
    expect(screen.getAllByRole('heading')[0]).toHaveTextContent('Create your account')
    // The second sentence is its own span (hidden on phones), so match the paragraph's whole text.
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'P' &&
          el.textContent === 'It takes a minute. Then add the people you are caring for.',
      ),
    ).toBeInTheDocument()
    expect(name()).toBeInTheDocument()
    expect(username()).toBeInTheDocument()
    expect(password()).toBeInTheDocument()
    expect(screen.getByText('What other shepherds will see.')).toBeInTheDocument()
    expect(screen.getByText('Other shepherds use this to find you.')).toBeInTheDocument()
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument()
    expect(submit('Create account')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Already have an account? Sign in' }),
    ).toBeInTheDocument()
  })

  it('sets input attributes', async () => {
    const user = renderPage()
    await toRegister(user)
    expect(name()).toHaveAttribute('maxlength', '100')
    expect(name()).toHaveAttribute('autocomplete', 'name')
    expect(username()).toHaveAttribute('maxlength', '50')
    expect(password()).toHaveAttribute('autocomplete', 'new-password')
    for (const input of [name(), username(), password()]) {
      expect(input).not.toBeRequired()
      expect(input).not.toHaveAttribute('minlength')
    }
  })

  it('switches back, hiding Name and the help lines', async () => {
    const user = renderPage()
    await toRegister(user)
    await user.click(screen.getByRole('button', { name: 'Already have an account? Sign in' }))
    expect(screen.getAllByRole('heading')[0]).toHaveTextContent('Welcome back')
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.queryByText('At least 8 characters.')).not.toBeInTheDocument()
    expect(screen.queryByText('What other shepherds will see.')).not.toBeInTheDocument()
  })

  it('keeps typed values when switching mode', async () => {
    const user = renderPage()
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await toRegister(user)
    expect(username()).toHaveValue('sam_test')
    expect(password()).toHaveValue(PASSWORD)
  })

  it('registers with a trimmed name and lands on the previous page', async () => {
    const { fn, mock } = registerMock()
    const user = renderPage([mock])
    await toRegister(user)
    await user.type(name(), '  Sam Test  ')
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await user.click(submit('Create account'))
    expect(await screen.findByText('People page marker')).toBeInTheDocument()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(auth.signIn).toHaveBeenCalledWith('tok-123')
  })

  it('rejects a 7 character password and sends nothing', async () => {
    const { fn, mock } = registerMock()
    const user = renderPage([mock])
    await toRegister(user)
    await user.type(name(), 'Sam Test')
    await user.type(username(), 'sam_test')
    await user.type(password(), 'abc1234')
    await user.click(submit('Create account'))
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(password()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('At least 8 characters.')).not.toBeInTheDocument()
    expect(fn).not.toHaveBeenCalled()
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('accepts an 8 character password', async () => {
    const { fn, mock } = registerMock({
      name: 'Sam Test',
      username: 'sam_test',
      password: 'abc12345',
    })
    const user = renderPage([mock])
    await toRegister(user)
    await user.type(name(), 'Sam Test')
    await user.type(username(), 'sam_test')
    await user.type(password(), 'abc12345')
    await user.click(submit('Create account'))
    expect(await screen.findByText('People page marker')).toBeInTheDocument()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('shows the taken-username message in the banner', async () => {
    const { mock } = registerMock(undefined, {
      errors: [new GraphQLError('Username is already taken', { extensions: { code: 'CONFLICT' } })],
    })
    const user = renderPage([mock])
    await toRegister(user)
    await user.type(name(), 'Sam Test')
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await user.click(submit('Create account'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Username is already taken')
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('clears the server banner when switching mode', async () => {
    const { mock } = registerMock(undefined, {
      errors: [new GraphQLError('Username is already taken', { extensions: { code: 'CONFLICT' } })],
    })
    const user = renderPage([mock])
    await toRegister(user)
    await user.type(name(), 'Sam Test')
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await user.click(submit('Create account'))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Already have an account? Sign in' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('LoginPage client validation', () => {
  it('flags every empty field on submit, sends nothing and focuses the first one', async () => {
    const user = renderPage()
    await toRegister(user)
    await user.click(submit('Create account'))
    expect(screen.getByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByText('Enter your username.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    for (const input of [name(), username(), password()]) {
      expect(input).toHaveAttribute('aria-invalid', 'true')
    }
    expect(screen.queryByText('What other shepherds will see.')).not.toBeInTheDocument()
    expect(name()).toHaveFocus()
  })

  it('treats a name of only spaces as blank', async () => {
    const user = renderPage()
    await toRegister(user)
    await user.type(name(), '   ')
    await user.type(username(), 'sam_test')
    await user.type(password(), PASSWORD)
    await user.click(submit('Create account'))
    expect(screen.getByText('Enter your name.')).toBeInTheDocument()
    expect(name()).toHaveFocus()
  })

  it('treats a username of only spaces as blank and focuses it', async () => {
    const user = renderPage()
    await user.type(username(), '   ')
    await user.type(password(), PASSWORD)
    await user.click(submit('Sign in'))
    expect(screen.getByText('Enter your username.')).toBeInTheDocument()
    expect(username()).toHaveFocus()
  })

  it('focuses the password when only it is invalid', async () => {
    const user = renderPage()
    await user.type(username(), 'sam_test')
    await user.click(submit('Sign in'))
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(password()).toHaveFocus()
  })

  it('updates errors live after the first submit', async () => {
    const user = renderPage()
    await user.click(submit('Sign in'))
    expect(screen.getByText('Enter your username.')).toBeInTheDocument()
    await user.type(username(), 's')
    expect(screen.queryByText('Enter your username.')).not.toBeInTheDocument()
    expect(username()).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
  })

  it('clears inline errors when switching mode', async () => {
    const user = renderPage()
    await user.click(submit('Sign in'))
    await screen.findByText('Enter your username.')
    await toRegister(user)
    expect(screen.queryByText('Enter your username.')).not.toBeInTheDocument()
    expect(screen.queryByText('Enter your password.')).not.toBeInTheDocument()
    expect(username()).not.toHaveAttribute('aria-invalid', 'true')
  })
})

describe('LoginPage when already signed in', () => {
  it('redirects to the previous page without showing the form', () => {
    auth.isSignedIn = true
    renderPage()
    expect(screen.getByText('People page marker')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('redirects to / when there is no previous page', () => {
    auth.isSignedIn = true
    renderPage([], null)
    expect(screen.getByText('Home page marker')).toBeInTheDocument()
  })
})
