import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { formatShortDate } from '../format'
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
    recordedMilestoneIds: [],
    activeBurdenCount: 0,
    latestComment: null,
    shepherds: [],
    createdAt: at(-90 * DAY),
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

/** The lists LogContact and DeleteContact return besides the summary; one contact if given. */
function activity(contactId?: string) {
  const contacts = contactId
    ? [
        {
          __typename: 'ContactLog',
          id: contactId,
          contactedAt: at(0),
          isFollowUp: false,
          createdAt: at(0),
        },
      ]
    : []
  return { prayerBurdens: [], comments: [], contacts }
}

const ELENA = active('p-elena', 'Elena Petrova', 21)
const JAMES = active('p-james', 'James Whitfield', 10)
const TOM = person('p-tom', 'Tom Becker', {
  status: NEW,
  createdAt: at(-78 * HOUR),
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
    // Adding Tom was his first contact, so what's overdue is the follow-up.
    expect(overdue).toHaveTextContent('6 hours overdue')
    expect(overdue).toHaveTextContent('Added 3 days ago, no contact logged')
    for (const name of ['Elena Petrova', 'Tom Becker']) {
      expect(
        within(overdue).getByRole('button', { name: `Log contact with ${name}` }),
      ).toHaveTextContent('Log contact')
    }

    const soon = section('Coming up')
    expect(soon).toHaveTextContent('Due in 1 day')
    expect(soon).toHaveTextContent('Follow up within 72 hours')
    expect(
      within(soon).getByRole('button', { name: 'Log contact with Aisha Bello' }),
    ).toBeInTheDocument()
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
    // Not by role: the always-mounted toast is a status too.
    expect(await screen.findByText(/No one is overdue/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an empty state for a user with no people (business rule 1)', async () => {
    renderHome([])
    expect(await screen.findByText('No one is assigned to you yet')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The header's button and the empty state's both open the Add person page.
    const addLinks = screen.getAllByRole('link', { name: 'Add person' })
    expect(addLinks).toHaveLength(2)
    for (const link of addLinks) expect(link).toHaveAttribute('href', '/people/new')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('logs a contact from a card through the dialog and offers Undo', async () => {
    const user = userEvent.setup()
    const logged = vi.fn(() => ({
      data: { logContact: { ...active('p-elena', 'Elena Petrova', 0), ...activity('c-new') } },
    }))
    const undone = vi.fn(() => ({ data: { deleteContact: { ...ELENA, ...activity() } } }))
    renderHome(
      [ELENA],
      [
        {
          request: {
            query: G.LogContactDocument,
            variables: {
              input: { personId: 'p-elena', contactedAt: NOW.toISOString(), note: 'Coffee' },
            },
          },
          result: logged,
        },
        {
          request: { query: G.DeleteContactDocument, variables: { id: 'c-new' } },
          result: undone,
        },
      ],
    )

    await user.click(await screen.findByRole('button', { name: 'Log contact with Elena Petrova' }))
    const dialog = screen.getByRole('dialog', { name: 'Log contact with Elena' })
    await user.type(within(dialog).getByLabelText('Comment (required)'), 'Coffee')
    await user.click(within(dialog).getByRole('button', { name: 'Save contact' }))

    expect(
      await screen.findByText(
        `Contact logged with Elena. Next contact due ${formatShortDate(at(7 * DAY))}.`,
      ),
    ).toBeInTheDocument()
    expect(logged).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Contact with Elena removed.')).toBeInTheDocument()
    expect(undone).toHaveBeenCalledTimes(1)
  })

  it('offers Undo on a follow-up too, which the server reverts to new contact', async () => {
    const user = userEvent.setup()
    const logged = vi.fn(() => ({
      data: { logContact: { ...active('p-aisha', 'Aisha Bello', 0), ...activity('c-new') } },
    }))
    const undone = vi.fn(() => ({ data: { deleteContact: { ...AISHA, ...activity() } } }))
    renderHome(
      [AISHA],
      [
        {
          request: {
            query: G.LogContactDocument,
            variables: {
              input: { personId: 'p-aisha', contactedAt: NOW.toISOString(), note: 'Lunch' },
            },
          },
          result: logged,
        },
        {
          request: { query: G.DeleteContactDocument, variables: { id: 'c-new' } },
          result: undone,
        },
      ],
    )

    await user.click(await screen.findByRole('button', { name: 'Log contact with Aisha Bello' }))
    expect(screen.getByText(/Logging this contact moves Aisha to Active/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Comment (required)'), 'Lunch')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(
      await screen.findByText(/^Contact logged with Aisha\. Aisha is now Active\./),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Contact with Aisha removed.')).toBeInTheDocument()
    expect(undone).toHaveBeenCalledTimes(1)
  })

  it('closes the dialog on Cancel without logging', async () => {
    const user = userEvent.setup()
    renderHome([MARIA])

    const open = await screen.findByRole('button', { name: 'Log contact with Maria Santos' })
    await user.click(open)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(open).toHaveFocus()
  })
})
