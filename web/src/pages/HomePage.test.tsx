import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { HomePage } from './HomePage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const HOUR = 3_600_000
const DAY = 24 * HOUR
// A Thursday afternoon, local time.
const NOW = new Date(2026, 9, 15, 14, 0, 0)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const ACTIVE = { __typename: 'Status', id: 'st-active', name: 'active' }
const NEW = { __typename: 'Status', id: 'st-new', name: 'new contact' }
const INACTIVE = { __typename: 'Status', id: 'st-inactive', name: 'inactive' }

function person(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Person',
    id,
    name,
    age: null,
    yearMet: null,
    lastContactedAt: null,
    contactDueAt: null,
    contactState: G.ContactState.NotTracked,
    isActive: true,
    status: ACTIVE,
    ...overrides,
  }
}

/** An active person last contacted `daysAgo` days ago, in the state the API would give. */
function active(id: string, name: string, daysAgo: number) {
  const due = (7 - daysAgo) * DAY
  const state =
    due < 0
      ? G.ContactState.Overdue
      : due <= 2 * DAY
        ? G.ContactState.DueSoon
        : G.ContactState.OnTrack
  return person(id, name, {
    lastContactedAt: at(-daysAgo * DAY),
    contactDueAt: at(due),
    contactState: state,
  })
}

const ELENA = active('p-elena', 'Elena Petrova', 21)
const JAMES = active('p-james', 'James Whitfield', 10)
const TOM = person('p-tom', 'Tom Becker', {
  status: NEW,
  contactDueAt: at(-6 * HOUR),
  contactState: G.ContactState.Overdue,
})
const AISHA = person('p-aisha', 'Aisha Bello', {
  status: NEW,
  lastContactedAt: at(-48 * HOUR),
  contactDueAt: at(24 * HOUR),
  contactState: G.ContactState.DueSoon,
})
const MARIA = active('p-maria', 'Maria Santos', 3)
const OMAR = person('p-omar', 'Omar Haddad', { status: INACTIVE })

const meMock: MockedResponse = {
  request: { query: G.MeDocument },
  result: {
    data: { me: { __typename: 'User', id: 'u-1', name: 'Daniel Okafor', username: 'daniel' } },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
}

function peopleMock(people: unknown[]): MockedResponse {
  return {
    request: { query: G.MyPeopleDocument },
    result: { data: { myPeople: people } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  }
}

function alertsMock(people: unknown[]): MockedResponse {
  return {
    request: { query: G.ContactAlertsDocument },
    result: { data: { contactAlerts: people } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  }
}

function renderHome(people: unknown[], extra: MockedResponse[] = []) {
  const alerts = people.filter((p) =>
    [G.ContactState.Overdue, G.ContactState.DueSoon].includes(
      (p as { contactState: G.ContactState }).contactState,
    ),
  )
  render(
    <MockedProvider mocks={[meMock, peopleMock(people), alertsMock(alerts), ...extra]}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </MockedProvider>,
  )
}

const section = (name: string) => screen.getByRole('region', { name })
const cardNames = (region: HTMLElement) =>
  within(region)
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('HomePage', () => {
  it('greets the shepherd and groups people by contact state, most urgent first', async () => {
    renderHome([MARIA, JAMES, OMAR, AISHA, TOM, ELENA])

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Good afternoon, Daniel',
    )

    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('3 people are overdue for contact')
    expect(banner).toHaveTextContent('Elena Petrova has gone 21 days.')
    expect(banner).toHaveTextContent('Tom Becker has not been contacted yet.')
    expect(within(banner).getByRole('link', { name: 'Review now' })).toHaveAttribute(
      'href',
      '#overdue',
    )

    expect(cardNames(section('Needs contact now'))).toEqual([
      'Elena Petrova',
      'James Whitfield',
      'Tom Becker',
    ])
    expect(cardNames(section('Coming up'))).toEqual(['Aisha Bello'])
    expect(cardNames(section('On track'))).toEqual(['Maria Santos'])

    // Inactive people are listed, not carded.
    expect(screen.getByText(/Not tracked: 1/)).toBeInTheDocument()
    expect(screen.getByText(/Omar Haddad \(inactive\)/)).toBeInTheDocument()
  })

  it('words each card for the person’s rule and offers the right action', async () => {
    renderHome([ELENA, TOM, AISHA, MARIA])
    const overdue = await screen.findByRole('region', { name: 'Needs contact now' })
    expect(overdue).toHaveTextContent('14 days overdue')
    expect(overdue).toHaveTextContent('21 days since last contact')
    expect(overdue).toHaveTextContent('First contact needed')
    expect(within(overdue).getByRole('button', { name: 'Log first contact' })).toBeInTheDocument()

    const soon = section('Coming up')
    expect(soon).toHaveTextContent('Due in 1 day')
    expect(soon).toHaveTextContent('Follow up within 72 hours')
    expect(within(soon).getByRole('button', { name: 'Log follow-up' })).toBeInTheDocument()
    expect(soon).toHaveTextContent('Becomes a regular contact')

    expect(
      within(section('On track')).getByRole('link', { name: 'Add note for Maria Santos' }),
    ).toHaveAttribute('href', '/people/p-maria')
  })

  it('shows the stat tiles, linking only to sections that have people', async () => {
    renderHome([ELENA, MARIA])
    await screen.findByRole('region', { name: 'Needs contact now' })

    expect(screen.getByRole('link', { name: /1 Overdue/ })).toHaveAttribute('href', '#overdue')
    expect(screen.getByRole('link', { name: /1 On track/ })).toHaveAttribute('href', '#ok')
    expect(screen.queryByRole('link', { name: /Coming up/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Coming up' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /0 Not tracked/ })).toHaveAttribute('href', '/people')
  })

  it('shows an all-clear instead of the banner when no one is overdue', async () => {
    renderHome([MARIA])
    expect(await screen.findByRole('status')).toHaveTextContent('No one is overdue')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an empty state for a user with no people (business rule 1)', async () => {
    renderHome([])
    expect(await screen.findByText('No one is assigned to you yet')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('logs a contact from a card and offers Undo', async () => {
    const user = userEvent.setup()
    const logged = vi.fn(() => ({
      data: {
        logContact: {
          ...active('p-elena', 'Elena Petrova', 0),
          contacts: [{ __typename: 'ContactLog', id: 'c-new' }],
        },
      },
    }))
    const undone = vi.fn(() => ({
      data: { deleteContact: { ...ELENA, contacts: [] } },
    }))
    renderHome(
      [ELENA],
      [
        {
          request: {
            query: G.LogContactDocument,
            variables: { input: { personId: 'p-elena', isFollowUp: false } },
          },
          result: logged,
        },
        {
          request: { query: G.DeleteContactDocument, variables: { id: 'c-new' } },
          result: undone,
        },
      ],
    )

    await user.click(await screen.findByRole('button', { name: 'Contacted today' }))
    expect(await screen.findByText('Contact with Elena Petrova logged.')).toBeInTheDocument()
    expect(logged).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Contact removed.')).toBeInTheDocument()
    expect(undone).toHaveBeenCalledTimes(1)
  })

  it('logs a follow-up for a new contact without an Undo', async () => {
    const user = userEvent.setup()
    const logged = vi.fn(() => ({
      data: {
        logContact: {
          ...active('p-aisha', 'Aisha Bello', 0),
          contacts: [{ __typename: 'ContactLog', id: 'c-new' }],
        },
      },
    }))
    renderHome(
      [AISHA],
      [
        {
          request: {
            query: G.LogContactDocument,
            variables: { input: { personId: 'p-aisha', isFollowUp: true } },
          },
          result: logged,
        },
      ],
    )

    await user.click(await screen.findByRole('button', { name: 'Log follow-up' }))
    expect(
      await screen.findByText('Follow-up logged. Aisha Bello is now active.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })
})
