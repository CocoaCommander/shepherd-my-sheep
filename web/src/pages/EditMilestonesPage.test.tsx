import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { EditMilestonesPage } from './EditMilestonesPage'

// Header calls useAuth(); the real provider would build a network client.
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }

function ms(id: string, name: string, description: string | null, recordedCount: number) {
  return { __typename: 'Milestone', id, name, description, recordedCount }
}

// The API lists them A to Z.
const BAPTISED = ms('ms-b', 'Baptised', 'Was baptised', 1)
const GROUP = ms('ms-g', 'joined small group', null, 0)
const SERVING = ms('ms-s', 'serving', 'Serves regularly', 12)
const LIST = [BAPTISED, GROUP, SERVING]

type Milestone = ReturnType<typeof ms>

const forever = { maxUsageCount: Number.POSITIVE_INFINITY }

function gqlError(message: string, code: string) {
  return { errors: [new GraphQLError(message, { extensions: { code } })] }
}

function mutation(query: unknown, variables: Record<string, unknown>, result: object) {
  const fn = vi.fn(() => result)
  return {
    fn,
    mock: { request: { query, variables } as MockedResponse['request'], result: fn },
  }
}

/**
 * Renders the page. Each Milestones load takes the next list (the last repeats), so a
 * mutation's awaited refetch sees what the server would then return.
 */
function renderPage(lists: Milestone[][], mocks: MockedResponse[] = [], entries?: string[]) {
  let i = 0
  const load = vi.fn(() => ({ data: { milestones: lists[Math.min(i++, lists.length - 1)] } }))
  render(
    <MockedProvider
      mocks={[
        { request: { query: G.MilestonesDocument }, result: load, ...forever },
        { request: { query: G.MeDocument }, result: { data: { me: ME } }, ...forever },
        ...mocks,
      ]}
    >
      <MemoryRouter initialEntries={entries ?? ['/milestones/edit']} initialIndex={entries ? 1 : 0}>
        <Routes>
          <Route path="/milestones/edit" element={<EditMilestonesPage />} />
          <Route path="/people/1" element={<p>Person page</p>} />
          <Route path="/people" element={<p>People route</p>} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return { load }
}

const addCard = () => screen.getByRole('region', { name: 'Add a milestone' })
const nameField = (scope: HTMLElement) => within(scope).getByLabelText(/^Name/)
const descField = (scope: HTMLElement) => within(scope).getByLabelText(/^Description/)
const rows = () => within(screen.getByRole('list')).getAllByRole('listitem')
const heading = (name: string) => screen.findByRole('heading', { level: 2, name })

async function ready() {
  await screen.findByRole('heading', { level: 2, name: /^\d+ milestones?$/ })
  await screen.findByRole('button', { name: /^Add milestone$/ })
}

async function confirmDelete(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Delete ${name}` }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete milestone' }),
  )
}

describe('EditMilestonesPage list', () => {
  it('shows the title, the shared-list lead and a Back link to My people when opened directly', async () => {
    renderPage([LIST])
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit milestones' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Shared by everyone in Shepherd My Sheep. A change shows on every person's page and for every shepherd.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/people')
  })

  it('goes back in history when opened from another page', async () => {
    const user = userEvent.setup()
    renderPage([LIST], [], ['/people/1', '/milestones/edit'])
    await user.click(await screen.findByRole('link', { name: 'Back' }))
    expect(await screen.findByText('Person page')).toBeInTheDocument()
  })

  it('lists milestones in the API order with description and recorded counts', async () => {
    renderPage([LIST])
    expect(await heading('3 milestones')).toBeInTheDocument()
    expect(screen.getByText('Sorted A to Z')).toBeInTheDocument()
    const items = rows()
    expect(items).toHaveLength(3)
    // Names verbatim, in the order given, not re-sorted.
    expect(items[0]).toHaveTextContent('Baptised')
    expect(items[0]).toHaveTextContent('Was baptised')
    expect(items[0]).toHaveTextContent('Recorded for 1 person')
    expect(items[0]).not.toHaveTextContent('1 people')
    expect(items[1]).toHaveTextContent('joined small group')
    expect(items[1]).toHaveTextContent('No description')
    expect(items[1]).toHaveTextContent('Not recorded yet')
    expect(items[2]).toHaveTextContent('serving')
    expect(items[2]).toHaveTextContent('Recorded for 12 people')
    for (const li of items) {
      expect(within(li).getByRole('button', { name: /^Edit / })).toBeInTheDocument()
      expect(within(li).getByRole('button', { name: /^Delete / })).toBeInTheDocument()
    }
  })

  it('says "1 milestone" for a single one', async () => {
    renderPage([[BAPTISED]])
    expect(await heading('1 milestone')).toBeInTheDocument()
  })

  it('shows an empty state, not an error, when there are no milestones (rule 7)', async () => {
    renderPage([[]])
    expect(await heading('0 milestones')).toBeInTheDocument()
    expect(screen.getByText('No milestones yet')).toBeInTheDocument()
    expect(screen.getByText('Add the first one with the form.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(addCard()).toBeInTheDocument()
  })
})

describe('EditMilestonesPage add', () => {
  it('sends the trimmed name and description, toasts, clears the form and lists it', async () => {
    const user = userEvent.setup()
    const added = ms('ms-m', 'Mentoring', 'Guides someone', 0)
    const { mock, fn } = mutation(
      G.CreateMilestoneDocument,
      { input: { name: 'Mentoring', description: 'Guides someone' } },
      { data: { createMilestone: added } },
    )
    renderPage([LIST, [BAPTISED, GROUP, added, SERVING]], [mock])
    await ready()
    await user.type(nameField(addCard()), '  Mentoring  ')
    await user.type(descField(addCard()), ' Guides someone ')
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    await waitFor(() => expect(fn).toHaveBeenCalled())
    expect(
      await screen.findByText('Added “Mentoring”. It shows as not yet reached for everyone.'),
    ).toBeInTheDocument()
    expect(nameField(addCard())).toHaveValue('')
    expect(descField(addCard())).toHaveValue('')
    expect(await heading('4 milestones')).toBeInTheDocument()
  })

  it('sends a null description when it is left blank', async () => {
    const user = userEvent.setup()
    const added = ms('ms-m', 'Mentoring', null, 0)
    const { mock, fn } = mutation(
      G.CreateMilestoneDocument,
      { input: { name: 'Mentoring', description: null } },
      { data: { createMilestone: added } },
    )
    renderPage([[], [added]], [mock])
    await ready()
    await user.type(nameField(addCard()), 'Mentoring')
    await user.type(descField(addCard()), '   ')
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    await waitFor(() => expect(fn).toHaveBeenCalled())
    expect(await heading('1 milestone')).toBeInTheDocument()
  })

  it('asks for a name and sends nothing', async () => {
    const user = userEvent.setup()
    const { mock, fn } = mutation(G.CreateMilestoneDocument, {}, { data: {} })
    renderPage([LIST], [mock])
    await ready()
    await user.type(nameField(addCard()), '   ')
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    expect(within(addCard()).getByRole('alert')).toHaveTextContent(
      'Enter a name for the milestone.',
    )
    expect(nameField(addCard())).toHaveFocus()
    expect(fn).not.toHaveBeenCalled()
  })

  it('rejects a duplicate ignoring case, naming the listed spelling', async () => {
    const user = userEvent.setup()
    const { mock, fn } = mutation(G.CreateMilestoneDocument, {}, { data: {} })
    renderPage([LIST], [mock])
    await ready()
    await user.type(nameField(addCard()), 'BAPTISED')
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    expect(within(addCard()).getByRole('alert')).toHaveTextContent(
      'A milestone called “Baptised” already exists.',
    )
    expect(fn).not.toHaveBeenCalled()
  })

  it('rejects a name over 100 characters', async () => {
    const user = userEvent.setup()
    const { mock, fn } = mutation(G.CreateMilestoneDocument, {}, { data: {} })
    renderPage([LIST], [mock])
    await ready()
    expect(nameField(addCard())).toHaveAttribute('maxlength', '100')
    fireEvent.change(nameField(addCard()), { target: { value: 'a'.repeat(101) } })
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    expect(within(addCard()).getByRole('alert')).toHaveTextContent('Use 100 characters or fewer.')
    expect(fn).not.toHaveBeenCalled()
  })

  it('rejects a description over 1000 characters', async () => {
    const user = userEvent.setup()
    const { mock, fn } = mutation(G.CreateMilestoneDocument, {}, { data: {} })
    renderPage([LIST], [mock])
    await ready()
    await user.type(nameField(addCard()), 'Mentoring')
    fireEvent.change(descField(addCard()), { target: { value: 'a'.repeat(1001) } })
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    expect(within(addCard()).getByRole('alert')).toHaveTextContent(
      'Use 1000 characters or fewer for the description.',
    )
    expect(descField(addCard())).toHaveFocus()
    expect(fn).not.toHaveBeenCalled()
  })

  it('shows a server CONFLICT under the name field and keeps the form', async () => {
    const user = userEvent.setup()
    const { mock } = mutation(
      G.CreateMilestoneDocument,
      { input: { name: 'Mentoring', description: null } },
      gqlError('A milestone called “Mentoring” already exists.', 'CONFLICT'),
    )
    renderPage([LIST], [mock])
    await ready()
    await user.type(nameField(addCard()), 'Mentoring')
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    const alert = await within(addCard()).findByRole('alert')
    expect(alert).toHaveTextContent('A milestone called “Mentoring” already exists.')
    expect(nameField(addCard())).toHaveAccessibleDescription(/already exists/)
    expect(nameField(addCard())).toHaveValue('Mentoring')
  })

  it('shows a server message that mentions the description under the description field', async () => {
    const user = userEvent.setup()
    const { mock } = mutation(
      G.CreateMilestoneDocument,
      { input: { name: 'Mentoring', description: null } },
      gqlError('The description is too long.', 'BAD_USER_INPUT'),
    )
    renderPage([LIST], [mock])
    await ready()
    await user.type(nameField(addCard()), 'Mentoring')
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    await within(addCard()).findByRole('alert')
    expect(descField(addCard())).toHaveAccessibleDescription(/description is too long/)
  })

  it('shows the generic message above the fields for other errors', async () => {
    const user = userEvent.setup()
    const { mock } = mutation(
      G.CreateMilestoneDocument,
      { input: { name: 'Mentoring', description: null } },
      gqlError('db exploded', 'INTERNAL'),
    )
    renderPage([LIST], [mock])
    await ready()
    await user.type(nameField(addCard()), 'Mentoring')
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    const alert = await within(addCard()).findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(alert).not.toHaveTextContent('db exploded')
  })
})

describe('EditMilestonesPage edit', () => {
  it('opens one inline form at a time, filled in, and Cancel and Escape close it', async () => {
    const user = userEvent.setup()
    renderPage([LIST])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Edit Baptised' }))
    const form = screen.getByRole('form', { name: 'Edit Baptised' })
    expect(nameField(form)).toHaveValue('Baptised')
    expect(descField(form)).toHaveValue('Was baptised')
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Edit Baptised' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit serving' }))
    await user.click(screen.getByRole('button', { name: 'Edit Baptised' }))
    expect(screen.queryByRole('form', { name: 'Edit serving' })).not.toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Edit Baptised' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('form', { name: 'Edit Baptised' })).not.toBeInTheDocument()
  })

  it('saves a new name and description and toasts', async () => {
    const user = userEvent.setup()
    const saved = ms('ms-b', 'Baptism', 'Water baptism', 1)
    const { mock, fn } = mutation(
      G.UpdateMilestoneDocument,
      { id: 'ms-b', input: { name: 'Baptism', description: 'Water baptism' } },
      { data: { updateMilestone: saved } },
    )
    renderPage([LIST, [saved, GROUP, SERVING]], [mock])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Edit Baptised' }))
    const form = screen.getByRole('form', { name: 'Edit Baptised' })
    await user.clear(nameField(form))
    await user.type(nameField(form), ' Baptism ')
    await user.clear(descField(form))
    await user.type(descField(form), 'Water baptism')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fn).toHaveBeenCalled())
    expect(
      await screen.findByText('Saved “Baptism”. Every person page now shows the new wording.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Baptism' })).toBeInTheDocument()
  })

  it('clears the description by sending null when it is blanked', async () => {
    const user = userEvent.setup()
    const saved = ms('ms-b', 'Baptised', null, 1)
    const { mock, fn } = mutation(
      G.UpdateMilestoneDocument,
      { id: 'ms-b', input: { name: 'Baptised', description: null } },
      { data: { updateMilestone: saved } },
    )
    renderPage([LIST, [saved, GROUP, SERVING]], [mock])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Edit Baptised' }))
    const form = screen.getByRole('form', { name: 'Edit Baptised' })
    await user.clear(descField(form))
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fn).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByText('No description')).toHaveLength(2))
  })

  it('lets a milestone change only the case of its own name', async () => {
    const user = userEvent.setup()
    const saved = ms('ms-b', 'baptised', 'Was baptised', 1)
    const { mock, fn } = mutation(
      G.UpdateMilestoneDocument,
      { id: 'ms-b', input: { name: 'baptised', description: 'Was baptised' } },
      { data: { updateMilestone: saved } },
    )
    renderPage([LIST, [saved, GROUP, SERVING]], [mock])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Edit Baptised' }))
    const form = screen.getByRole('form', { name: 'Edit Baptised' })
    await user.clear(nameField(form))
    await user.type(nameField(form), 'baptised')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fn).toHaveBeenCalled())
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument()
  })

  it('refuses another milestone’s name, ignoring case', async () => {
    const user = userEvent.setup()
    const { mock, fn } = mutation(G.UpdateMilestoneDocument, {}, { data: {} })
    renderPage([LIST], [mock])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Edit Baptised' }))
    const form = screen.getByRole('form', { name: 'Edit Baptised' })
    await user.clear(nameField(form))
    await user.type(nameField(form), 'SERVING')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'A milestone called “serving” already exists.',
    )
    expect(fn).not.toHaveBeenCalled()
  })

  it('says it was changed or removed by someone else on NOT_FOUND, and Close refreshes the list', async () => {
    const user = userEvent.setup()
    const { mock } = mutation(
      G.UpdateMilestoneDocument,
      { id: 'ms-b', input: { name: 'Baptised', description: 'Was baptised' } },
      gqlError('Not found', 'NOT_FOUND'),
    )
    renderPage([LIST, [GROUP, SERVING]], [mock])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Edit Baptised' }))
    const form = screen.getByRole('form', { name: 'Edit Baptised' })
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'This was changed or removed by someone else.',
    )
    expect(within(form).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Close' }))
    expect(await heading('2 milestones')).toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })
})

describe('EditMilestonesPage delete', () => {
  it('warns about recorded dates and notes, in an alertdialog, when someone has it recorded', async () => {
    const user = userEvent.setup()
    renderPage([LIST])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Delete serving' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete “serving”?' })
    expect(dialog).toHaveTextContent(
      'Recorded for 12 people. Their dates and notes for this milestone will be deleted too.',
    )
    expect(dialog).toHaveTextContent(
      'It will be removed for every shepherd and every person. You can undo for a few seconds after deleting.',
    )
    expect(dialog).toHaveAccessibleDescription(/Recorded for 12 people/)
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete milestone' })).toBeInTheDocument()
  })

  it('uses the singular for one person', async () => {
    const user = userEvent.setup()
    renderPage([LIST])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Delete Baptised' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Recorded for 1 person.')
  })

  it('says nobody has it recorded when the count is zero', async () => {
    const user = userEvent.setup()
    renderPage([LIST])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Delete joined small group' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete “joined small group”?' })
    expect(dialog).toHaveTextContent('Nobody has this milestone recorded yet.')
    expect(dialog).not.toHaveTextContent('Their dates and notes')
  })

  it('Cancel closes it and deletes nothing', async () => {
    const user = userEvent.setup()
    const { mock, fn } = mutation(
      G.DeleteMilestoneDocument,
      { id: 'ms-s' },
      { data: { deleteMilestone: true } },
    )
    renderPage([LIST], [mock])
    await ready()
    await user.click(screen.getByRole('button', { name: 'Delete serving' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(fn).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(3)
  })

  it('deletes, toasts with Undo, and Undo restores it by id', async () => {
    const user = userEvent.setup()
    const del = mutation(
      G.DeleteMilestoneDocument,
      { id: 'ms-s' },
      { data: { deleteMilestone: true } },
    )
    const restore = mutation(
      G.RestoreMilestoneDocument,
      { id: 'ms-s' },
      { data: { restoreMilestone: SERVING } },
    )
    renderPage([LIST, [BAPTISED, GROUP], LIST], [del.mock, restore.mock])
    await ready()
    await confirmDelete(user, 'serving')
    await waitFor(() => expect(del.fn).toHaveBeenCalled())
    expect(await screen.findByText('Deleted “serving”.')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await heading('2 milestones')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restore.fn).toHaveBeenCalled())
    expect(await heading('3 milestones')).toBeInTheDocument()
  })

  it('shows the server’s CONFLICT message when Undo cannot restore (name taken since)', async () => {
    const user = userEvent.setup()
    const del = mutation(
      G.DeleteMilestoneDocument,
      { id: 'ms-s' },
      { data: { deleteMilestone: true } },
    )
    const restore = mutation(
      G.RestoreMilestoneDocument,
      { id: 'ms-s' },
      gqlError('A milestone called “serving” already exists.', 'CONFLICT'),
    )
    renderPage([LIST, [BAPTISED, GROUP]], [del.mock, restore.mock])
    await ready()
    await confirmDelete(user, 'serving')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByText('A milestone called “serving” already exists.'),
    ).toBeInTheDocument()
  })

  it('says it was changed or removed by someone else when Undo finds it gone', async () => {
    const user = userEvent.setup()
    const del = mutation(
      G.DeleteMilestoneDocument,
      { id: 'ms-s' },
      { data: { deleteMilestone: true } },
    )
    const restore = mutation(
      G.RestoreMilestoneDocument,
      { id: 'ms-s' },
      gqlError('Gone', 'NOT_FOUND'),
    )
    renderPage([LIST, [BAPTISED, GROUP]], [del.mock, restore.mock])
    await ready()
    await confirmDelete(user, 'serving')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByText('This was changed or removed by someone else.'),
    ).toBeInTheDocument()
  })

  it('shows a friendly error in the dialog when the delete fails, and keeps it open', async () => {
    const user = userEvent.setup()
    const del = mutation(
      G.DeleteMilestoneDocument,
      { id: 'ms-s' },
      gqlError('db exploded', 'INTERNAL'),
    )
    renderPage([LIST], [del.mock])
    await ready()
    await confirmDelete(user, 'serving')
    const alert = await within(screen.getByRole('alertdialog')).findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(alert).not.toHaveTextContent('db exploded')
  })
})

describe('EditMilestonesPage (narrow)', () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })
  function narrow() {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(max-width: 719px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
  }

  it('says "A to Z" and points to the form below when empty', async () => {
    narrow()
    renderPage([[]])
    expect(await screen.findByText('Add the first one below.')).toBeInTheDocument()
    expect(screen.getByText('A to Z')).toBeInTheDocument()
    expect(screen.queryByText('Sorted A to Z')).not.toBeInTheDocument()
  })

  it('shows the recorded count in each row', async () => {
    narrow()
    renderPage([LIST])
    await ready()
    expect(rows()[2]).toHaveTextContent('Recorded for 12 people')
  })

  it('uses the short toast wording for add and save', async () => {
    narrow()
    const user = userEvent.setup()
    const added = ms('ms-m', 'Mentoring', null, 0)
    const create = mutation(
      G.CreateMilestoneDocument,
      { input: { name: 'Mentoring', description: null } },
      { data: { createMilestone: added } },
    )
    const saved = ms('ms-g', 'joined small group', 'Joined', 0)
    const update = mutation(
      G.UpdateMilestoneDocument,
      { id: 'ms-g', input: { name: 'joined small group', description: 'Joined' } },
      { data: { updateMilestone: saved } },
    )
    renderPage(
      [LIST, [...LIST, added], [BAPTISED, saved, SERVING, added]],
      [create.mock, update.mock],
    )
    await ready()
    await user.type(nameField(addCard()), 'Mentoring')
    await user.click(within(addCard()).getByRole('button', { name: 'Add milestone' }))
    expect(await screen.findByText('Added “Mentoring”.')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Edit joined small group' }))
    const form = screen.getByRole('form', { name: 'Edit joined small group' })
    await user.type(descField(form), 'Joined')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Saved “joined small group”.')).toBeInTheDocument()
  })
})
