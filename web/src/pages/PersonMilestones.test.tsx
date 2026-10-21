import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const PERSON_ID = 'person-1'
const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }
// A Wednesday morning, local time.
const NOW = new Date(2026, 9, 14, 9, 41, 7)

const BAPTISED = { __typename: 'Milestone', id: 'ms-baptised', name: 'baptised', description: 'b' }
const GROUP = {
  __typename: 'Milestone',
  id: 'ms-group',
  name: 'joined small group',
  description: 'g',
}
const SERVING = { __typename: 'Milestone', id: 'ms-serving', name: 'serving', description: 's' }
const LEADING = { __typename: 'Milestone', id: 'ms-leading', name: 'leading', description: 'l' }
const CONFIRMED = {
  __typename: 'Milestone',
  id: 'ms-confirmed',
  name: 'Confirmed',
  description: 'c',
}
const TYPES = [BAPTISED, GROUP, SERVING, LEADING]

type MilestoneType = typeof BAPTISED

function recorded(
  rowId: string,
  type: MilestoneType,
  opts: { dateAchieved?: string | null; notes?: string | null } = {},
) {
  return {
    __typename: 'MilestonePerson',
    id: rowId,
    dateAchieved: opts.dateAchieved === undefined ? '2026-01-02' : opts.dateAchieved,
    notes: opts.notes ?? null,
    milestone: { __typename: 'Milestone', id: type.id, name: type.name },
    recordedBy: { __typename: 'User', id: ME.id, name: ME.name },
  }
}

function person(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Person',
    id: PERSON_ID,
    name: 'Sam Sheep',
    age: null,
    yearMet: null,
    lastContactedAt: null,
    contactDueAt: null,
    contactClockStart: null,
    statusChangedAt: null,
    createdAt: '2026-10-14 18:26:10.89+00',
    contactState: 'NOT_TRACKED',
    isActive: true,
    status: { __typename: 'Status', id: 'st-1', name: 'Active' },
    shepherds: [],
    milestones: [],
    prayerBurdens: [],
    comments: [],
    contacts: [],
    ...overrides,
  }
}

interface Options {
  milestoneTypes?: MilestoneType[]
  mutation?: { request: MockedResponse['request']; result: MockedResponse['result'] }
}

// Renders the page with the first Person response, plus a second one that
// the post-mutation refetch consumes. Returns spies for both.
function renderPage(first: object, opts: Options = {}, after: object = first) {
  const refetch = vi.fn(() => ({ data: { person: after } }))
  const mocks: MockedResponse[] = [
    {
      request: { query: G.PersonDocument, variables: { id: PERSON_ID } },
      result: () => ({ data: { person: first } }),
    },
    { request: { query: G.PersonDocument, variables: { id: PERSON_ID } }, result: refetch },
    {
      request: { query: G.MeDocument },
      result: { data: { me: ME } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: G.MilestonesDocument },
      result: { data: { milestones: opts.milestoneTypes ?? TYPES } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ]
  if (opts.mutation) mocks.push(opts.mutation)
  render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={[`/people/${PERSON_ID}`]}>
        <Routes>
          <Route path="/people/:id" element={<PersonPage />} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return { refetch }
}

function mutationMock(
  query: unknown,
  variables: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  const result = vi.fn(() => ({ data }))
  return {
    result,
    mutation: { request: { query, variables } as MockedResponse['request'], result },
  }
}

const recordMock = (milestoneId: string, dateAchieved: string | null, notes: string | null) =>
  mutationMock(
    G.RecordMilestoneDocument,
    { input: { personId: PERSON_ID, milestoneId, dateAchieved, notes } },
    { recordMilestone: { __typename: 'MilestonePerson', id: 'mp-new' } },
  )

const removeVars = (milestoneId: string) => ({ personId: PERSON_ID, milestoneId })

/** The list item holding the given button (or text). */
const itemOf = (el: HTMLElement) => el.closest('li') as HTMLElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

async function ready(name = 'Record Baptised') {
  // Record buttons need the Milestones query; Remove buttons only the person.
  return screen.findByRole('button', { name })
}

describe('PersonPage milestones section', () => {
  it('shows 0 of 4 and four Record buttons for a person with no milestones', async () => {
    renderPage(person())
    await ready()
    expect(screen.getByRole('heading', { level: 2, name: 'Milestones' })).toBeInTheDocument()
    expect(screen.getByText('0 of 4')).toBeInTheDocument()
    expect(screen.queryByText('No milestones yet.')).not.toBeInTheDocument()
    for (const label of ['Baptised', 'Small group', 'Serving', 'Leading']) {
      expect(screen.getByRole('button', { name: `Record ${label}` })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: `Remove ${label}` })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('heading', { name: 'Other milestones' })).not.toBeInTheDocument()
  })

  it('shows 4 of 4 and no Record buttons when all four are recorded', async () => {
    renderPage(person({ milestones: TYPES.map((t, i) => recorded(`mp${i}`, t)) }))
    await screen.findByRole('button', { name: 'Remove Baptised' })
    expect(screen.getByText('4 of 4')).toBeInTheDocument()
    for (const label of ['Baptised', 'Small group', 'Serving', 'Leading']) {
      expect(screen.getByRole('button', { name: `Remove ${label}` })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /^Record / })).not.toBeInTheDocument()
  })

  it('handles steps recorded out of order', async () => {
    renderPage(person({ milestones: [recorded('mp1', LEADING)] }))
    await ready()
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Leading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record Leading' })).not.toBeInTheDocument()
    for (const label of ['Baptised', 'Small group', 'Serving']) {
      expect(screen.getByRole('button', { name: `Record ${label}` })).toBeInTheDocument()
    }
  })

  it('lists the four steps in the journey order whatever order the API returns', async () => {
    renderPage(
      person({
        milestones: [recorded('a', LEADING), recorded('b', BAPTISED), recorded('c', SERVING)],
      }),
      { milestoneTypes: [LEADING, SERVING, GROUP, BAPTISED] },
    )
    await ready('Record Small group')
    const labels = ['Baptised', 'Small group', 'Serving', 'Leading']
    const items = screen
      .getAllByRole('listitem')
      .filter((li) => labels.some((l) => li.textContent?.includes(l)))
    expect(items.map((li) => labels.find((l) => li.textContent?.includes(l)))).toEqual(labels)
  })

  it('shows a relative time with the full date in a time element, and no recorder', async () => {
    renderPage(
      person({
        milestones: [
          recorded('a', BAPTISED, { dateAchieved: '2021-10-14' }),
          recorded('b', GROUP, { dateAchieved: '2026-10-11' }),
          recorded('c', SERVING, { dateAchieved: '2026-10-14' }),
        ],
      }),
    )
    await ready('Record Leading')
    expect(
      within(itemOf(screen.getByRole('button', { name: 'Remove Baptised' }))).getByText(
        '5 years ago',
      ),
    ).toBeInTheDocument()
    const group = within(itemOf(screen.getByRole('button', { name: 'Remove Small group' })))
    expect(group.getByText('3 days ago')).toBeInTheDocument()
    expect(
      within(itemOf(screen.getByRole('button', { name: 'Remove Serving' }))).getByText('Today'),
    ).toBeInTheDocument()
    const time = group.getByText('3 days ago').closest('time') ?? group.getByText('3 days ago')
    expect(time.getAttribute('datetime') ?? time.getAttribute('title')).toContain('2026')
    expect(screen.queryByText(/Recorded by/)).not.toBeInTheDocument()
    expect(group.queryByText('Me Shepherd')).not.toBeInTheDocument()
  })

  it('says "Date not recorded" for a null date and shows no note when there is none', async () => {
    renderPage(person({ milestones: [recorded('a', BAPTISED, { dateAchieved: null })] }))
    const item = itemOf(await screen.findByRole('button', { name: 'Remove Baptised' }))
    expect(within(item).getByText('Date not recorded')).toBeInTheDocument()
    expect(item.textContent).not.toMatch(/null|undefined/)
  })

  it('shows the note when there is one', async () => {
    renderPage(person({ milestones: [recorded('a', BAPTISED, { notes: 'At the lake' })] }))
    const item = itemOf(await screen.findByRole('button', { name: 'Remove Baptised' }))
    expect(within(item).getByText('At the lake')).toBeInTheDocument()
  })

  it('does not offer Record until the Milestones query has no type for it', async () => {
    renderPage(person(), { milestoneTypes: [] })
    await screen.findByText('0 of 4')
    // Let the Milestones query settle.
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: /^Record / })).not.toBeInTheDocument()
    expect(screen.queryByText('No milestones yet.')).not.toBeInTheDocument()
  })

  it('offers Record only for steps the API has a type for', async () => {
    renderPage(person(), { milestoneTypes: [BAPTISED] })
    await ready()
    expect(screen.queryByRole('button', { name: 'Record Serving' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record Leading' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record Small group' })).not.toBeInTheDocument()
  })
})

describe('PersonPage record milestone dialog', () => {
  it('opens a dialog titled with the full milestone name, empty, with an optional date capped at today', async () => {
    const user = userEvent.setup()
    renderPage(person())
    await user.click(await ready('Record Small group'))
    const dialog = screen.getByRole('dialog', { name: 'Joined small group' })
    const date = within(dialog).getByLabelText(/^Date achieved/)
    expect(date).toHaveAttribute('type', 'date')
    expect(date).toHaveValue('')
    expect(date).toHaveAttribute('max', '2026-10-14')
    expect(date.labels?.[0]).toHaveTextContent('(optional)')
    expect(within(dialog).getByLabelText(/^Note/)).toHaveValue('')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Record milestone' })).toBeInTheDocument()
  })

  it('records with a date and trimmed note, closes, and refetches', async () => {
    const user = userEvent.setup()
    const { mutation, result } = recordMock('ms-group', '2026-10-10', 'At the Sunday service')
    const { refetch } = renderPage(person(), { mutation })
    await user.click(await ready('Record Small group'))
    const dialog = screen.getByRole('dialog', { name: 'Joined small group' })
    fireEvent.change(within(dialog).getByLabelText(/^Date achieved/), {
      target: { value: '2026-10-10' },
    })
    await user.type(within(dialog).getByLabelText(/^Note/), '  At the Sunday service  ')
    await user.click(within(dialog).getByRole('button', { name: 'Record milestone' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('sends null, not empty strings, for a blank date and whitespace-only note', async () => {
    const user = userEvent.setup()
    const { mutation, result } = recordMock('ms-serving', null, null)
    const { refetch } = renderPage(person(), { mutation })
    await user.click(await ready('Record Serving'))
    const dialog = screen.getByRole('dialog', { name: 'Serving' })
    await user.type(within(dialog).getByLabelText(/^Note/), '   ')
    await user.click(within(dialog).getByRole('button', { name: 'Record milestone' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('rejects a future date and sends nothing', async () => {
    const user = userEvent.setup()
    const { mutation, result } = recordMock('ms-leading', '2026-10-15', null)
    renderPage(person(), { mutation })
    await user.click(await ready('Record Leading'))
    const dialog = screen.getByRole('dialog', { name: 'Leading' })
    fireEvent.change(within(dialog).getByLabelText(/^Date achieved/), {
      target: { value: '2026-10-15' },
    })
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)
    expect(await within(dialog).findByText("The date can't be in the future.")).toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('Cancel closes the dialog and records nothing', async () => {
    const user = userEvent.setup()
    const { mutation, result } = recordMock('ms-baptised', null, null)
    const { refetch } = renderPage(person(), { mutation })
    await user.click(await ready())
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
  })

  it('the Close button closes the dialog and records nothing', async () => {
    const user = userEvent.setup()
    const { mutation, result } = recordMock('ms-baptised', null, null)
    renderPage(person(), { mutation })
    await user.click(await ready())
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Close/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
  })

  it('starts empty each time it opens', async () => {
    const user = userEvent.setup()
    renderPage(person())
    await user.click(await ready())
    let dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Date achieved/), {
      target: { value: '2026-10-10' },
    })
    await user.type(within(dialog).getByLabelText(/^Note/), 'draft')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Record Baptised' }))
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText(/^Date achieved/)).toHaveValue('')
    expect(within(dialog).getByLabelText(/^Note/)).toHaveValue('')
  })

  it('stays open and shows a friendly alert when recording fails', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.RecordMilestoneDocument,
        variables: {
          input: {
            personId: PERSON_ID,
            milestoneId: 'ms-baptised',
            dateAchieved: null,
            notes: null,
          },
        },
      } as MockedResponse['request'],
      result: { errors: [new GraphQLError('db exploded')] },
    }
    renderPage(person(), { mutation })
    await user.click(await ready())
    const dialog = screen.getByRole('dialog', { name: 'Baptised' })
    await user.click(within(dialog).getByRole('button', { name: 'Record milestone' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(alert).not.toHaveTextContent('db exploded')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows Saving… and disables submit while saving', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.RecordMilestoneDocument,
        variables: {
          input: {
            personId: PERSON_ID,
            milestoneId: 'ms-baptised',
            dateAchieved: null,
            notes: null,
          },
        },
      } as MockedResponse['request'],
      result: { data: { recordMilestone: { __typename: 'MilestonePerson', id: 'mp-new' } } },
      delay: 200,
    }
    renderPage(person(), { mutation })
    await user.click(await ready())
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Record milestone' }))
    const saving = await within(dialog).findByRole('button', { name: 'Saving…' })
    expect(saving).toBeDisabled()
  })
})

describe('PersonPage remove milestone', () => {
  it('removes using the milestone type id, not the row id, then refetches', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.RemoveMilestoneDocument,
      removeVars('ms-baptised'),
      { removeMilestone: true },
    )
    const { refetch } = renderPage(person({ milestones: [recorded('mp-row-1', BAPTISED)] }), {
      mutation,
    })
    await user.click(await screen.findByRole('button', { name: 'Remove Baptised' }))
    expect(result).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Remove Baptised?' })
    expect(dialog).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cancelling closes the dialog and sends no mutation', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.RemoveMilestoneDocument,
      removeVars('ms-baptised'),
      { removeMilestone: true },
    )
    const { refetch } = renderPage(person({ milestones: [recorded('mp-row-1', BAPTISED)] }), {
      mutation,
    })
    await user.click(await screen.findByRole('button', { name: 'Remove Baptised' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Remove Baptised?' })).getByRole('button', {
        name: 'Cancel',
      }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Baptised' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
  })

  it('shows the friendly generic alert, not the raw message, when removal fails', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.RemoveMilestoneDocument,
        variables: removeVars('ms-baptised'),
      } as MockedResponse['request'],
      result: { errors: [new GraphQLError('Cannot remove')] },
    }
    renderPage(person({ milestones: [recorded('mp-row-1', BAPTISED)] }), { mutation })
    await user.click(await screen.findByRole('button', { name: 'Remove Baptised' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Baptised?' })
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(alert).not.toHaveTextContent('Cannot remove')
    expect(screen.getByRole('dialog', { name: 'Remove Baptised?' })).toBeInTheDocument()
  })

  it('shows the NOT_FOUND sentence when removed elsewhere', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.RemoveMilestoneDocument,
        variables: removeVars('ms-baptised'),
      } as MockedResponse['request'],
      result: { errors: [new GraphQLError('Not found', { extensions: { code: 'NOT_FOUND' } })] },
    }
    renderPage(person({ milestones: [recorded('mp-row-1', BAPTISED)] }), { mutation })
    await user.click(await screen.findByRole('button', { name: 'Remove Baptised' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    expect(
      await within(screen.getByRole('dialog', { name: 'Remove Baptised?' })).findByRole('alert'),
    ).toHaveTextContent('This was changed or removed by someone else.')
  })
})

describe('PersonPage other milestones', () => {
  it('lists unrecognised types under Other milestones, not counted, and recordable', async () => {
    const user = userEvent.setup()
    const { mutation, result } = recordMock('ms-confirmed', null, null)
    renderPage(person(), { milestoneTypes: [...TYPES, CONFIRMED], mutation })
    await user.click(await screen.findByRole('button', { name: 'Record Confirmed' }))
    expect(screen.getByRole('dialog', { name: 'Confirmed' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Other milestones' })).toBeInTheDocument()
    expect(screen.getByText('0 of 4')).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Record milestone' }),
    )
    await waitFor(() => expect(result).toHaveBeenCalled())
  })

  it('shows a recorded other milestone with Remove, still counting only the four', async () => {
    renderPage(person({ milestones: [recorded('mp-c', CONFIRMED)] }), {
      milestoneTypes: [...TYPES, CONFIRMED],
    })
    await screen.findByRole('button', { name: 'Remove Confirmed' })
    expect(screen.getByRole('heading', { name: 'Other milestones' })).toBeInTheDocument()
    expect(screen.getByText('0 of 4')).toBeInTheDocument()
  })
})

describe('PersonPage milestones (narrow)', () => {
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

  it('uses the long step name and "Record milestone" on phones', async () => {
    renderPage(person())
    const record = await screen.findByRole('button', {
      name: 'Record milestone: Joined small group',
    })
    expect(record).toHaveTextContent('Record milestone')
    expect(within(itemOf(record)).getByText('Joined small group')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record milestone: Baptised' })).toBeInTheDocument()
  })
})
