import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { calendarAgo, contactDateToTimestamp, formatShortDate, todayIsoDate } from '../format'
import { PersonPage } from './PersonPage'

// Header calls useAuth(); the real provider would build a network client.
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const PERSON_ID = 'person-1'
const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }
const OTHER = { __typename: 'User', id: 'user-other', name: 'Other Shepherd' }

const MILESTONE_TYPES = [
  { __typename: 'Milestone', id: 'ms-baptised', name: 'baptised', description: 'Was baptised' },
  { __typename: 'Milestone', id: 'ms-member', name: 'joined small group', description: 'Joined' },
  { __typename: 'Milestone', id: 'ms-serving', name: 'serving', description: 'Serves' },
]

function burden(id: string, content: string, releasedDate: string | null = null) {
  return {
    __typename: 'PrayerBurden',
    id,
    content,
    releasedDate,
    createdAt: '2026-10-14 18:26:10.89+00',
  }
}

function comment(
  id: string,
  content: string,
  opts: { burdenId?: string | null; author?: typeof OTHER } = {},
) {
  return {
    __typename: 'Comment',
    id,
    content,
    createdAt: '2026-10-14 18:26:10.89+00',
    author: opts.author ?? { __typename: 'User', id: ME.id, name: ME.name },
    prayerBurden: opts.burdenId ? { __typename: 'PrayerBurden', id: opts.burdenId } : null,
    contactLogId: null,
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
  milestoneTypes?: typeof MILESTONE_TYPES
  mutation?: { request: MockedResponse['request']; result: MockedResponse['result'] }
  mutations?: MockedResponse[]
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
      result: { data: { milestones: opts.milestoneTypes ?? MILESTONE_TYPES } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ]
  if (opts.mutation) mocks.push(opts.mutation)
  if (opts.mutations) mocks.push(...opts.mutations)
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

function releasedBurden(id: string) {
  return {
    __typename: 'PrayerBurden',
    id,
    content: 'Pray for work',
    createdAt: '2026-10-14 18:26:10.89+00',
    releasedDate: '2026-10-15',
    person: {
      __typename: 'Person',
      id: PERSON_ID,
      name: 'Maria Santos',
      status: { __typename: 'Status', id: 'st-active', name: 'active' },
    },
    comments: [],
  }
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

const EMPTY_BURDENS = 'No prayer burdens yet. Add one here, or when you log a contact.'
const EMPTY_NOTES = 'No notes yet. A comment written when you log a contact shows here.'
const SHARING = 'Everyone who shepherds Sam sees prayer burdens and comments.'
const DAY_MS = 24 * 3_600_000
/** A comment's meta line ("You · 3 days ago"); the author is in its own span inside it. */
const meta = (author: string) => (_: string, el: Element | null) =>
  el?.tagName === 'P' && (el.textContent ?? '').startsWith(`${author} · `)
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString()

function section(name: string) {
  const heading = screen.getByRole('heading', { level: 2, name })
  return within(heading.closest('section')!)
}

async function openAddDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add burden' }))
  return screen.getByRole('dialog', { name: 'Add prayer burden' })
}

describe('PersonPage empty states', () => {
  it('shows empty messages, the Add burden button and the note box for a brand new person', async () => {
    renderPage(person())
    expect(await screen.findByText('0 of 4')).toBeInTheDocument()
    expect(screen.getByText(EMPTY_BURDENS)).toBeInTheDocument()
    expect(screen.getByText(EMPTY_NOTES)).toBeInTheDocument()

    expect(await screen.findByRole('button', { name: 'Record Baptised' })).toBeInTheDocument()
    expect(
      section('Prayer burdens').getByRole('button', { name: 'Add burden' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('New prayer burden')).not.toBeInTheDocument()
    expect(section('Notes').getByLabelText('Write a note about Sam')).toBeInTheDocument()
    expect(section('Notes').getByRole('button', { name: 'Add note' })).toBeInTheDocument()
    expect(screen.queryByText(/^Released \(/)).not.toBeInTheDocument()
  })

  it('renders a burden with zero comments, with its comment box and no earlier toggle', async () => {
    renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }))
    expect(await screen.findByText('Pray for work')).toBeInTheDocument()
    expect(screen.getByLabelText('Add a comment on this burden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /earlier comment/ })).not.toBeInTheDocument()
    expect(screen.getByText(/· Praying$/)).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_BURDENS)).not.toBeInTheDocument()
  })

  it('still shows the empty burden message when the only burdens are released', async () => {
    renderPage(person({ prayerBurdens: [burden('b1', 'Old one', '2026-09-01')] }))
    expect(await screen.findByText('Released (1)')).toBeInTheDocument()
    expect(screen.getByText(EMPTY_BURDENS)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add burden' })).toBeInTheDocument()
  })
})

describe('PersonPage empty states (phone)', () => {
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

  it('uses the short burden message and a short Add button that is still named Add burden', async () => {
    renderPage(person())
    expect(await screen.findByText('No prayer burdens yet.')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Add burden' })
    expect(button).toHaveTextContent(/^Add$/)
  })
})

describe('PersonPage query errors', () => {
  function renderFailing(code: string | undefined, message: string) {
    const mocks: MockedResponse[] = [
      {
        request: { query: G.PersonDocument, variables: { id: 'not-a-uuid' } },
        result: {
          errors: [new GraphQLError(message, code ? { extensions: { code } } : undefined)],
        },
      },
      {
        request: { query: G.MeDocument },
        result: { data: { me: ME } },
        maxUsageCount: Number.POSITIVE_INFINITY,
      },
    ]
    render(
      <MockedProvider mocks={mocks}>
        <MemoryRouter initialEntries={['/people/not-a-uuid']}>
          <Routes>
            <Route path="/people/:id" element={<PersonPage />} />
          </Routes>
        </MemoryRouter>
      </MockedProvider>,
    )
  }

  it.each(['BAD_USER_INPUT', 'NOT_FOUND'])(
    'shows "not found" without an alert for %s',
    async (code) => {
      renderFailing(code, 'Invalid input')
      expect(await screen.findByText('This person was not found.')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('shows the friendly message for INTERNAL, never the raw server text', async () => {
    renderFailing('INTERNAL', 'raw server text')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument()
    expect(screen.queryByText('This person was not found.')).not.toBeInTheDocument()
  })
})

describe('PersonPage prayer burdens', () => {
  it('tells the user who sees prayer burdens and comments, once', async () => {
    renderPage(person())
    expect(await screen.findByText(SHARING)).toBeInTheDocument()
    expect(screen.getAllByText(SHARING)).toHaveLength(1)
  })

  it('shows the sharing line once when there are burdens too', async () => {
    renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }))
    await screen.findByText('Pray for work')
    expect(screen.getAllByText(SHARING)).toHaveLength(1)
  })

  it('opens a dialog from Add burden, with help text, Cancel and a submit button', async () => {
    const user = userEvent.setup()
    renderPage(person())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const dialog = await openAddDialog(user)
    expect(within(dialog).getByLabelText('Prayer burden')).toBeInTheDocument()
    expect(within(dialog).getByText(SHARING)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add prayer burden' })).toBeInTheDocument()
  })

  it('disables Add prayer burden while the text is blank or whitespace', async () => {
    const user = userEvent.setup()
    renderPage(person())
    const dialog = await openAddDialog(user)
    const button = within(dialog).getByRole('button', { name: 'Add prayer burden' })
    expect(button).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Prayer burden'), '   ')
    expect(button).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Prayer burden'), 'x')
    expect(button).toBeEnabled()
  })

  it('creates a burden with trimmed content, closes the dialog, toasts and refetches', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.CreatePrayerBurdenDocument,
      { input: { personId: PERSON_ID, content: 'Healing' } },
      { createPrayerBurden: { __typename: 'PrayerBurden', id: 'b-new' } },
    )
    const { refetch } = renderPage(person(), { mutation })
    const dialog = await openAddDialog(user)
    await user.type(within(dialog).getByLabelText('Prayer burden'), '  Healing  ')
    await user.click(within(dialog).getByRole('button', { name: 'Add prayer burden' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Added prayer burden for Sam')).toBeInTheDocument()
  })

  it('shows a GraphQL error message in an alert and keeps the dialog open', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.CreatePrayerBurdenDocument,
        variables: { input: { personId: PERSON_ID, content: 'Healing' } },
      } as MockedResponse['request'],
      result: {
        errors: [
          new GraphQLError('Not allowed to do that', { extensions: { code: 'BAD_USER_INPUT' } }),
        ],
      },
    }
    renderPage(person(), { mutation })
    const dialog = await openAddDialog(user)
    await user.type(within(dialog).getByLabelText('Prayer burden'), 'Healing')
    await user.click(within(dialog).getByRole('button', { name: 'Add prayer burden' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Not allowed to do that')
    expect(screen.getByRole('dialog', { name: 'Add prayer burden' })).toBeInTheDocument()
    expect(screen.queryByText('Added prayer burden for Sam')).not.toBeInTheDocument()
  })

  it('Cancel closes the dialog without sending anything, and reopening starts empty', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.CreatePrayerBurdenDocument,
      { input: { personId: PERSON_ID, content: 'Healing' } },
      { createPrayerBurden: { __typename: 'PrayerBurden', id: 'b-new' } },
    )
    const { refetch } = renderPage(person(), { mutation })
    let dialog = await openAddDialog(user)
    await user.type(within(dialog).getByLabelText('Prayer burden'), 'Healing')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(result).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
    dialog = await openAddDialog(user)
    expect(within(dialog).getByLabelText('Prayer burden')).toHaveValue('')
  })

  it('shows "Added today · Praying" and "Added 3 days ago · Praying"', async () => {
    renderPage(
      person({
        prayerBurdens: [
          { ...burden('b1', 'Fresh'), createdAt: new Date().toISOString() },
          { ...burden('b2', 'Older'), createdAt: daysAgo(3) },
        ],
        comments: [comment('c1', 'A comment', { burdenId: 'b2' })],
      }),
    )
    await screen.findByText('Fresh')
    expect(screen.getByText('Added today · Praying')).toBeInTheDocument()
    // Praying shows with comments too.
    expect(screen.getByText('Added 3 days ago · Praying')).toBeInTheDocument()
  })

  it('releases at once with no confirmation, then toasts with Undo', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.ReleasePrayerBurdenDocument,
      { id: 'b1' },
      { releasePrayerBurden: releasedBurden('b1') },
    )
    const { refetch } = renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }), {
      mutation,
    })
    await user.click(await screen.findByRole('button', { name: 'Release' }))
    expect(screen.queryByText('Release this prayer burden?')).not.toBeInTheDocument()
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    expect(await screen.findByText('Released prayer burden for Sam')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('Undo sends unreleasePrayerBurden for that burden', async () => {
    const user = userEvent.setup()
    const release = mutationMock(
      G.ReleasePrayerBurdenDocument,
      { id: 'b1' },
      { releasePrayerBurden: releasedBurden('b1') },
    )
    const undo = mutationMock(
      G.UnreleasePrayerBurdenDocument,
      { id: 'b1' },
      { unreleasePrayerBurden: { ...releasedBurden('b1'), releasedDate: null } },
    )
    renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }), {
      mutations: [release.mutation, undo.mutation],
    })
    await user.click(await screen.findByRole('button', { name: 'Release' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undo.result).toHaveBeenCalledTimes(1))
    expect(release.result).toHaveBeenCalledTimes(1)
  })

  it('reports a failed Undo in the toast with the friendly message', async () => {
    const user = userEvent.setup()
    const release = mutationMock(
      G.ReleasePrayerBurdenDocument,
      { id: 'b1' },
      { releasePrayerBurden: releasedBurden('b1') },
    )
    const failedUndo = {
      request: { query: G.UnreleasePrayerBurdenDocument, variables: { id: 'b1' } },
      result: { errors: [new GraphQLError('raw', { extensions: { code: 'INTERNAL' } })] },
    } as MockedResponse
    renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }), {
      mutations: [release.mutation, failedUndo],
    })
    await user.click(await screen.findByRole('button', { name: 'Release' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByText("Couldn't undo. Something went wrong. Please try again."),
    ).toBeInTheDocument()
    expect(screen.queryByText(/raw/)).not.toBeInTheDocument()
  })

  it('shows an alert in the section when the release fails', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: { query: G.ReleasePrayerBurdenDocument, variables: { id: 'b1' } },
      result: { errors: [new GraphQLError('raw', { extensions: { code: 'INTERNAL' } })] },
    } as MockedResponse
    renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }), { mutation })
    await user.click(await screen.findByRole('button', { name: 'Release' }))
    expect(await section('Prayer burdens').findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
    expect(screen.queryByText('Released prayer burden for Sam')).not.toBeInTheDocument()
  })

  it('shows every comment when a burden has one or two', async () => {
    renderPage(
      person({
        prayerBurdens: [burden('b1', 'Pray for work')],
        comments: [
          comment('c2', 'Second', { burdenId: 'b1', author: OTHER }),
          comment('c1', 'First', { burdenId: 'b1' }),
        ],
      }),
    )
    await screen.findByText('Second')
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /earlier comment/ })).not.toBeInTheDocument()
    expect(screen.getByText(meta('You'))).toBeInTheDocument()
    expect(screen.getByText(meta('Other Shepherd'))).toBeInTheDocument()
  })

  it('shows the latest two of three comments, oldest first, and toggles the earlier ones', async () => {
    const user = userEvent.setup()
    renderPage(
      person({
        prayerBurdens: [burden('b1', 'Pray for work')],
        comments: [
          comment('c3', 'Third', { burdenId: 'b1' }),
          comment('c2', 'Second', { burdenId: 'b1' }),
          comment('c1', 'First', { burdenId: 'b1' }),
        ],
      }),
    )
    await screen.findByText('Third')
    expect(screen.queryByText('First')).not.toBeInTheDocument()
    const shown = screen.getAllByText(/^(Second|Third)$/).map((e) => e.textContent)
    expect(shown).toEqual(['Second', 'Third'])

    await user.click(screen.getByRole('button', { name: 'Show 1 earlier comment' }))
    expect(screen.getByText('First')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide earlier comments' }))
    expect(screen.queryByText('First')).not.toBeInTheDocument()
  })

  it('pluralises the earlier-comments toggle', async () => {
    renderPage(
      person({
        prayerBurdens: [burden('b1', 'Pray for work')],
        comments: [4, 3, 2, 1].map((n) => comment(`c${n}`, `Comment ${n}`, { burdenId: 'b1' })),
      }),
    )
    expect(
      await screen.findByRole('button', { name: 'Show 2 earlier comments' }),
    ).toBeInTheDocument()
  })

  it('disables Comment while the text is blank or whitespace', async () => {
    const user = userEvent.setup()
    renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }))
    const input = await screen.findByLabelText('Add a comment on this burden')
    const button = screen.getByRole('button', { name: 'Comment' })
    expect(button).toBeDisabled()
    await user.type(input, '   ')
    expect(button).toBeDisabled()
    await user.type(input, 'x')
    expect(button).toBeEnabled()
  })

  it('comments on the right burden when several are active', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.CreateCommentDocument,
      { input: { personId: PERSON_ID, prayerBurdenId: 'b2', content: 'Checking in' } },
      { createComment: { __typename: 'Comment', id: 'c-new' } },
    )
    const { refetch } = renderPage(
      person({ prayerBurdens: [burden('b1', 'First'), burden('b2', 'Second')] }),
      { mutation },
    )
    await screen.findByText('Second')
    // Assumes burdens render in the order the API returns them.
    const inputs = screen.getAllByLabelText('Add a comment on this burden')
    expect(inputs).toHaveLength(2)
    await user.type(inputs[1], '  Checking in  ')
    await user.click(screen.getAllByRole('button', { name: 'Comment' })[1])
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    await waitFor(() => expect(inputs[1]).toHaveValue(''))
  })

  it('shows an alert when commenting fails', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.CreateCommentDocument,
        variables: { input: { personId: PERSON_ID, prayerBurdenId: 'b1', content: 'Hi' } },
      },
      result: { errors: [new GraphQLError('raw', { extensions: { code: 'INTERNAL' } })] },
    } as MockedResponse
    renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }), { mutation })
    await user.type(await screen.findByLabelText('Add a comment on this burden'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })

  it('puts released burdens in a collapsed Released (n) details with only the latest comment', async () => {
    renderPage(
      person({
        prayerBurdens: [
          burden('b-old1', 'Old one', '2026-09-01'),
          burden('b-old2', 'Old two', '2026-09-02'),
        ],
        comments: [
          comment('c2', 'It was answered', { burdenId: 'b-old1', author: OTHER }),
          comment('c1', 'Earlier chat', { burdenId: 'b-old1', author: OTHER }),
        ],
      }),
    )
    const summary = await screen.findByText('Released (2)')
    const details = summary.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(within(details!).getByText('Old one')).toBeInTheDocument()
    expect(within(details!).getAllByText(/· Released /)).toHaveLength(2)
    expect(within(details!).getByText('It was answered')).toBeInTheDocument()
    expect(screen.queryByText('Earlier chat')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Add a comment on this burden')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Comment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('renders no details element when nothing is released', async () => {
    renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }))
    await screen.findByText('Pray for work')
    expect(document.querySelector('details')).toBeNull()
  })
})

describe('PersonPage notes', () => {
  it('puts the add box first, disabled while blank or whitespace', async () => {
    const user = userEvent.setup()
    renderPage(person({ comments: [comment('c1', 'Existing note')] }))
    const textarea = await screen.findByLabelText('Write a note about Sam')
    const button = screen.getByRole('button', { name: 'Add note' })
    expect(button).toBeDisabled()
    await user.type(textarea, '   ')
    expect(button).toBeDisabled()
    await user.type(textarea, 'x')
    expect(button).toBeEnabled()
    expect(
      textarea.compareDocumentPosition(screen.getByText('Existing note')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('adds a standalone note with an explicit null prayerBurdenId', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.CreateCommentDocument,
      { input: { personId: PERSON_ID, prayerBurdenId: null, content: 'Met for coffee' } },
      { createComment: { __typename: 'Comment', id: 'c-new' } },
    )
    const { refetch } = renderPage(person(), { mutation })
    const textarea = await screen.findByLabelText('Write a note about Sam')
    await user.type(textarea, ' Met for coffee ')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    await waitFor(() => expect(textarea).toHaveValue(''))
  })

  it('shows an alert when adding a note fails', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.CreateCommentDocument,
        variables: { input: { personId: PERSON_ID, prayerBurdenId: null, content: 'Hi' } },
      },
      result: { errors: [new GraphQLError('raw', { extensions: { code: 'INTERNAL' } })] },
    } as MockedResponse
    renderPage(person(), { mutation })
    await user.type(await screen.findByLabelText('Write a note about Sam'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await section('Notes').findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })

  it('lists notes newest first with author and text', async () => {
    renderPage(
      person({
        comments: [comment('c2', 'Newer note', { author: OTHER }), comment('c1', 'Older note')],
      }),
    )
    await screen.findByText('Newer note')
    const notes = section('Notes')
    const order = notes.getAllByText(/^(Newer|Older) note$/).map((e) => e.textContent)
    expect(order).toEqual(['Newer note', 'Older note'])
    expect(notes.getByText(meta('Other Shepherd'))).toBeInTheDocument()
    expect(notes.getByText(meta('You'))).toBeInTheDocument()
    expect(notes.queryByText(EMPTY_NOTES)).not.toBeInTheDocument()
  })

  it('keeps burden comments out of Notes and notes out of burdens', async () => {
    renderPage(
      person({
        prayerBurdens: [burden('b1', 'Pray for work')],
        comments: [
          comment('c1', 'Linked comment', { burdenId: 'b1' }),
          comment('c2', 'Standalone note'),
        ],
      }),
    )
    expect(await screen.findByText('Linked comment')).toBeInTheDocument()
    expect(screen.getByText('Standalone note')).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_NOTES)).not.toBeInTheDocument()

    const notes = section('Notes')
    expect(notes.getByText('Standalone note')).toBeInTheDocument()
    expect(notes.queryByText('Linked comment')).not.toBeInTheDocument()
    const burdens = section('Prayer burdens')
    expect(burdens.getByText('Linked comment')).toBeInTheDocument()
    expect(burdens.queryByText('Standalone note')).not.toBeInTheDocument()
  })

  it('shows the empty notes message when the only comments are linked to a burden', async () => {
    renderPage(
      person({
        prayerBurdens: [burden('b1', 'Pray for work')],
        comments: [comment('c1', 'Linked comment', { burdenId: 'b1' })],
      }),
    )
    expect(await screen.findByText('Linked comment')).toBeInTheDocument()
    expect(screen.getByText(EMPTY_NOTES)).toBeInTheDocument()
  })
})

describe('PersonPage deleting comments', () => {
  it('shows Delete only on my comments, for burden comments and notes', async () => {
    renderPage(
      person({
        prayerBurdens: [burden('b1', 'Pray for work')],
        comments: [
          comment('c1', 'My burden comment', { burdenId: 'b1' }),
          comment('c2', 'Their burden comment', { burdenId: 'b1', author: OTHER }),
          comment('c3', 'My note'),
          comment('c4', 'Their note', { author: OTHER }),
        ],
      }),
    )
    await screen.findByText('My burden comment')
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
  })

  it('has no Delete button when every comment is by someone else', async () => {
    renderPage(person({ comments: [comment('c4', 'Their note', { author: OTHER })] }))
    await screen.findByText('Their note')
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('deletes my note by id and refetches', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.DeleteCommentDocument,
      { id: 'c3' },
      { deleteComment: true },
    )
    const { refetch } = renderPage(
      person({
        comments: [comment('c3', 'My note'), comment('c4', 'Their note', { author: OTHER })],
      }),
      { mutation },
    )
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(result).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Delete this comment?' })
    await user.click(within(dialog).getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cancelling delete closes the dialog and sends no mutation', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.DeleteCommentDocument,
      { id: 'c3' },
      { deleteComment: true },
    )
    const { refetch } = renderPage(person({ comments: [comment('c3', 'My note')] }), { mutation })
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete this comment?' })).getByRole('button', {
        name: 'Cancel',
      }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
  })

  it('deletes my comment on a burden by id', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.DeleteCommentDocument,
      { id: 'c1' },
      { deleteComment: true },
    )
    renderPage(
      person({
        prayerBurdens: [burden('b1', 'Pray for work')],
        comments: [
          comment('c1', 'My burden comment', { burdenId: 'b1' }),
          comment('c2', 'Their burden comment', { burdenId: 'b1', author: OTHER }),
        ],
      }),
      { mutation },
    )
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
  })
})

describe('PersonPage delete comment confirmation', () => {
  it('the dialog Close button closes it without deleting', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.DeleteCommentDocument,
      { id: 'c3' },
      { deleteComment: true },
    )
    renderPage(person({ comments: [comment('c3', 'My note')] }), { mutation })
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete this comment?' })).getByRole('button', {
        name: 'Close',
      }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
  })

  it('keeps the dialog open with the error, and the comment, when deleting fails', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.DeleteCommentDocument,
        variables: { id: 'c3' },
      } as MockedResponse['request'],
      result: { errors: [new GraphQLError('boom')] },
    }
    renderPage(person({ comments: [comment('c3', 'My note')] }), { mutation })
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this comment?' })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
    expect(screen.getByText('My note')).toBeInTheDocument()
  })
})

describe('PersonPage prayer log', () => {
  const NOT_FOUND = new GraphQLError('gone', { extensions: { code: 'NOT_FOUND' } })
  const meUser = { __typename: 'User', id: ME.id, name: ME.name }
  const otherUser = { __typename: 'User', id: OTHER.id, name: OTHER.name }
  const NOW = new Date()
  /** Local time `hour` o'clock, `n` calendar days ago, as an ISO DateTime. */
  const localDay = (n: number, hour = 12) =>
    new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, hour).toISOString()
  /** The "YYYY-MM-DD" value `n` days ago (negative: ahead). */
  const isoDay = (n: number) =>
    todayIsoDate(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n))

  function prayer(
    id: string,
    prayedAt: string,
    opts: { createdAt?: string; by?: typeof meUser | null } = {},
  ) {
    return {
      __typename: 'PrayerLog',
      id,
      prayedAt,
      createdAt: opts.createdAt ?? prayedAt,
      prayedBy: opts.by === undefined ? meUser : opts.by,
    }
  }

  const last = (p: ReturnType<typeof prayer> | undefined) =>
    p ? { __typename: 'PrayerLog', id: p.id, prayedAt: p.prayedAt, prayedBy: p.prayedBy } : null

  function maria(
    prayers: ReturnType<typeof prayer>[] = [],
    overrides: Record<string, unknown> = {},
  ) {
    return person({
      name: 'Maria Santos',
      recordedMilestoneIds: [],
      activeBurdenCount: 0,
      latestComment: null,
      shepherds: [meUser],
      prayers,
      lastPrayer: last(prayers[0]),
      ...overrides,
    })
  }

  /** RecordPrayer returns the person with the new record first. */
  function recordMock(
    base: ReturnType<typeof maria>,
    created: ReturnType<typeof prayer>,
    variables: Record<string, unknown>,
    opts: { delay?: number; fail?: boolean } = {},
  ) {
    const result = vi.fn(() =>
      opts.fail
        ? { errors: [new GraphQLError('boom')] }
        : {
            data: {
              recordPrayer: {
                ...base,
                prayers: [created, ...(base.prayers as unknown[])],
                lastPrayer: last(created),
              },
            },
          },
    )
    return {
      result,
      mutation: {
        request: { query: G.RecordPrayerDocument, variables } as MockedResponse['request'],
        result,
        delay: opts.delay,
      } as MockedResponse,
    }
  }

  // The space before "for" is tolerated here so one test (below) reports a missing space alone.
  const prayedButton = () => screen.findByRole('button', { name: /^Prayed ?for Maria Santos$/ })
  const logged = (text: string) =>
    waitFor(() => expect(burdens().getByRole('status')).toHaveTextContent(text))
  const burdens = () => section('Prayer burdens')

  it('offers Prayed and Another day above the burdens, for a person with no burdens or prayers', async () => {
    renderPage(maria())
    expect(await prayedButton()).toHaveTextContent('Prayed')
    expect(burdens().getByRole('button', { name: 'Prayed for Maria Santos' })).toBeInTheDocument()
    const another = burdens().getByRole('button', { name: 'Another day' })
    expect(another).toHaveAttribute('aria-expanded', 'false')
    expect(burdens().getByText(EMPTY_BURDENS)).toBeInTheDocument()
    expect(burdens().getByText('Nobody has prayed for Maria yet.')).toBeInTheDocument()
    expect(
      burdens().getByText(
        'Tap Prayed each time you pray for Maria. Every shepherd of Maria sees the same history.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Prayer history' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /prayer history/ })).not.toBeInTheDocument()
  })

  it.each([
    [0, 'today'],
    [1, 'yesterday'],
    [3, '3 days ago'],
  ])('says last prayed %i days ago as "%s" by calendar day', async (n, words) => {
    // 11 PM yesterday is "yesterday" even when under 24 hours ago.
    const p = prayer('p1', localDay(n, n === 1 ? 23 : 12))
    renderPage(maria([p]))
    expect(await screen.findByText(`Last prayed for Maria ${words}`)).toBeInTheDocument()
    expect(screen.getByText(`By you · ${formatShortDate(p.prayedAt)}`)).toBeInTheDocument()
    expect(screen.queryByText('Nobody has prayed for Maria yet.')).not.toBeInTheDocument()
  })

  it('names a co-shepherd, or "someone" when the shepherd is unknown, in the last-prayed line', async () => {
    const p = prayer('p1', localDay(1), { by: otherUser })
    renderPage(maria([p]))
    expect(
      await screen.findByText(`By Other Shepherd · ${formatShortDate(p.prayedAt)}`),
    ).toBeInTheDocument()
  })

  it('says "someone" when prayedBy is null', async () => {
    const p = prayer('p1', localDay(1), { by: null })
    renderPage(maria([p]))
    expect(
      await screen.findByText(`By someone · ${formatShortDate(p.prayedAt)}`),
    ).toBeInTheDocument()
  })

  it('Prayed sends recordPrayer with only personId and shows a status with Undo', async () => {
    const user = userEvent.setup()
    const created = prayer('p-new', new Date().toISOString())
    const { mutation, result } = recordMock(maria(), created, { personId: PERSON_ID })
    renderPage(maria(), { mutation })
    await user.click(await prayedButton())
    await waitFor(() => expect(result).toHaveBeenCalledTimes(1))
    await logged('Prayer logged for Maria.')
    expect(burdens().getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(await screen.findByText('Last prayed for Maria today')).toBeInTheDocument()
  })

  it('disables Prayed while sending, so a second click sends nothing', async () => {
    const user = userEvent.setup()
    const created = prayer('p-new', new Date().toISOString())
    const { mutation, result } = recordMock(
      maria(),
      created,
      { personId: PERSON_ID },
      { delay: 100 },
    )
    renderPage(maria(), { mutation })
    const button = await prayedButton()
    await user.click(button)
    expect(button).toBeDisabled()
    await user.click(button)
    await logged('Prayer logged for Maria.')
    expect(result).toHaveBeenCalledTimes(1)
  })

  it('shows the friendly error when recording fails, and enables Prayed again', async () => {
    const user = userEvent.setup()
    const created = prayer('p-new', new Date().toISOString())
    const { mutation } = recordMock(maria(), created, { personId: PERSON_ID }, { fail: true })
    renderPage(maria(), { mutation })
    await user.click(await prayedButton())
    expect(await burdens().findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
    expect(await prayedButton()).toBeEnabled()
    expect(screen.queryByText('Prayer logged for Maria.')).not.toBeInTheDocument()
  })

  it('Undo sends deletePrayer for the new record and clears the message', async () => {
    const user = userEvent.setup()
    const existing = prayer('p-old', localDay(2))
    const base = maria([existing])
    const created = prayer('p-new', new Date().toISOString())
    const record = recordMock(base, created, { personId: PERSON_ID })
    const undo = mutationMock(G.DeletePrayerDocument, { id: 'p-new' }, { deletePrayer: base })
    renderPage(base, { mutations: [record.mutation, undo.mutation] })
    await user.click(await prayedButton())
    await logged('Prayer logged for Maria.')
    await user.click(burdens().getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undo.result).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByText('Prayer logged for Maria.')).not.toBeInTheDocument(),
    )
  })

  it('shows the friendly error when Undo fails', async () => {
    const user = userEvent.setup()
    const base = maria()
    const created = prayer('p-new', new Date().toISOString())
    const record = recordMock(base, created, { personId: PERSON_ID })
    const undo = {
      request: { query: G.DeletePrayerDocument, variables: { id: 'p-new' } },
      result: { errors: [NOT_FOUND] },
    } as MockedResponse
    renderPage(base, { mutations: [record.mutation, undo] })
    await user.click(await prayedButton())
    await logged('Prayer logged for Maria.')
    await user.click(burdens().getByRole('button', { name: 'Undo' }))
    expect(await burdens().findByRole('alert')).toHaveTextContent(
      'This was changed or removed by someone else.',
    )
  })

  describe('Another day', () => {
    async function openForm(user: ReturnType<typeof userEvent.setup>) {
      await prayedButton()
      await user.click(await burdens().findByRole('button', { name: 'Another day' }))
      return burdens().getByLabelText('Day you prayed (required)') as HTMLInputElement
    }

    it('opens a form defaulting to today, and Cancel and Escape close it', async () => {
      const user = userEvent.setup()
      renderPage(maria())
      const input = await openForm(user)
      expect(burdens().getByRole('button', { name: 'Another day' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(input).toHaveValue(todayIsoDate())
      expect(input).toHaveAttribute('max', todayIsoDate())
      expect(
        burdens().getByText(
          'For a prayer you forgot to log. It shows in the history as back-dated. It can’t be in the future.',
        ),
      ).toBeInTheDocument()
      expect(burdens().getByRole('button', { name: 'Save prayer' })).toBeInTheDocument()
      await user.click(burdens().getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByLabelText('Day you prayed (required)')).not.toBeInTheDocument()
      expect(burdens().getByRole('button', { name: 'Another day' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      await user.click(await openForm(user))
      await user.keyboard('{Escape}')
      expect(screen.queryByLabelText('Day you prayed (required)')).not.toBeInTheDocument()
    })

    it('asks for a day when the date is cleared, and sends nothing', async () => {
      const user = userEvent.setup()
      const created = prayer('p-new', new Date().toISOString())
      const { mutation, result } = recordMock(maria(), created, { personId: PERSON_ID })
      renderPage(maria(), { mutation })
      const input = await openForm(user)
      fireEvent.change(input, { target: { value: '' } })
      await user.click(burdens().getByRole('button', { name: 'Save prayer' }))
      expect(await burdens().findByText('Choose the day you prayed.')).toBeInTheDocument()
      expect(result).not.toHaveBeenCalled()
    })

    it('rejects a future date and sends nothing', async () => {
      const user = userEvent.setup()
      const created = prayer('p-new', new Date().toISOString())
      const { mutation, result } = recordMock(maria(), created, { personId: PERSON_ID })
      renderPage(maria(), { mutation })
      const input = await openForm(user)
      fireEvent.change(input, { target: { value: isoDay(-3) } })
      await user.click(burdens().getByRole('button', { name: 'Save prayer' }))
      expect(await burdens().findByText('The date can’t be in the future.')).toBeInTheDocument()
      expect(result).not.toHaveBeenCalled()
    })

    it('saving today sends only personId and closes the form', async () => {
      const user = userEvent.setup()
      const created = prayer('p-new', new Date().toISOString())
      const { mutation, result } = recordMock(maria(), created, { personId: PERSON_ID })
      renderPage(maria(), { mutation })
      await openForm(user)
      await user.click(burdens().getByRole('button', { name: 'Save prayer' }))
      await waitFor(() => expect(result).toHaveBeenCalledTimes(1))
      await logged('Prayer logged for Maria.')
      expect(screen.queryByLabelText('Day you prayed (required)')).not.toBeInTheDocument()
    })

    it('saving a past day sends that day at local noon and names it in the message', async () => {
      const user = userEvent.setup()
      const day = isoDay(3)
      const prayedAt = contactDateToTimestamp(day)
      const created = prayer('p-new', prayedAt, { createdAt: new Date().toISOString() })
      const { mutation, result } = recordMock(maria(), created, { personId: PERSON_ID, prayedAt })
      renderPage(maria(), { mutation })
      const input = await openForm(user)
      fireEvent.change(input, { target: { value: day } })
      await user.click(burdens().getByRole('button', { name: 'Save prayer' }))
      await waitFor(() => expect(result).toHaveBeenCalledTimes(1))
      await logged(`Prayer logged for Maria on ${formatShortDate(prayedAt)}.`)
      expect(screen.queryByLabelText('Day you prayed (required)')).not.toBeInTheDocument()
    })
  })

  describe('history', () => {
    const history = () => burdens().getByRole('list', { name: 'Prayer history' })
    const items = () => within(history()).getAllByRole('listitem')

    it('is open by default, toggles, and shows each record with its date, age and shepherd', async () => {
      const user = userEvent.setup()
      const mine = prayer('p1', localDay(1))
      const theirs = prayer('p2', localDay(2), { by: otherUser })
      const unknown = prayer('p3', localDay(3), { by: null })
      renderPage(maria([mine, theirs, unknown]))
      await prayedButton()
      const toggle = await burdens().findByRole('button', { name: 'Hide prayer history (3)' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const [a, b, c] = items()
      expect(a).toHaveTextContent(
        `${formatShortDate(mine.prayedAt)} · ${calendarAgo(mine.prayedAt)}`,
      )
      expect(a).toHaveTextContent('You')
      expect(a).not.toHaveTextContent('Back-dated')
      expect(b).toHaveTextContent('Other Shepherd')
      expect(c).toHaveTextContent('Someone')
      await user.click(toggle)
      expect(screen.queryByRole('list', { name: 'Prayer history' })).not.toBeInTheDocument()
      expect(burdens().getByRole('button', { name: 'Show prayer history (3)' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })

    it('shows the newest 3 of 5, then all and fewer', async () => {
      const user = userEvent.setup()
      const five = [0, 1, 2, 3, 4].map((n) => prayer(`p${n}`, localDay(n)))
      renderPage(maria(five))
      await prayedButton()
      await burdens().findByRole('button', { name: 'Hide prayer history (5)' })
      expect(items()).toHaveLength(3)
      await user.click(burdens().getByRole('button', { name: 'Show 2 earlier' }))
      expect(items()).toHaveLength(5)
      await user.click(burdens().getByRole('button', { name: 'Show fewer' }))
      expect(items()).toHaveLength(3)
      expect(burdens().getByRole('button', { name: 'Show 2 earlier' })).toBeInTheDocument()
    })

    it('has no earlier toggle with 3 or fewer records', async () => {
      renderPage(maria([prayer('p0', localDay(0)), prayer('p1', localDay(1))]))
      await prayedButton()
      await burdens().findByRole('button', { name: 'Hide prayer history (2)' })
      expect(screen.queryByRole('button', { name: /earlier|Show fewer/ })).not.toBeInTheDocument()
    })

    it('marks a back-dated record with a pill and when it was logged', async () => {
      const backDated = prayer('p1', localDay(3), { createdAt: localDay(1) })
      renderPage(maria([backDated]))
      await prayedButton()
      await burdens().findByRole('button', { name: 'Hide prayer history (1)' })
      const [item] = items()
      expect(within(item).getByText('Back-dated')).toBeInTheDocument()
      expect(item).toHaveTextContent('You · logged yesterday')
    })

    it('orders by prayed day newest first, ties by newest createdAt', async () => {
      const older = prayer('older', localDay(2))
      const tieEarly = prayer('tie-early', localDay(1, 8), { by: otherUser })
      const tieLate = prayer('tie-late', localDay(1, 20), { by: null })
      const newest = prayer('newest', localDay(0, 1))
      renderPage(maria([older, tieEarly, newest, tieLate]))
      await prayedButton()
      await burdens().findByRole('button', { name: 'Hide prayer history (4)' })
      const [first, second, third] = items()
      expect(first).toHaveTextContent(formatShortDate(newest.prayedAt))
      expect(second).toHaveTextContent('Someone') // tie-late
      expect(third).toHaveTextContent('Other Shepherd') // tie-early
    })
  })

  describe('sidebar', () => {
    const lastPrayedValue = () => {
      const term = within(screen.getByRole('complementary', { name: 'About' })).getByText(
        'Last prayed',
      )
      return term.nextElementSibling
    }

    it.each([
      [0, 'Today'],
      [1, 'Yesterday'],
      [3, '3 days ago'],
    ])('shows Last prayed %i days ago as "%s", after Last contact', async (n, words) => {
      renderPage(maria([prayer('p1', localDay(n))]))
      await prayedButton()
      expect(lastPrayedValue()).toHaveTextContent(words)
      const terms = within(screen.getByRole('complementary', { name: 'About' }))
        .getAllByRole('term')
        .map((t) => t.textContent)
      expect(terms.indexOf('Last prayed')).toBe(terms.indexOf('Last contact') + 1)
    })

    it('shows Never when nobody has prayed', async () => {
      renderPage(maria())
      await prayedButton()
      expect(lastPrayedValue()).toHaveTextContent('Never')
    })
  })
})
