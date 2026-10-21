import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { PersonPage } from './PersonPage'

// Header calls useAuth(); the real provider would build a network client.
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = new Date(2026, 9, 14, 9, 41, 7)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const PERSON_ID = 'person-1'
const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }
const NEW = { __typename: 'Status', id: 'st-new', name: 'new contact' }
const ACTIVE = { __typename: 'Status', id: 'st-active', name: 'active' }
const INACTIVE = { __typename: 'Status', id: 'st-inactive', name: 'inactive' }
const LOST = { __typename: 'Status', id: 'st-lost', name: 'lost contact' }
// Deliberately not in display order: the select's order is fixed by the page.
const STATUSES = [INACTIVE, NEW, LOST, ACTIVE]

type Status = typeof ACTIVE

/** An active person with nothing recorded: no milestones, burdens, comments or contacts. */
function person(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Person',
    id: PERSON_ID,
    name: 'Maria Lopez',
    age: 34,
    yearMet: 2024,
    lastContactedAt: at(-2 * DAY),
    contactDueAt: at(5 * DAY),
    contactClockStart: at(-2 * DAY),
    statusChangedAt: null,
    contactState: G.ContactState.OnTrack,
    createdAt: at(-60 * DAY),
    isActive: true,
    status: ACTIVE,
    recordedMilestoneIds: [],
    activeBurdenCount: 0,
    latestComment: null,
    lastPrayer: null,
    shepherds: [{ __typename: 'User', id: ME.id, name: ME.name }],
    milestones: [],
    prayerBurdens: [],
    comments: [],
    contacts: [],
    prayers: [],
    ...overrides,
  }
}

const newContact = () =>
  person({
    lastContactedAt: null,
    contactDueAt: at(71 * HOUR),
    contactClockStart: at(-HOUR),
    createdAt: at(-HOUR),
    status: NEW,
  })

/** UpdatePerson / UndoStatusChange return the summary, with the tracking fields of the new status. */
function moved(p: ReturnType<typeof person>, to: Status, statusChangedAt: string | null = at(0)) {
  const tracked = to.name === 'active' || to.name === 'new contact'
  return {
    __typename: 'Person',
    id: p.id,
    name: p.name,
    age: p.age,
    yearMet: p.yearMet,
    lastContactedAt: p.lastContactedAt,
    contactDueAt: tracked ? at(7 * DAY) : null,
    contactClockStart: tracked ? at(0) : null,
    contactState: tracked ? G.ContactState.OnTrack : G.ContactState.NotTracked,
    isActive: p.isActive,
    status: to,
    statusChangedAt,
    recordedMilestoneIds: p.recordedMilestoneIds,
    activeBurdenCount: p.activeBurdenCount,
    latestComment: p.latestComment,
    shepherds: p.shepherds,
  }
}

function updateMock(
  from: ReturnType<typeof person>,
  to: Status,
  options: { statusChangedAt?: string | null; delay?: number } = {},
) {
  const after = moved(
    from,
    to,
    options.statusChangedAt === undefined ? at(0) : options.statusChangedAt,
  )
  const result = vi.fn(() => ({ data: { updatePerson: after } }))
  return {
    result,
    mock: {
      request: {
        query: G.UpdatePersonDocument,
        variables: { id: PERSON_ID, input: { statusId: to.id } },
      },
      result,
      delay: options.delay,
    } as MockedResponse,
  }
}

function renderPage(first: object, extra: MockedResponse[] = [], statusesDelay?: number) {
  const forever = { maxUsageCount: Number.POSITIVE_INFINITY }
  // Extras first: the first matching mock wins, so a test can override a default.
  const mocks: MockedResponse[] = [
    ...extra,
    {
      request: { query: G.PersonDocument, variables: { id: PERSON_ID } },
      result: { data: { person: first } },
    },
    { request: { query: G.MeDocument }, result: { data: { me: ME } }, ...forever },
    { request: { query: G.MilestonesDocument }, result: { data: { milestones: [] } }, ...forever },
    {
      request: { query: G.StatusesDocument },
      result: { data: { statuses: STATUSES } },
      delay: statusesDelay,
      ...forever,
    },
    { request: { query: G.MyPeopleDocument }, result: { data: { myPeople: [] } }, ...forever },
    {
      request: { query: G.ContactAlertsDocument },
      result: { data: { contactAlerts: [] } },
      ...forever,
    },
  ]
  render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={[`/people/${PERSON_ID}`]}>
        <Routes>
          <Route path="/people/:id" element={<PersonPage />} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return userEvent.setup()
}

const select = () => screen.getByRole('combobox', { name: 'Change status' })
const headerCard = () => screen.getByRole('region', { name: 'Maria Lopez' })
const about = () => screen.getByRole('complementary', { name: 'About' })
/** Waits for the page and the status list, so the select is enabled. */
async function ready() {
  await screen.findByRole('heading', { level: 1, name: 'Maria Lopez' })
  await waitFor(() => expect(select()).toBeEnabled())
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('Person page status dropdown', () => {
  it('lists the four statuses in order, marking the current one', async () => {
    renderPage(person())
    await ready()
    expect(
      within(select())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Status: Active', 'New contact', 'Inactive', 'Lost contact'])
    expect(select()).toHaveDisplayValue('Status: Active')
  })

  it('prefixes whichever status is current, and reflects it in the value', async () => {
    renderPage(newContact())
    await ready()
    expect(
      within(select())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Active', 'Status: New contact', 'Inactive', 'Lost contact'])
    expect(select()).toHaveDisplayValue('Status: New contact')
  })

  it('is disabled until the statuses have loaded', async () => {
    renderPage(person(), [], 200)
    await screen.findByRole('heading', { level: 1, name: 'Maria Lopez' })
    expect(select()).toBeDisabled()
    await waitFor(() => expect(select()).toBeEnabled())
  })

  it('is in the header card in the wide layout, once', async () => {
    renderPage(person())
    await ready()
    expect(screen.getAllByRole('combobox', { name: 'Change status' })).toHaveLength(1)
    expect(headerCard()).toContainElement(select())
    expect(about()).not.toContainElement(select())
  })

  it('works for a person with no milestones, burdens, comments, contacts, and one shepherd', async () => {
    renderPage(person())
    await ready()
    expect(screen.getByText('0 of 4')).toBeInTheDocument()
    expect(
      screen.getByText('No prayer burdens yet. Add one here, or when you log a contact.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No notes yet. A comment written when you log a contact shows here.'),
    ).toBeInTheDocument()
    expect(select()).toHaveDisplayValue('Status: Active')
  })
})

describe('Person page status dropdown (narrow)', () => {
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

  it('moves into the sidebar Details section under a Status label, out of the header card', async () => {
    renderPage(person())
    await ready()
    expect(screen.getAllByRole('combobox', { name: 'Change status' })).toHaveLength(1)
    expect(headerCard()).not.toContainElement(select())
    expect(about()).toContainElement(select())
    // Details also has a "Status" row (as on the canvas), so check the select's own label.
    const label = select().closest('label') as HTMLElement
    expect(about()).toContainElement(label)
    expect(label).toHaveTextContent(/^Status/)
    expect(label).toBeVisible()
    expect(select()).toHaveDisplayValue('Status: Active')
  })

  it('uses the shorter "alerts" wording in the toast', async () => {
    const user = renderPage(person(), [updateMock(person(), INACTIVE).mock])
    await ready()
    await user.selectOptions(select(), 'Inactive')
    expect(
      await screen.findByText('Moved Maria Lopez to Inactive. No longer tracked for alerts.'),
    ).toBeInTheDocument()
  })
})

describe('Person page status moves', () => {
  it('moves Active to Inactive: optimistic select, toast, and only statusId sent', async () => {
    const m = updateMock(person(), INACTIVE, { delay: 100 })
    const user = renderPage(person(), [m.mock])
    await ready()
    await user.selectOptions(select(), 'Inactive')

    // Shown before the server answers.
    expect(select()).toHaveDisplayValue('Status: Inactive')
    expect(m.result).not.toHaveBeenCalled()
    expect(
      await screen.findByText(
        'Moved Maria Lopez to Inactive. No longer tracked for contact alerts.',
      ),
    ).toBeInTheDocument()
    // The mock only matches { id, input: { statusId } }.
    expect(m.result).toHaveBeenCalledTimes(1)
    expect(select()).toHaveDisplayValue('Status: Inactive')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('moves Active to Lost contact with the not-tracked note', async () => {
    const user = renderPage(person(), [updateMock(person(), LOST).mock])
    await ready()
    await user.selectOptions(select(), 'Lost contact')
    expect(
      await screen.findByText(
        'Moved Maria Lopez to Lost contact. No longer tracked for contact alerts.',
      ),
    ).toBeInTheDocument()
  })

  it('says only "Moved … to Active." for a tracked status', async () => {
    const inactive = person({ status: INACTIVE, isActive: false })
    const user = renderPage(inactive, [updateMock(inactive, ACTIVE).mock])
    await ready()
    await user.selectOptions(select(), 'Active')
    expect(await screen.findByText('Moved Maria Lopez to Active.')).toBeInTheDocument()
  })

  it('moves a new contact to Inactive directly, without the dialog', async () => {
    const m = updateMock(newContact(), INACTIVE)
    const user = renderPage(newContact(), [m.mock])
    await ready()
    await user.selectOptions(select(), 'Inactive')
    expect(await screen.findByText(/^Moved Maria Lopez to Inactive\./)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(m.result).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the current status is picked', async () => {
    const m = updateMock(person(), ACTIVE)
    const user = renderPage(person(), [m.mock])
    await ready()
    await user.selectOptions(select(), 'Status: Active')
    await new Promise((r) => setTimeout(r, 50))
    expect(m.result).not.toHaveBeenCalled()
    expect(screen.queryByText(/^Moved /)).not.toBeInTheDocument()
    expect(select()).toHaveDisplayValue('Status: Active')
  })

  it('hides the contact progress bar once an active person is moved to Inactive', async () => {
    const user = renderPage(person(), [updateMock(person(), INACTIVE).mock])
    await ready()
    expect(screen.getByRole('img', { name: /since last contact/ })).toBeInTheDocument()
    await user.selectOptions(select(), 'Inactive')
    await screen.findByText(/^Moved Maria Lopez/)
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
    expect(screen.getByText(/Contact reminders are off/)).toBeInTheDocument()
  })

  it('refetches My people and the contact alerts after a move', async () => {
    const people = vi.fn(() => ({ data: { myPeople: [] } }))
    const alerts = vi.fn(() => ({ data: { contactAlerts: [] } }))
    const forever = { maxUsageCount: Number.POSITIVE_INFINITY }
    const user = renderPage(person(), [
      updateMock(person(), INACTIVE).mock,
      { request: { query: G.MyPeopleDocument }, result: people, ...forever },
      { request: { query: G.ContactAlertsDocument }, result: alerts, ...forever },
    ])
    await ready()
    const before = { people: people.mock.calls.length, alerts: alerts.mock.calls.length }
    await user.selectOptions(select(), 'Inactive')
    await screen.findByText(/^Moved Maria Lopez/)
    await waitFor(() => expect(people.mock.calls.length).toBeGreaterThan(before.people))
    await waitFor(() => expect(alerts.mock.calls.length).toBeGreaterThan(before.alerts))
    expect(select()).toHaveDisplayValue('Status: Inactive')
  })
})

describe('Person page status move failure and undo', () => {
  it('puts the old status back and says so when the move fails', async () => {
    const failing: MockedResponse = {
      request: {
        query: G.UpdatePersonDocument,
        variables: { id: PERSON_ID, input: { statusId: INACTIVE.id } },
      },
      result: { errors: [new GraphQLError('boom', { extensions: { code: 'INTERNAL' } })] },
      delay: 100,
    }
    const user = renderPage(person(), [failing])
    await ready()
    await user.selectOptions(select(), 'Inactive')

    expect(
      await screen.findByText(/^Couldn't move Maria\. Something went wrong/),
    ).toBeInTheDocument()
    expect(select()).toHaveDisplayValue('Status: Active')
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('reports a network failure with the connection message', async () => {
    const failing: MockedResponse = {
      request: {
        query: G.UpdatePersonDocument,
        variables: { id: PERSON_ID, input: { statusId: LOST.id } },
      },
      error: new Error('offline'),
    }
    const user = renderPage(person(), [failing])
    await ready()
    await user.selectOptions(select(), 'Lost contact')
    expect(
      await screen.findByText(/^Couldn't move Maria\. Couldn't reach the server/),
    ).toBeInTheDocument()
    expect(select()).toHaveDisplayValue('Status: Active')
  })

  it('Undo sends the status and statusChangedAt from the move, then confirms', async () => {
    const changedAt = at(-1000)
    const back = moved(person(), ACTIVE, at(500))
    const undone = vi.fn(() => ({ data: { undoStatusChange: back } }))
    const user = renderPage(person(), [
      updateMock(person(), INACTIVE, { statusChangedAt: changedAt }).mock,
      {
        request: {
          query: G.UndoStatusChangeDocument,
          // The status the person is in after the move, not the one to restore.
          variables: { personId: PERSON_ID, statusId: INACTIVE.id, statusChangedAt: changedAt },
        },
        result: undone,
      },
    ])
    await ready()
    await user.selectOptions(select(), 'Inactive')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('Maria is back in Active.')).toBeInTheDocument()
    expect(undone).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(select()).toHaveDisplayValue('Status: Active'))
  })

  it('has no Undo when the response has no statusChangedAt', async () => {
    const user = renderPage(person(), [
      updateMock(person(), INACTIVE, { statusChangedAt: null }).mock,
    ])
    await ready()
    await user.selectOptions(select(), 'Inactive')
    expect(await screen.findByText(/^Moved Maria Lopez to Inactive/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('explains a conflict when the status changed since', async () => {
    const changedAt = at(-1000)
    const user = renderPage(person(), [
      updateMock(person(), INACTIVE, { statusChangedAt: changedAt }).mock,
      {
        request: {
          query: G.UndoStatusChangeDocument,
          variables: { personId: PERSON_ID, statusId: INACTIVE.id, statusChangedAt: changedAt },
        },
        result: {
          errors: [
            new GraphQLError("Maria Lopez's status has changed since you moved them.", {
              extensions: { code: 'CONFLICT' },
            }),
          ],
        },
      },
    ])
    await ready()
    await user.selectOptions(select(), 'Inactive')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByText(
        "Couldn't undo. Maria Lopez's status has changed since you moved them.",
      ),
    ).toBeInTheDocument()
  })
})

describe('Person page new contact to Active', () => {
  const dialog = () => screen.findByRole('dialog', { name: 'Log contact with Maria' })

  it('opens the Log contact dialog instead of moving, and Cancel leaves the status', async () => {
    const m = updateMock(newContact(), ACTIVE)
    const user = renderPage(newContact(), [m.mock])
    await ready()
    await user.selectOptions(select(), 'Active')

    expect(await dialog()).toBeInTheDocument()
    expect(m.result).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(select()).toHaveDisplayValue('Status: New contact')
    expect(select()).toHaveDisplayValue('Status: New contact')
    expect(m.result).not.toHaveBeenCalled()
  })

  it('logging the contact makes them Active and shows the contact toast', async () => {
    const after = {
      ...newContact(),
      status: ACTIVE,
      lastContactedAt: at(0),
      contactDueAt: at(7 * DAY),
      contactClockStart: at(0),
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
    const rest: Record<string, unknown> = { ...after }
    delete rest.createdAt
    delete rest.milestones
    const update = updateMock(newContact(), ACTIVE)
    const user = renderPage(newContact(), [
      update.mock,
      {
        request: {
          query: G.LogContactDocument,
          variables: {
            input: { personId: PERSON_ID, contactedAt: NOW.toISOString(), note: 'Had coffee' },
          },
        },
        result: { data: { logContact: rest } },
      },
    ])
    await ready()
    await user.selectOptions(select(), 'Active')
    await dialog()
    await user.type(screen.getByLabelText('Comment (required)'), 'Had coffee')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(
      await screen.findByText(/^Contact logged with Maria\. Maria is now Active\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(select()).toHaveDisplayValue('Status: Active')
    expect(update.result).not.toHaveBeenCalled()
  })
})
