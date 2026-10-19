import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDateTime } from '../format'
import * as G from '../generated/graphql'
import { PersonPage } from './PersonPage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const PERSON_ID = 'person-1'
const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }
const ST_ACTIVE = { __typename: 'Status', id: 'st-1', name: 'Active' }
const ST_AWAY = { __typename: 'Status', id: 'st-2', name: 'Away' }
const ST_NEW = { __typename: 'Status', id: 'st-3', name: 'new contact' }
const STATUSES = [ST_ACTIVE, ST_AWAY, ST_NEW]

function person(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Person',
    id: PERSON_ID,
    name: 'Sam Sheep',
    age: 30,
    yearMet: 2020,
    lastContactedAt: '2026-01-02 09:00:00+00',
    contactDueAt: '2026-01-09 09:00:00+00',
    contactState: G.ContactState.Overdue,
    isActive: true,
    status: ST_ACTIVE,
    recordedMilestoneIds: [],
    activeBurdenCount: 0,
    latestComment: null,
    shepherds: [],
    milestones: [],
    prayerBurdens: [],
    comments: [],
    contacts: [],
    ...overrides,
  }
}

// UpdatePerson selects only PersonSummary; the cache merges it by id.
function summary(overrides: Record<string, unknown> = {}) {
  const p = person(overrides) as Record<string, unknown>
  return {
    __typename: 'Person',
    id: PERSON_ID,
    name: p.name,
    age: p.age,
    yearMet: p.yearMet,
    lastContactedAt: p.lastContactedAt,
    contactDueAt: p.contactDueAt,
    contactState: p.contactState,
    isActive: p.isActive,
    status: p.status,
    recordedMilestoneIds: p.recordedMilestoneIds,
    activeBurdenCount: p.activeBurdenCount,
    latestComment: p.latestComment,
    shepherds: p.shepherds,
  }
}

function updateMock(input: Record<string, unknown>, updated: Record<string, unknown> = {}) {
  const result = vi.fn(() => ({ data: { updatePerson: summary({ ...input, ...updated }) } }))
  return {
    result,
    mock: {
      request: { query: G.UpdatePersonDocument, variables: { id: PERSON_ID, input } },
      result,
    } as MockedResponse,
  }
}

function renderPage(first: object, extra: MockedResponse[] = []) {
  const mocks: MockedResponse[] = [
    {
      request: { query: G.PersonDocument, variables: { id: PERSON_ID } },
      result: { data: { person: first } },
    },
    {
      request: { query: G.MeDocument },
      result: { data: { me: ME } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: G.MilestonesDocument },
      result: { data: { milestones: [] } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: G.StatusesDocument },
      result: { data: { statuses: STATUSES } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: G.ContactAlertsDocument },
      result: { data: { contactAlerts: [] } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: G.MyPeopleDocument },
      result: { data: { myPeople: [] } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    ...extra,
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
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Edit details' }))
  await screen.findByRole('button', { name: 'Save' })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('edit person form', () => {
  it('opens prefilled with the current values', async () => {
    const user = userEvent.setup()
    renderPage(person({ status: ST_AWAY, isActive: false }))
    await openForm(user)
    expect(screen.getByLabelText('Name')).toHaveValue('Sam Sheep')
    expect(await screen.findByLabelText('Status')).toHaveValue('st-2')
    expect(screen.getByLabelText(/^Age/)).toHaveValue(30)
    expect(screen.getByLabelText(/^Year met/)).toHaveValue(2020)
    expect(screen.getByLabelText('Active')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('requires name, and requires optional fields that already have a value', async () => {
    const user = userEvent.setup()
    renderPage(person())
    await openForm(user)
    expect(screen.getByLabelText('Name')).toBeRequired()
    expect(screen.getByLabelText(/^Age/)).toBeRequired()
    expect(screen.getByLabelText(/^Year met/)).toBeRequired()
  })

  it('has no last contact field: contacts are logged, not edited', async () => {
    const user = userEvent.setup()
    renderPage(person())
    await openForm(user)
    expect(screen.queryByLabelText(/^Last contact/)).not.toBeInTheDocument()
  })

  it('opens with blank, non-required fields for a person with no age or year met', async () => {
    const user = userEvent.setup()
    renderPage(person({ age: null, yearMet: null }))
    await openForm(user)
    expect(screen.getByLabelText(/^Age/)).toHaveDisplayValue('')
    expect(screen.getByLabelText(/^Year met/)).toHaveDisplayValue('')
    for (const label of [/^Age/, /^Year met/]) {
      expect(screen.getByLabelText(label)).not.toBeRequired()
    }
  })

  it('sends only the changed field', async () => {
    const user = userEvent.setup()
    const { mock, result } = updateMock({ age: 31 })
    renderPage(person(), [mock])
    await openForm(user)
    const age = screen.getByLabelText(/^Age/)
    await user.clear(age)
    await user.type(age, '31')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('31')).toBeInTheDocument()
    expect(result).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('trims the name and sends status and active changes', async () => {
    const user = userEvent.setup()
    const { mock, result } = updateMock(
      { name: 'Sam Lamb', statusId: 'st-2', isActive: false },
      { status: ST_AWAY },
    )
    renderPage(person(), [mock])
    await openForm(user)
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, '  Sam Lamb  ')
    await user.selectOptions(await screen.findByLabelText('Status'), 'Away')
    await user.click(screen.getByLabelText('Active'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Sam Lamb')).toBeInTheDocument()
    expect(result).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('fills in empty optional fields, sending numbers', async () => {
    const user = userEvent.setup()
    const { mock, result } = updateMock({ age: 40, yearMet: 2024 })
    renderPage(person({ age: null, yearMet: null }), [mock])
    await openForm(user)
    await user.type(screen.getByLabelText(/^Age/), '40')
    await user.type(screen.getByLabelText(/^Year met/), '2024')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('2024')).toBeInTheDocument()
    expect(result).toHaveBeenCalledTimes(1)
  })

  it('sends no mutation and closes when nothing changed', async () => {
    const user = userEvent.setup()
    const { mock, result } = updateMock({})
    renderPage(person(), [mock])
    await openForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('button', { name: 'Edit details' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
  })

  it('shows the error, keeps the form open and keeps the input when save fails', async () => {
    const user = userEvent.setup()
    const failing: MockedResponse = {
      request: { query: G.UpdatePersonDocument, variables: { id: PERSON_ID, input: { age: 31 } } },
      result: {
        errors: [
          new GraphQLError('Age is not allowed', { extensions: { code: 'BAD_USER_INPUT' } }),
        ],
      },
    }
    renderPage(person(), [failing])
    await openForm(user)
    const age = screen.getByLabelText(/^Age/)
    await user.clear(age)
    await user.type(age, '31')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Age is not allowed')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Age/)).toHaveValue(31)
  })

  it('cancel closes without a mutation and reopening shows the original values', async () => {
    const user = userEvent.setup()
    const { mock, result } = updateMock({ name: 'Abandoned' })
    renderPage(person(), [mock])
    await openForm(user)
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Abandoned')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByText('Abandoned')).not.toBeInTheDocument()
    expect(screen.getByText('Sam Sheep')).toBeInTheDocument()
    await openForm(user)
    expect(screen.getByLabelText('Name')).toHaveValue('Sam Sheep')
    expect(result).not.toHaveBeenCalled()
  })
})

describe('contacted today', () => {
  // Local noon, 2026-10-14.
  const NOW = new Date(2026, 9, 14, 12, 0, 0)

  function freezeToday() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  }

  /** LogContact returns the summary plus the logged contact's id. */
  function logMock(isFollowUp: boolean, updated: Record<string, unknown> = {}) {
    const result = vi.fn(() => ({
      data: {
        logContact: {
          ...summary({
            lastContactedAt: NOW.toISOString(),
            contactDueAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
            contactState: G.ContactState.OnTrack,
            ...updated,
          }),
          contacts: [{ __typename: 'ContactLog', id: 'contact-new' }],
        },
      },
    }))
    return {
      result,
      mock: {
        request: {
          query: G.LogContactDocument,
          variables: { input: { personId: PERSON_ID, isFollowUp } },
        },
        result,
      } as MockedResponse,
    }
  }

  it('logs a contact now and shows the new state, with an Undo', async () => {
    freezeToday()
    const user = userEvent.setup()
    const { mock, result } = logMock(false)
    renderPage(person(), [mock])
    expect(await screen.findByText(/^Overdue/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Contacted today' }))

    expect(await screen.findByText('Contact logged.')).toBeInTheDocument()
    expect(screen.getByText(formatDateTime(NOW.toISOString()))).toBeInTheDocument()
    expect(screen.getByText('On track')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(result).toHaveBeenCalledTimes(1)
  })

  it('undo deletes the contact just logged', async () => {
    freezeToday()
    const user = userEvent.setup()
    const { mock } = logMock(false)
    const undone = vi.fn(() => ({
      data: { deleteContact: { ...summary(), contacts: [] } },
    }))
    const undoMock: MockedResponse = {
      request: { query: G.DeleteContactDocument, variables: { id: 'contact-new' } },
      result: undone,
    }
    renderPage(person(), [mock, undoMock])
    await user.click(await screen.findByRole('button', { name: 'Contacted today' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(await screen.findByRole('button', { name: 'Contacted today' })).toBeInTheDocument()
    expect(screen.getByText(/^Overdue/)).toBeInTheDocument()
    expect(undone).toHaveBeenCalledTimes(1)
  })

  it('works for a person who has never been contacted', async () => {
    freezeToday()
    const user = userEvent.setup()
    const { mock, result } = logMock(false)
    renderPage(person({ lastContactedAt: null }), [mock])
    await user.click(await screen.findByRole('button', { name: 'Contacted today' }))

    expect(await screen.findByText('Contact logged.')).toBeInTheDocument()
    expect(result).toHaveBeenCalledTimes(1)
  })

  it('offers a follow-up for a new contact, which moves them to active without an Undo', async () => {
    freezeToday()
    const user = userEvent.setup()
    const { mock, result } = logMock(true, { status: ST_ACTIVE })
    renderPage(person({ status: ST_NEW, contactState: G.ContactState.DueSoon }), [mock])
    await user.click(await screen.findByRole('button', { name: 'Followed up today' }))

    expect(await screen.findByText('Active', { selector: '.badge' })).toBeInTheDocument()
    expect(result).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Followed up today' })).not.toBeInTheDocument()
  })

  it('does not offer a follow-up to someone who is already active', async () => {
    renderPage(person())
    await screen.findByRole('button', { name: 'Contacted today' })
    expect(screen.queryByRole('button', { name: 'Followed up today' })).not.toBeInTheDocument()
  })

  it('is hidden when an active person was already contacted today', async () => {
    freezeToday()
    renderPage(person({ lastContactedAt: NOW.toISOString(), contactState: G.ContactState.OnTrack }))
    await screen.findByRole('button', { name: 'Edit details' })
    expect(screen.queryByRole('button', { name: 'Contacted today' })).not.toBeInTheDocument()
  })
})
