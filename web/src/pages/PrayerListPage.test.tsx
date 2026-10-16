import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { formatDateTime } from '../format'
import * as G from '../generated/graphql'
import { PrayerListPage } from './PrayerListPage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }

function burden(id: string, content: string, createdAt: string, personId: string, name: string) {
  return {
    __typename: 'PrayerBurden',
    id,
    content,
    createdAt,
    person: { __typename: 'Person', id: personId, name },
  }
}

const B_ZED_NEW = burden('b1', 'Zed new burden', '2026-10-14 18:26:10.89+00', 'p-zed', 'Zed')
const B_ZED_OLD = burden('b2', 'Zed old burden', '2026-03-02 09:00:00.5+00', 'p-zed', 'Zed')
const B_ADA = burden('b3', 'Ada burden', '2026-06-20 12:00:00+00', 'p-ada', 'Ada')

function renderPage(burdens: object[] | Error, path = '/prayer') {
  const mocks: MockedResponse[] = [
    {
      request: { query: G.ActivePrayerBurdensDocument },
      result:
        burdens instanceof Error
          ? { errors: [new GraphQLError(burdens.message, { extensions: { code: 'INTERNAL' } })] }
          : { data: { activePrayerBurdens: burdens } },
    },
    {
      request: { query: G.MeDocument },
      result: { data: { me: ME } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ]
  render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/prayer" element={<PrayerListPage />} />
          <Route path="/people/:id" element={<StubPerson />} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function StubPerson() {
  const { id } = useParams()
  return <p>Person stub {id}</p>
}

describe('Prayer list page', () => {
  it('shows the title and an empty message with no person headings when there are no burdens', async () => {
    renderPage([])
    expect(screen.getByRole('heading', { level: 1, name: 'Prayer list' })).toBeInTheDocument()
    expect(await screen.findByText('No active prayer burdens.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Zed' })).not.toBeInTheDocument()
  })

  it('groups by person, ordered by name regardless of API order, keeping burden order', async () => {
    renderPage([B_ZED_NEW, B_ADA, B_ZED_OLD])
    await screen.findByText('Ada burden')
    expect(screen.queryByText('No active prayer burdens.')).not.toBeInTheDocument()

    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.textContent)).toEqual(['Ada', 'Zed'])

    const text = document.body.textContent ?? ''
    expect(text.indexOf('Ada burden')).toBeGreaterThan(text.indexOf('Ada'))
    expect(text.indexOf('Zed new burden')).toBeLessThan(text.indexOf('Zed old burden'))
    expect(text.indexOf('Ada burden')).toBeLessThan(text.indexOf('Zed new burden'))
  })

  it('shows each burden content with its added date', async () => {
    renderPage([B_ZED_NEW, B_ZED_OLD, B_ADA])
    expect(await screen.findByText('Zed new burden')).toBeInTheDocument()
    expect(screen.getByText('Zed old burden')).toBeInTheDocument()
    expect(
      screen.getByText(new RegExp(`Added ${formatDateTime(B_ZED_NEW.createdAt)}`)),
    ).toBeInTheDocument()
    expect(
      screen.getByText(new RegExp(`Added ${formatDateTime(B_ZED_OLD.createdAt)}`)),
    ).toBeInTheDocument()
    expect(
      screen.getByText(new RegExp(`Added ${formatDateTime(B_ADA.createdAt)}`)),
    ).toBeInTheDocument()
  })

  it('links each group heading to the person page', async () => {
    const user = userEvent.setup()
    renderPage([B_ZED_NEW, B_ADA])
    const link = await screen.findByRole('link', { name: 'Zed' })
    expect(link).toHaveAttribute('href', '/people/p-zed')
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute('href', '/people/p-ada')
    await user.click(link)
    expect(await screen.findByText('Person stub p-zed')).toBeInTheDocument()
  })

  it('shows a friendly message in an alert when the query fails', async () => {
    renderPage(new Error('db exploded'))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText('db exploded')).not.toBeInTheDocument()
    expect(screen.queryByText('No active prayer burdens.')).not.toBeInTheDocument()
  })
})

describe('Header navigation', () => {
  it('links to Home, My people and Prayer list', async () => {
    renderPage([])
    expect(await screen.findByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'My people' })).toHaveAttribute('href', '/people')
    expect(screen.getByRole('link', { name: 'Prayer list' })).toHaveAttribute('href', '/prayer')
  })

  it('marks only the current page link with aria-current', async () => {
    renderPage([])
    const prayer = await screen.findByRole('link', { name: 'Prayer list' })
    expect(prayer).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'My people' })).not.toHaveAttribute('aria-current')
  })
})
