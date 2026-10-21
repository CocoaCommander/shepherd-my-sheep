import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { GraphQLError } from 'graphql'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import columnStyles from '../components/BoardColumn/BoardColumn.module.css'
import * as G from '../generated/graphql'
import { PeoplePage } from './PeoplePage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const HOUR = 3_600_000
const DAY = 24 * HOUR
// A Thursday afternoon, local time.
const NOW = new Date(2026, 9, 15, 14, 0, 0)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const NEW = { __typename: 'Status', id: 'st-new', name: 'new contact' }
const ACTIVE = { __typename: 'Status', id: 'st-active', name: 'active' }
const INACTIVE = { __typename: 'Status', id: 'st-inactive', name: 'inactive' }
const LOST = { __typename: 'Status', id: 'st-lost', name: 'lost contact' }
const STATUSES = [NEW, ACTIVE, INACTIVE, LOST]
const MILESTONES = [
  { __typename: 'Milestone', id: 'ms-1', name: 'baptised', description: '' },
  { __typename: 'Milestone', id: 'ms-2', name: 'joined small group', description: '' },
  { __typename: 'Milestone', id: 'ms-3', name: 'serving', description: '' },
  { __typename: 'Milestone', id: 'ms-4', name: 'leading', description: '' },
]

type P = ReturnType<typeof person>

function person(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Person',
    id,
    name,
    age: null,
    yearMet: null,
    lastContactedAt: null,
    contactDueAt: null,
    contactClockStart: null,
    statusChangedAt: null,
    contactState: G.ContactState.NotTracked,
    isActive: true,
    status: ACTIVE,
    recordedMilestoneIds: [] as string[],
    activeBurdenCount: 0,
    latestComment: null,
    shepherds: [],
    createdAt: at(-90 * DAY),
    ...overrides,
  }
}

/** An active person last contacted `daysAgo` days ago, in the state the API would give. */
function active(id: string, name: string, daysAgo: number, overrides = {}) {
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
    contactClockStart: at(-daysAgo * DAY),
    contactState: state,
    ...overrides,
  })
}

const ELENA = active('p-elena', 'Elena Petrova', 21)
const JAMES = active('p-james', 'James Whitfield', 10)
const MARIA = active('p-maria', 'Maria Santos', 3, {
  activeBurdenCount: 2,
  recordedMilestoneIds: ['ms-1', 'ms-2'],
})
const TOM = person('p-tom', 'Tom Becker', {
  status: NEW,
  createdAt: at(-78 * HOUR),
  contactDueAt: at(-6 * HOUR),
  contactClockStart: at(-78 * HOUR),
  contactState: G.ContactState.Overdue,
})
const AISHA = person('p-aisha', 'Aisha Bello', {
  status: NEW,
  lastContactedAt: at(-48 * HOUR),
  contactDueAt: at(5 * HOUR + 10 * 60_000),
  contactClockStart: at(-48 * HOUR),
  contactState: G.ContactState.DueSoon,
})
const OMAR = person('p-omar', 'Omar Haddad', { status: INACTIVE })
const ZOE = person('p-zoe', 'Zoe Lin', { status: LOST })
const AMY = person('p-amy', 'Amy Park', { status: LOST })

/** The person as UpdatePerson / UndoStatusChange return them after a move. */
function moved(p: P, to: typeof ACTIVE, statusChangedAt: string | null = at(0)) {
  const tracked = to.name === 'active' || to.name === 'new contact'
  return {
    ...p,
    status: to,
    statusChangedAt,
    contactState: tracked ? G.ContactState.OnTrack : G.ContactState.NotTracked,
    contactDueAt: tracked ? at(7 * DAY) : null,
    contactClockStart: tracked ? at(0) : null,
  }
}

const meMock: MockedResponse = {
  request: { query: G.MeDocument },
  result: {
    data: { me: { __typename: 'User', id: 'u-1', name: 'Daniel Okafor', username: 'daniel' } },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
}

/** The person mutations' mock: records calls and, like the API, changes what MyPeople returns. */
function updateMock(
  from: P,
  to: typeof ACTIVE,
  server: { people: P[] },
  options: { delay?: number; statusChangedAt?: string } = {},
): { mock: MockedResponse; result: ReturnType<typeof vi.fn> } {
  const after = moved(from, to, options.statusChangedAt ?? at(0))
  const result = vi.fn(() => {
    server.people = server.people.map((p) => (p.id === from.id ? after : p))
    return { data: { updatePerson: after } }
  })
  return {
    result,
    mock: {
      request: {
        query: G.UpdatePersonDocument,
        variables: { id: from.id, input: { statusId: to.id } },
      },
      result,
      delay: options.delay,
    },
  }
}

function setup(
  people: P[],
  extra: (server: { people: P[] }) => MockedResponse[] = () => [],
  statusesDelay?: number,
) {
  const server = { people }
  const peopleResult = vi.fn(() => ({ data: { myPeople: server.people } }))
  const alertsResult = vi.fn(() => ({
    data: {
      contactAlerts: server.people.filter((p) =>
        [G.ContactState.Overdue, G.ContactState.DueSoon].includes(p.contactState),
      ),
    },
  }))
  const forever = { maxUsageCount: Number.POSITIVE_INFINITY }
  const mocks: MockedResponse[] = [
    meMock,
    { request: { query: G.MyPeopleDocument }, result: peopleResult, ...forever },
    { request: { query: G.ContactAlertsDocument }, result: alertsResult, ...forever },
    {
      request: { query: G.StatusesDocument },
      result: { data: { statuses: STATUSES } },
      delay: statusesDelay,
      ...forever,
    },
    {
      request: { query: G.MilestonesDocument },
      result: { data: { milestones: MILESTONES } },
      ...forever,
    },
    ...extra(server),
  ]
  const ui = (
    <MockedProvider mocks={mocks}>
      <MemoryRouter>
        <PeoplePage />
      </MemoryRouter>
    </MockedProvider>
  )
  return { ...render(ui), server, peopleResult, alertsResult }
}

const column = (name: string) => screen.getByRole('region', { name })
const names = (region: HTMLElement, level = 3) =>
  within(region)
    .queryAllByRole('heading', { level })
    .map((h) => h.textContent)
const moveMenu = (name: string) =>
  screen.getByRole('combobox', { name: `Move ${name} to another status` })
const cardOf = (name: string) => screen.getByRole('heading', { name }).closest('article')!

/** Waits for the board (people and statuses) to be ready. */
async function ready() {
  await screen.findByRole('heading', { level: 1, name: 'My people' })
  await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  const menus = screen.queryAllByRole('combobox')
  await waitFor(() => menus.forEach((m) => expect(m).toBeEnabled()))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PeoplePage (wide)', () => {
  it('has the header, count, help line and four columns with their rules', async () => {
    setup([ELENA, TOM, OMAR])
    expect(await screen.findByText('3 people you are shepherding')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'My people' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add person' })).toHaveAttribute('href', '/people/new')
    expect(screen.getByText(/Drag a card to another column/)).toBeInTheDocument()

    const rules: [string, string, string][] = [
      ['New contact', '1', 'Follow up within 72 hours'],
      ['Active', '1', 'Contact at least every 7 days'],
      ['Inactive', '1', 'Not tracked for alerts'],
      ['Lost contact', '0', 'Not tracked for alerts'],
    ]
    for (const [name, count, rule] of rules) {
      const region = column(name)
      expect(region).toHaveTextContent(count)
      expect(region).toHaveTextContent(rule)
    }
  })

  it('says "1 person" for a single person', async () => {
    setup([MARIA])
    expect(await screen.findByText('1 person you are shepherding')).toBeInTheDocument()
  })

  it('renders four empty columns for a user with no people (business rule 1)', async () => {
    setup([])
    expect(await screen.findByText('No one is assigned to you yet')).toBeInTheDocument()
    expect(screen.getByText('0 people you are shepherding')).toBeInTheDocument()
    for (const name of ['New contact', 'Active', 'Inactive', 'Lost contact']) {
      const region = column(name)
      expect(region).toHaveTextContent('0')
      expect(region).toHaveTextContent('Drop someone here')
      expect(within(region).queryByRole('article')).not.toBeInTheDocument()
    }
  })

  it('shows each person on a card with their contact, prayers and milestones', async () => {
    setup([MARIA, OMAR])
    await ready()
    const card = within(cardOf('Maria Santos'))
    expect(card.getByRole('link', { name: 'Maria Santos' })).toHaveAttribute(
      'href',
      '/people/p-maria',
    )
    expect(cardOf('Maria Santos')).toHaveTextContent('3 days ago')
    expect(cardOf('Maria Santos')).toHaveTextContent('2 praying')
    expect(
      card.getByRole('img', { name: 'Milestones: 2 of 4: Baptised, Small group' }),
    ).toBeInTheDocument()
    expect(cardOf('Maria Santos')).toHaveTextContent('On track')
  })

  it('renders a person with no contact, milestones or prayer burdens (rules 2 and 3)', async () => {
    setup([OMAR])
    await ready()
    const card = cardOf('Omar Haddad')
    expect(card).toHaveTextContent('No contact yet')
    expect(card).toHaveTextContent('0 praying')
    expect(
      within(card).getByRole('img', { name: 'Milestones: No milestones yet' }),
    ).toBeInTheDocument()
    expect(card).toHaveTextContent('Not tracked')
  })

  it('words the contact tag from the server state', async () => {
    setup([ELENA, MARIA, TOM, AISHA, OMAR, ZOE])
    await ready()
    expect(cardOf('Elena Petrova')).toHaveTextContent('14 days overdue')
    expect(cardOf('Tom Becker')).toHaveTextContent('Follow-up overdue')
    expect(cardOf('Aisha Bello')).toHaveTextContent('5 hours left')
    expect(cardOf('Maria Santos')).toHaveTextContent('On track')
    expect(cardOf('Omar Haddad')).toHaveTextContent('Not tracked')
    expect(cardOf('Zoe Lin')).toHaveTextContent('Not tracked')
  })

  it('words a due-soon active person as due today or due in n days', async () => {
    setup([active('p-today', 'Due Today', 7), active('p-soon', 'Due Soon', 6)])
    await ready()
    expect(cardOf('Due Today')).toHaveTextContent('Due today')
    expect(cardOf('Due Soon')).toHaveTextContent('Due in 1 day')
  })

  it('sorts tracked columns most overdue first and untracked columns by name', async () => {
    setup([MARIA, JAMES, ELENA, ZOE, AMY])
    await ready()
    expect(names(column('Active'))).toEqual(['Elena Petrova', 'James Whitfield', 'Maria Santos'])
    expect(names(column('Lost contact'))).toEqual(['Amy Park', 'Zoe Lin'])
  })

  it('has draggable cards with the move menu offering the other three statuses', async () => {
    setup([MARIA])
    await ready()
    expect(cardOf('Maria Santos')).toHaveAttribute('draggable', 'true')
    const menu = moveMenu('Maria Santos')
    expect(
      within(menu)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Move to', 'New contact', 'Inactive', 'Lost contact'])
  })

  it('disables the move menus until the statuses have loaded', async () => {
    setup([MARIA], () => [], 150)
    await screen.findByText('Maria Santos')
    expect(moveMenu('Maria Santos')).toBeDisabled()
    await waitFor(() => expect(moveMenu('Maria Santos')).toBeEnabled())
  })
})

describe('PeoplePage moving', () => {
  it('moves at once, then confirms with a toast and Undo, and reloads the lists', async () => {
    const user = userEvent.setup()
    let server: { people: P[] }
    const { peopleResult, alertsResult } = setup([MARIA], (s) => {
      server = s
      return [updateMock(MARIA, INACTIVE, s, { delay: 150 }).mock]
    })
    await ready()
    expect(peopleResult).toHaveBeenCalledTimes(1)

    await user.selectOptions(moveMenu('Maria Santos'), 'Inactive')

    // The card is in the new column before the server has answered.
    await waitFor(() =>
      expect(within(column('Inactive')).getByText('Maria Santos')).toBeInTheDocument(),
    )
    expect(within(column('Active')).queryByText('Maria Santos')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()

    expect(
      await screen.findByText(
        'Moved Maria Santos to Inactive. No longer tracked for contact alerts.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(server!.people[0].status.name).toBe('inactive')
    await waitFor(() => expect(peopleResult).toHaveBeenCalledTimes(2))
    expect(alertsResult.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(within(column('Inactive')).getByText('Maria Santos')).toBeInTheDocument()
  })

  it('sends only the new status id', async () => {
    const user = userEvent.setup()
    let result: ReturnType<typeof vi.fn>
    setup([MARIA], (s) => {
      const m = updateMock(MARIA, LOST, s)
      result = m.result
      return [m.mock]
    })
    await ready()
    await user.selectOptions(moveMenu('Maria Santos'), 'Lost contact')
    // The mock only matches { id, input: { statusId } }.
    expect(await screen.findByText(/^Moved Maria Santos to Lost contact\./)).toBeInTheDocument()
    expect(result!).toHaveBeenCalledTimes(1)
  })

  it('says only "Moved … to Active." for a tracked status', async () => {
    const user = userEvent.setup()
    const lapsed = person('p-omar', 'Omar Haddad', { status: INACTIVE })
    setup([lapsed], (s) => [updateMock(lapsed, ACTIVE, s).mock])
    await ready()
    await user.selectOptions(moveMenu('Omar Haddad'), 'Active')
    expect(await screen.findByText('Moved Omar Haddad to Active.')).toBeInTheDocument()
    expect(within(column('Active')).getByText('Omar Haddad')).toBeInTheDocument()
  })

  it('puts focus on the moved person’s menu in the new column', async () => {
    const user = userEvent.setup()
    setup([MARIA], (s) => [updateMock(MARIA, INACTIVE, s).mock])
    await ready()
    await user.selectOptions(moveMenu('Maria Santos'), 'Inactive')
    await waitFor(() => expect(within(column('Inactive')).getByRole('combobox')).toHaveFocus())
  })

  it('moves the card back and says so when the move fails', async () => {
    const user = userEvent.setup()
    const failing: MockedResponse = {
      request: {
        query: G.UpdatePersonDocument,
        variables: { id: MARIA.id, input: { statusId: INACTIVE.id } },
      },
      result: { errors: [new GraphQLError('boom', { extensions: { code: 'INTERNAL' } })] },
      delay: 100,
    }
    setup([MARIA], () => [failing])
    await ready()
    await user.selectOptions(moveMenu('Maria Santos'), 'Inactive')

    expect(
      await screen.findByText(/^Couldn't move Maria\. Something went wrong/),
    ).toBeInTheDocument()
    expect(within(column('Active')).getByText('Maria Santos')).toBeInTheDocument()
    expect(within(column('Inactive')).queryByText('Maria Santos')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('Undo sends the status and the statusChangedAt from the move, then confirms', async () => {
    const user = userEvent.setup()
    const changedAt = at(-1000)
    let undone: ReturnType<typeof vi.fn>
    setup([MARIA], (s) => {
      const back = moved(MARIA, ACTIVE, at(500))
      undone = vi.fn(() => {
        s.people = [back]
        return { data: { undoStatusChange: back } }
      })
      return [
        updateMock(MARIA, INACTIVE, s, { statusChangedAt: changedAt }).mock,
        {
          request: {
            query: G.UndoStatusChangeDocument,
            // The status the person is in after the move, not the one to restore.
            variables: { personId: MARIA.id, statusId: INACTIVE.id, statusChangedAt: changedAt },
          },
          result: undone,
        },
      ]
    })
    await ready()
    await user.selectOptions(moveMenu('Maria Santos'), 'Inactive')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('Maria is back in Active.')).toBeInTheDocument()
    expect(undone!).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(within(column('Active')).getByText('Maria Santos')).toBeInTheDocument(),
    )
  })

  it('explains a conflict when the status changed since', async () => {
    const user = userEvent.setup()
    const changedAt = at(-1000)
    setup([MARIA], (s) => [
      updateMock(MARIA, INACTIVE, s, { statusChangedAt: changedAt }).mock,
      {
        request: {
          query: G.UndoStatusChangeDocument,
          variables: { personId: MARIA.id, statusId: INACTIVE.id, statusChangedAt: changedAt },
        },
        result: {
          errors: [
            new GraphQLError("Maria Santos's status has changed since you moved them.", {
              extensions: { code: 'CONFLICT' },
            }),
          ],
        },
      },
    ])
    await ready()
    await user.selectOptions(moveMenu('Maria Santos'), 'Inactive')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(
      await screen.findByText(
        "Couldn't undo. Maria Santos's status has changed since you moved them.",
      ),
    ).toBeInTheDocument()
  })
})

describe('PeoplePage new contact to Active', () => {
  it('opens the Log contact dialog instead of moving, and Cancel leaves the card', async () => {
    const user = userEvent.setup()
    let result: ReturnType<typeof vi.fn>
    setup([TOM], (s) => {
      const m = updateMock(TOM, ACTIVE, s)
      result = m.result
      return [m.mock]
    })
    await ready()
    await user.selectOptions(moveMenu('Tom Becker'), 'Active')

    expect(await screen.findByRole('dialog', { name: 'Log contact with Tom' })).toBeInTheDocument()
    expect(result!).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(column('New contact')).getByText('Tom Becker')).toBeInTheDocument()
    expect(result!).not.toHaveBeenCalled()
  })

  it('logging the contact closes the dialog and shows the contact toast', async () => {
    const user = userEvent.setup()
    setup([TOM], (s) => {
      const after = {
        ...moved(TOM, ACTIVE),
        lastContactedAt: at(0),
        prayerBurdens: [],
        comments: [],
        contacts: [
          {
            __typename: 'ContactLog',
            id: 'c-1',
            contactedAt: at(0),
            isFollowUp: true,
            createdAt: at(0),
          },
        ],
      }
      return [
        {
          request: {
            query: G.LogContactDocument,
            variables: {
              input: { personId: TOM.id, contactedAt: NOW.toISOString(), note: 'Had coffee' },
            },
          },
          result: () => {
            s.people = [after]
            return { data: { logContact: after } }
          },
        },
      ]
    })
    await ready()
    await user.selectOptions(moveMenu('Tom Becker'), 'Active')
    await user.type(await screen.findByLabelText('Comment (required)'), 'Had coffee')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(
      await screen.findByText(/^Contact logged with Tom\. Tom is now Active\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(within(column('Active')).getByText('Tom Becker')).toBeInTheDocument(),
    )
  })
})

describe('PeoplePage dragging', () => {
  it('moves a dragged card to the column it is dropped on', async () => {
    let result: ReturnType<typeof vi.fn>
    setup([MARIA], (s) => {
      const m = updateMock(MARIA, INACTIVE, s)
      result = m.result
      return [m.mock]
    })
    await ready()

    fireEvent.dragStart(cardOf('Maria Santos'))
    fireEvent.dragOver(column('Inactive'))
    fireEvent.drop(column('Inactive'))

    expect(
      await screen.findByText(
        'Moved Maria Santos to Inactive. No longer tracked for contact alerts.',
      ),
    ).toBeInTheDocument()
    expect(result!).toHaveBeenCalledTimes(1)
    expect(within(column('Inactive')).getByText('Maria Santos')).toBeInTheDocument()
  })

  it('highlights the column being dragged over and clears it on drop', async () => {
    setup([MARIA], (s) => [updateMock(MARIA, INACTIVE, s).mock])
    await ready()

    fireEvent.dragStart(cardOf('Maria Santos'))
    fireEvent.dragOver(column('Inactive'))
    expect(column('Inactive')).toHaveClass(columnStyles.dropActive)
    expect(column('Lost contact')).not.toHaveClass(columnStyles.dropActive)

    fireEvent.drop(column('Inactive'))
    expect(column('Inactive')).not.toHaveClass(columnStyles.dropActive)
    await screen.findByText(/^Moved Maria Santos/)
  })

  it('does nothing when dropped on the card’s own column', async () => {
    let result: ReturnType<typeof vi.fn>
    setup([MARIA], (s) => {
      const m = updateMock(MARIA, INACTIVE, s)
      result = m.result
      return [m.mock]
    })
    await ready()

    fireEvent.dragStart(cardOf('Maria Santos'))
    fireEvent.dragOver(column('Active'))
    fireEvent.drop(column('Active'))

    await new Promise((r) => setTimeout(r, 50))
    expect(result!).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(within(column('Active')).getByText('Maria Santos')).toBeInTheDocument()
  })

  it('ignores a drop that did not start from one of the cards', async () => {
    let result: ReturnType<typeof vi.fn>
    setup([MARIA], (s) => {
      const m = updateMock(MARIA, INACTIVE, s)
      result = m.result
      return [m.mock]
    })
    await ready()

    fireEvent.dragOver(column('Inactive'))
    expect(column('Inactive')).not.toHaveClass(columnStyles.dropActive)
    fireEvent.drop(column('Inactive'))

    await new Promise((r) => setTimeout(r, 50))
    expect(result!).not.toHaveBeenCalled()
    expect(within(column('Active')).getByText('Maria Santos')).toBeInTheDocument()
  })
})

describe('PeoplePage (narrow)', () => {
  const original = window.matchMedia
  beforeEach(() => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(max-width: 719px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
  })
  afterEach(() => {
    window.matchMedia = original
  })

  const tab = (name: string) => screen.getByRole('tab', { name })

  it('shows tabs with counts instead of columns, Active first', async () => {
    setup([MARIA, ELENA, TOM, OMAR])
    await ready()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    const list = screen.getByRole('tablist', { name: 'Status' })
    expect(
      within(list)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['New contact 1', 'Active 2', 'Inactive 1', 'Lost contact 0'])
    expect(tab('Active 2')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Active 2')).toHaveAttribute('tabindex', '0')
    expect(tab('Inactive 1')).toHaveAttribute('tabindex', '-1')

    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('Contact at least every 7 days')
    expect(names(panel, 2)).toEqual(['Elena Petrova', 'Maria Santos'])
    expect(screen.queryByText('Tom Becker')).not.toBeInTheDocument()
  })

  it('has undraggable cards that say "Last contact: …"', async () => {
    setup([MARIA])
    await ready()
    const card = cardOf('Maria Santos')
    expect(card).not.toHaveAttribute('draggable')
    expect(card).toHaveTextContent('Last contact: 3 days ago')
  })

  it('switches tabs on click', async () => {
    const user = userEvent.setup()
    setup([MARIA, TOM])
    await ready()
    await user.click(tab('New contact 1'))
    expect(tab('New contact 1')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Follow up within 72 hours')
    expect(screen.getByText('Tom Becker')).toBeInTheDocument()
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument()
  })

  it('moves selection and focus with the arrow, Home and End keys', async () => {
    const user = userEvent.setup()
    setup([MARIA])
    await ready()
    await user.click(tab('Active 1'))

    await user.keyboard('{ArrowRight}')
    expect(tab('Inactive 0')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Inactive 0')).toHaveFocus()
    expect(tab('Inactive 0')).toHaveAttribute('tabindex', '0')
    expect(tab('Active 1')).toHaveAttribute('tabindex', '-1')

    await user.keyboard('{End}')
    expect(tab('Lost contact 0')).toHaveFocus()
    expect(tab('Lost contact 0')).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')
    expect(tab('New contact 0')).toHaveFocus()
    expect(tab('New contact 0')).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(tab('Lost contact 0')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(tab('Inactive 0')).toHaveFocus()
  })

  it('says so when a tab is empty, including with no people at all', async () => {
    setup([])
    await ready()
    expect(
      screen.getByText('No one here. Move someone into this status from another tab.'),
    ).toBeInTheDocument()
    expect(screen.getByText('No one is assigned to you yet')).toBeInTheDocument()
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(4)
  })

  it('removes a moved card from the tab, words the toast shorter and focuses the panel', async () => {
    const user = userEvent.setup()
    setup([MARIA], (s) => [updateMock(MARIA, INACTIVE, s).mock])
    await ready()
    await user.selectOptions(moveMenu('Maria Santos'), 'Inactive')

    expect(
      await screen.findByText('Moved Maria Santos to Inactive. No longer tracked for alerts.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument()
    expect(screen.getByText(/No one here/)).toBeInTheDocument()
    expect(tab('Inactive 1')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveFocus())
  })
})

describe('PeoplePage accessibility', () => {
  async function violations(container: HTMLElement) {
    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    })
    return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)
  }

  it('has no violations on the wide board', async () => {
    const { container } = setup([ELENA, TOM, MARIA, OMAR])
    await ready()
    expect(await violations(container)).toEqual([])
  })

  it('has no violations on the empty wide board', async () => {
    const { container } = setup([])
    await ready()
    expect(await violations(container)).toEqual([])
  })

  describe('narrow', () => {
    const original = window.matchMedia
    beforeEach(() => {
      window.matchMedia = vi.fn((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia
    })
    afterEach(() => {
      window.matchMedia = original
    })

    it('has no violations on the tabs', async () => {
      const { container } = setup([ELENA, TOM, MARIA, OMAR])
      await ready()
      expect(await violations(container)).toEqual([])
    })
  })
})
