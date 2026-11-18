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

const BAPTISED = {
  __typename: 'Milestone',
  id: 'ms-baptised',
  name: 'baptised',
  description: 'b',
  recordedCount: 0,
}
const GROUP = {
  __typename: 'Milestone',
  id: 'ms-group',
  name: 'joined small group',
  description: 'g',
  recordedCount: 0,
}
const SERVING = {
  __typename: 'Milestone',
  id: 'ms-serving',
  name: 'serving',
  description: 's',
  recordedCount: 0,
}
const LEADING = {
  __typename: 'Milestone',
  id: 'ms-leading',
  name: 'leading',
  description: 'l',
  recordedCount: 0,
}
const CONFIRMED = {
  __typename: 'Milestone',
  id: 'ms-confirmed',
  name: 'Confirmed',
  description: 'c',
  recordedCount: 0,
}
// The API lists them A to Z.
const LABELS = ['baptised', 'joined small group', 'leading', 'serving']
const TYPES = [BAPTISED, GROUP, LEADING, SERVING]

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
    recordedBy: { __typename: 'UserSummary', id: ME.id, name: ME.name },
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
    lastPrayer: null,
    prayers: [],
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

async function ready(name = 'Record baptised') {
  // Record buttons need the Milestones query; Remove buttons only the person.
  return screen.findByRole('button', { name })
}

describe('PersonPage milestones section', () => {
  it('shows 0 of 4 and four Record buttons for a person with no milestones', async () => {
    renderPage(person())
    await ready()
    expect(screen.getByRole('heading', { level: 2, name: 'Milestones' })).toBeInTheDocument()
    expect(screen.getByText('0 of 4')).toBeInTheDocument()
    expect(screen.queryByText('No milestones set up yet.')).not.toBeInTheDocument()
    for (const label of LABELS) {
      expect(screen.getByRole('button', { name: `Record ${label}` })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: `Remove ${label}` })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('heading', { name: 'Other milestones' })).not.toBeInTheDocument()
  })

  it('shows 4 of 4 and no Record buttons when all are recorded', async () => {
    renderPage(person({ milestones: TYPES.map((t, i) => recorded(`mp${i}`, t)) }))
    await screen.findByRole('button', { name: 'Remove baptised' })
    expect(screen.getByText('4 of 4')).toBeInTheDocument()
    for (const label of LABELS) {
      expect(screen.getByRole('button', { name: `Remove ${label}` })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /^Record / })).not.toBeInTheDocument()
  })

  it('handles milestones recorded in any order', async () => {
    renderPage(person({ milestones: [recorded('mp1', LEADING)] }))
    await ready()
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove leading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record leading' })).not.toBeInTheDocument()
    for (const label of ['baptised', 'joined small group', 'serving']) {
      expect(screen.getByRole('button', { name: `Record ${label}` })).toBeInTheDocument()
    }
  })

  it('lists the milestones in the order the API returns them, names verbatim', async () => {
    renderPage(person(), { milestoneTypes: [SERVING, CONFIRMED, BAPTISED] })
    await ready('Record serving')
    const names = ['serving', 'Confirmed', 'baptised']
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => within(li).getByRole('button').getAttribute('aria-label'))).toEqual(
      names.map((n) => `Record ${n}`),
    )
    expect(screen.getByText('baptised')).toBeInTheDocument()
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
    await ready('Record leading')
    expect(
      within(itemOf(screen.getByRole('button', { name: 'Remove baptised' }))).getByText(
        '5 years ago',
      ),
    ).toBeInTheDocument()
    const group = within(itemOf(screen.getByRole('button', { name: 'Remove joined small group' })))
    expect(group.getByText('3 days ago')).toBeInTheDocument()
    expect(
      within(itemOf(screen.getByRole('button', { name: 'Remove serving' }))).getByText('Today'),
    ).toBeInTheDocument()
    const time = group.getByText('3 days ago').closest('time') ?? group.getByText('3 days ago')
    expect(time.getAttribute('datetime') ?? time.getAttribute('title')).toContain('2026')
    expect(screen.queryByText(/Recorded by/)).not.toBeInTheDocument()
    expect(group.queryByText('Me Shepherd')).not.toBeInTheDocument()
  })

  it('says "Date not recorded" for a null date and shows no note when there is none', async () => {
    renderPage(person({ milestones: [recorded('a', BAPTISED, { dateAchieved: null })] }))
    const item = itemOf(await screen.findByRole('button', { name: 'Remove baptised' }))
    expect(within(item).getByText('Date not recorded')).toBeInTheDocument()
    expect(item.textContent).not.toMatch(/null|undefined/)
  })

  it('shows the note when there is one', async () => {
    renderPage(person({ milestones: [recorded('a', BAPTISED, { notes: 'At the lake' })] }))
    const item = itemOf(await screen.findByRole('button', { name: 'Remove baptised' }))
    expect(within(item).getByText('At the lake')).toBeInTheDocument()
  })

  it('shows nothing, not "0 of 0", until the Milestones query loads', () => {
    renderPage(person())
    expect(screen.queryByText(/^\d+ of \d+$/)).not.toBeInTheDocument()
    expect(screen.queryByText('No milestones set up yet.')).not.toBeInTheDocument()
  })

  it('says no milestones are set up, with no count, when the list is empty (rule 7)', async () => {
    renderPage(person(), { milestoneTypes: [] })
    expect(await screen.findByText('No milestones set up yet.')).toBeInTheDocument()
    expect(screen.queryByText(/^\d+ of \d+$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Record / })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit milestones' })).toHaveAttribute(
      'href',
      '/milestones/edit',
    )
  })

  it('always links to Edit milestones', async () => {
    renderPage(person())
    await ready()
    expect(screen.getByRole('link', { name: 'Edit milestones' })).toHaveAttribute(
      'href',
      '/milestones/edit',
    )
  })

  it('ignores a record whose milestone is no longer in the list', async () => {
    renderPage(person({ milestones: [recorded('mp-c', CONFIRMED), recorded('mp-b', BAPTISED)] }))
    await screen.findByRole('button', { name: 'Remove baptised' })
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    expect(screen.queryByText('Confirmed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Confirmed' })).not.toBeInTheDocument()
  })

  it('shows, counts and lets you record a fifth custom milestone', async () => {
    const user = userEvent.setup()
    const { mutation, result } = recordMock('ms-confirmed', null, null)
    renderPage(person(), {
      milestoneTypes: [BAPTISED, CONFIRMED, GROUP, LEADING, SERVING],
      mutation,
    })
    expect(await screen.findByText('0 of 5')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Record Confirmed' }))
    expect(screen.getByRole('dialog', { name: 'Confirmed' })).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Record milestone' }),
    )
    await waitFor(() => expect(result).toHaveBeenCalled())
  })
})

describe('PersonPage record milestone dialog', () => {
  it('opens a dialog titled with the full milestone name, empty, with an optional date capped at today', async () => {
    const user = userEvent.setup()
    renderPage(person())
    await user.click(await ready('Record joined small group'))
    const dialog = screen.getByRole('dialog', { name: 'joined small group' })
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
    await user.click(await ready('Record joined small group'))
    const dialog = screen.getByRole('dialog', { name: 'joined small group' })
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
    await user.click(await ready('Record serving'))
    const dialog = screen.getByRole('dialog', { name: 'serving' })
    await user.type(within(dialog).getByLabelText(/^Note/), '   ')
    await user.click(within(dialog).getByRole('button', { name: 'Record milestone' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('rejects a future date and sends nothing', async () => {
    const user = userEvent.setup()
    const { mutation, result } = recordMock('ms-leading', '2026-10-15', null)
    renderPage(person(), { mutation })
    await user.click(await ready('Record leading'))
    const dialog = screen.getByRole('dialog', { name: 'leading' })
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
    await user.click(screen.getByRole('button', { name: 'Record baptised' }))
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
    const dialog = screen.getByRole('dialog', { name: 'baptised' })
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
    await user.click(await screen.findByRole('button', { name: 'Remove baptised' }))
    expect(result).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Remove baptised?' })
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
    await user.click(await screen.findByRole('button', { name: 'Remove baptised' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Remove baptised?' })).getByRole('button', {
        name: 'Cancel',
      }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove baptised' })).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: 'Remove baptised' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove baptised?' })
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(alert).not.toHaveTextContent('Cannot remove')
    expect(screen.getByRole('dialog', { name: 'Remove baptised?' })).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: 'Remove baptised' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    expect(
      await within(screen.getByRole('dialog', { name: 'Remove baptised?' })).findByRole('alert'),
    ).toHaveTextContent('This was changed or removed by someone else.')
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
      name: 'Record milestone: joined small group',
    })
    expect(record).toHaveTextContent('Record milestone')
    expect(within(itemOf(record)).getByText('joined small group')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record milestone: baptised' })).toBeInTheDocument()
  })
})
