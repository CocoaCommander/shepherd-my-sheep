import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { PersonPage } from './PersonPage'

// Header calls useAuth(); the real provider would build a network client.
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const PERSON_ID = 'person-1'
const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }
const OTHER = { __typename: 'User', id: 'user-other', name: 'Other Shepherd' }

const MILESTONE_TYPES = [
  { __typename: 'Milestone', id: 'ms-baptized', name: 'Baptized', description: 'Was baptized' },
  { __typename: 'Milestone', id: 'ms-member', name: 'Joined membership', description: 'Joined' },
  { __typename: 'Milestone', id: 'ms-serving', name: 'Started serving', description: 'Serves' },
]

function recorded(rowId: string, type: (typeof MILESTONE_TYPES)[number]) {
  return {
    __typename: 'MilestonePerson',
    id: rowId,
    dateAchieved: '2026-01-02',
    notes: null,
    milestone: { __typename: 'Milestone', id: type.id, name: type.name },
    recordedBy: { __typename: 'User', id: ME.id, name: ME.name },
  }
}

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
  milestoneTypes?: typeof MILESTONE_TYPES
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
      result: { data: { milestones: opts.milestoneTypes ?? MILESTONE_TYPES } },
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

describe('PersonPage empty states', () => {
  it('shows empty messages and all add forms for a brand new person', async () => {
    renderPage(person())
    expect(await screen.findByText('No milestones yet.')).toBeInTheDocument()
    expect(screen.getByText('No prayer burdens yet.')).toBeInTheDocument()
    expect(screen.getByText('No notes yet.')).toBeInTheDocument()

    expect(await screen.findByLabelText('Milestone')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record milestone' })).toBeInTheDocument()
    expect(screen.getByLabelText('New prayer burden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add prayer burden' })).toBeInTheDocument()
    expect(screen.getByLabelText('New note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument()
  })

  it('renders a burden with zero comments and still shows its comment form', async () => {
    renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }))
    expect(await screen.findByText('Pray for work')).toBeInTheDocument()
    expect(screen.getByLabelText('Comment')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument()
  })

  it('hides the milestone form when the milestone type list is empty', async () => {
    renderPage(person(), { milestoneTypes: [] })
    await screen.findByText('No milestones yet.')
    expect(screen.queryByLabelText('Milestone')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record milestone' })).not.toBeInTheDocument()
  })

  it('hides the milestone form when every type is already recorded', async () => {
    renderPage(person({ milestones: MILESTONE_TYPES.map((t, i) => recorded(`mp${i}`, t)) }))
    await screen.findByRole('button', { name: 'Remove Baptized' })
    expect(screen.queryByLabelText('Milestone')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record milestone' })).not.toBeInTheDocument()
  })
})

describe('PersonPage milestones', () => {
  it('lists only milestone types the person has not recorded', async () => {
    renderPage(person({ milestones: [recorded('mp1', MILESTONE_TYPES[0])] }))
    const select = await screen.findByLabelText('Milestone')
    const names = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toContain('Joined membership')
    expect(names).toContain('Started serving')
    expect(names).not.toContain('Baptized')
  })

  it('records a milestone with date and trimmed notes, then refetches', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.RecordMilestoneDocument,
      {
        input: {
          personId: PERSON_ID,
          milestoneId: 'ms-member',
          dateAchieved: '2026-10-14',
          notes: 'At the Sunday service',
        },
      },
      { recordMilestone: { __typename: 'MilestonePerson', id: 'mp-new' } },
    )
    const { refetch } = renderPage(person(), { mutation })
    const select = await screen.findByLabelText('Milestone')
    await user.selectOptions(select, 'Joined membership')
    fireEvent.change(screen.getByLabelText(/^Date achieved/), { target: { value: '2026-10-14' } })
    expect(screen.getByLabelText(/^Date achieved/)).toHaveAttribute('type', 'date')
    await user.type(screen.getByLabelText(/^Notes/), '  At the Sunday service  ')
    await user.click(screen.getByRole('button', { name: 'Record milestone' }))

    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('sends null, not empty strings, for a blank date and blank notes', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.RecordMilestoneDocument,
      {
        input: { personId: PERSON_ID, milestoneId: 'ms-serving', dateAchieved: null, notes: null },
      },
      { recordMilestone: { __typename: 'MilestonePerson', id: 'mp-new' } },
    )
    renderPage(person(), { mutation })
    const select = await screen.findByLabelText('Milestone')
    await user.selectOptions(select, 'Started serving')
    await user.type(screen.getByLabelText(/^Notes/), '   ')
    await user.click(screen.getByRole('button', { name: 'Record milestone' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
  })

  it('removes a milestone using the milestone type id, not the row id', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.RemoveMilestoneDocument,
      { personId: PERSON_ID, milestoneId: 'ms-baptized' },
      { removeMilestone: true },
    )
    const { refetch } = renderPage(
      person({ milestones: [recorded('mp-row-1', MILESTONE_TYPES[0])] }),
      { mutation },
    )
    await user.click(await screen.findByRole('button', { name: 'Remove Baptized' }))
    expect(result).not.toHaveBeenCalled()
    expect(screen.getByText('Remove this milestone?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Baptized' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('cancelling milestone removal restores the button and sends no mutation', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.RemoveMilestoneDocument,
      { personId: PERSON_ID, milestoneId: 'ms-baptized' },
      { removeMilestone: true },
    )
    const { refetch } = renderPage(
      person({ milestones: [recorded('mp-row-1', MILESTONE_TYPES[0])] }),
      { mutation },
    )
    await user.click(await screen.findByRole('button', { name: 'Remove Baptized' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Remove this milestone?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Baptized' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
  })

  it('shows an alert when removing a milestone fails after confirming', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.RemoveMilestoneDocument,
        variables: { personId: PERSON_ID, milestoneId: 'ms-baptized' },
      } as MockedResponse['request'],
      result: { errors: [new GraphQLError('Cannot remove')] },
    }
    renderPage(person({ milestones: [recorded('mp-row-1', MILESTONE_TYPES[0])] }), { mutation })
    await user.click(await screen.findByRole('button', { name: 'Remove Baptized' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    // No error code, so the friendly generic text is shown, not the raw message.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(alert).not.toHaveTextContent('Cannot remove')
  })

  it('shows the NOT_FOUND sentence when the milestone was already removed elsewhere', async () => {
    const user = userEvent.setup()
    const mutation = {
      request: {
        query: G.RemoveMilestoneDocument,
        variables: { personId: PERSON_ID, milestoneId: 'ms-baptized' },
      } as MockedResponse['request'],
      result: { errors: [new GraphQLError('Not found', { extensions: { code: 'NOT_FOUND' } })] },
    }
    renderPage(person({ milestones: [recorded('mp-row-1', MILESTONE_TYPES[0])] }), { mutation })
    await user.click(await screen.findByRole('button', { name: 'Remove Baptized' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This was changed or removed by someone else.',
    )
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
  it('disables Add prayer burden while the text is blank or whitespace', async () => {
    const user = userEvent.setup()
    renderPage(person())
    const button = await screen.findByRole('button', { name: 'Add prayer burden' })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText('New prayer burden'), '   ')
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText('New prayer burden'), 'x')
    expect(button).toBeEnabled()
  })

  it('creates a burden with trimmed content, clears the textarea and refetches', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.CreatePrayerBurdenDocument,
      { input: { personId: PERSON_ID, content: 'Healing' } },
      { createPrayerBurden: { __typename: 'PrayerBurden', id: 'b-new' } },
    )
    const { refetch } = renderPage(person(), { mutation })
    const textarea = await screen.findByLabelText('New prayer burden')
    await user.type(textarea, '  Healing  ')
    await user.click(screen.getByRole('button', { name: 'Add prayer burden' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    await waitFor(() => expect(textarea).toHaveValue(''))
  })

  it('shows a GraphQL error message in an alert', async () => {
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
    await user.type(await screen.findByLabelText('New prayer burden'), 'Healing')
    await user.click(screen.getByRole('button', { name: 'Add prayer burden' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed to do that')
  })

  it('releases an active burden', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.ReleasePrayerBurdenDocument,
      { id: 'b1' },
      { releasePrayerBurden: { __typename: 'PrayerBurden', id: 'b1' } },
    )
    const { refetch } = renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }), {
      mutation,
    })
    await user.click(await screen.findByRole('button', { name: 'Release' }))
    expect(result).not.toHaveBeenCalled()
    expect(screen.getByText('Release this prayer burden?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, release' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('cancelling release restores the button and sends no mutation', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.ReleasePrayerBurdenDocument,
      { id: 'b1' },
      { releasePrayerBurden: { __typename: 'PrayerBurden', id: 'b1' } },
    )
    const { refetch } = renderPage(person({ prayerBurdens: [burden('b1', 'Pray for work')] }), {
      mutation,
    })
    await user.click(await screen.findByRole('button', { name: 'Release' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Release this prayer burden?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
  })

  it('puts released burdens under a Released (n) details without Release or comment form', async () => {
    renderPage(
      person({
        prayerBurdens: [
          burden('b-old1', 'Old one', '2026-09-01'),
          burden('b-old2', 'Old two', '2026-09-02'),
        ],
        comments: [comment('c1', 'It was answered', { burdenId: 'b-old1', author: OTHER })],
      }),
    )
    const summary = await screen.findByText('Released (2)')
    const details = summary.closest('details')
    expect(details).not.toBeNull()
    expect(within(details!).getByText('Old one')).toBeInTheDocument()
    // Existing comments on released burdens still show.
    expect(screen.getByText('It was answered')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Comment')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add comment' })).not.toBeInTheDocument()
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
    const textareas = screen.getAllByLabelText('Comment')
    expect(textareas).toHaveLength(2)
    await user.type(textareas[1], '  Checking in  ')
    await user.click(screen.getAllByRole('button', { name: 'Add comment' })[1])
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    await waitFor(() => expect(textareas[1]).toHaveValue(''))
  })
})

describe('PersonPage notes', () => {
  it('adds a standalone note with an explicit null prayerBurdenId', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.CreateCommentDocument,
      { input: { personId: PERSON_ID, prayerBurdenId: null, content: 'Met for coffee' } },
      { createComment: { __typename: 'Comment', id: 'c-new' } },
    )
    const { refetch } = renderPage(person(), { mutation })
    const textarea = await screen.findByLabelText('New note')
    await user.type(textarea, ' Met for coffee ')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    await waitFor(() => expect(textarea).toHaveValue(''))
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
    // A person with a standalone note is not in the "No notes yet." state.
    expect(screen.queryByText('No notes yet.')).not.toBeInTheDocument()

    const notesHeading = screen.getByRole('heading', { name: /notes/i })
    const notes = notesHeading.closest('section') ?? notesHeading.parentElement!
    expect(within(notes).getByText('Standalone note')).toBeInTheDocument()
    expect(within(notes).queryByText('Linked comment')).not.toBeInTheDocument()
  })

  it('shows "No notes yet." when the only comments are linked to a burden', async () => {
    renderPage(
      person({
        prayerBurdens: [burden('b1', 'Pray for work')],
        comments: [comment('c1', 'Linked comment', { burdenId: 'b1' })],
      }),
    )
    expect(await screen.findByText('Linked comment')).toBeInTheDocument()
    expect(screen.getByText('No notes yet.')).toBeInTheDocument()
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
    expect(screen.getByText('Delete this comment?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('cancelling delete restores the button and sends no mutation', async () => {
    const user = userEvent.setup()
    const { mutation, result } = mutationMock(
      G.DeleteCommentDocument,
      { id: 'c3' },
      { deleteComment: true },
    )
    const { refetch } = renderPage(person({ comments: [comment('c3', 'My note')] }), { mutation })
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete this comment?')).not.toBeInTheDocument()
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
