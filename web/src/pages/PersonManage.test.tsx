import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { PersonPage } from './PersonPage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const PERSON_ID = 'person-1'
const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }
const OTHER = { __typename: 'User', id: 'user-other', name: 'Other Shepherd' }
const ME_SHEPHERD = { __typename: 'User', id: ME.id, name: ME.name }

function person(shepherds: object[]) {
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
    recordedMilestoneIds: [],
    activeBurdenCount: 0,
    latestComment: null,
    shepherds,
    milestones: [],
    prayerBurdens: [],
    comments: [],
    contacts: [],
  }
}

function renderPage(shepherds: object[], extra: MockedResponse[] = []) {
  const myPeople = vi.fn(() => ({ data: { myPeople: [] } }))
  const mocks: MockedResponse[] = [
    {
      request: { query: G.PersonDocument, variables: { id: PERSON_ID } },
      result: { data: { person: person(shepherds) } },
      maxUsageCount: Number.POSITIVE_INFINITY,
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
      request: { query: G.MyPeopleDocument },
      result: myPeople,
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    ...extra,
  ]
  render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={[`/people/${PERSON_ID}`]}>
        <Routes>
          <Route path="/people/:id" element={<PersonPage />} />
          <Route path="/people" element={<p>People list stub</p>} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return { myPeople }
}

// The header also shows my name, so look only inside the Shepherds section.
function shepherdsSection() {
  const heading = screen.getByRole('heading', { level: 2, name: 'Shepherds' })
  return within((heading.closest('section') ?? heading.parentElement) as HTMLElement)
}

/** The shepherd's row in the Shepherds list: the list item holding their name. */
function rowOf(name: string) {
  return shepherdsSection().getByText(name, { exact: false }).closest('li') as HTMLElement
}

const removeButton = (shepherd: string) =>
  screen.getByRole('button', { name: `Remove ${shepherd} as shepherd` })
const stopButton = () => screen.getByRole('button', { name: 'Stop shepherding Sam Sheep' })
const openDialog = (title: string) => screen.getByRole('dialog', { name: title })

function unassignMock(userId: string, shepherds: object[]) {
  const result = vi.fn(() => ({
    data: { unassignPerson: { __typename: 'Person', id: PERSON_ID, shepherds } },
  }))
  return {
    result,
    mock: {
      request: {
        query: G.UnassignPersonDocument,
        variables: { personId: PERSON_ID, userId },
      } as MockedResponse['request'],
      result,
    },
  }
}

function deleteMock() {
  const result = vi.fn(() => ({ data: { deletePerson: true } }))
  return {
    result,
    mock: {
      request: {
        query: G.DeletePersonDocument,
        variables: { id: PERSON_ID },
      } as MockedResponse['request'],
      result,
    },
  }
}

function failing(
  query: unknown,
  variables: Record<string, unknown>,
  message: string,
  code: string,
) {
  return {
    request: { query, variables } as MockedResponse['request'],
    result: { errors: [new GraphQLError(message, { extensions: { code } })] },
  }
}

describe('Shepherds list', () => {
  it('with only me, shows me as You and offers no Remove buttons at all', async () => {
    renderPage([ME_SHEPHERD])
    await screen.findByRole('heading', { level: 2, name: 'Shepherds' })
    const row = within(rowOf(ME.name))
    expect(row.getByText(ME.name)).toBeInTheDocument()
    expect(row.getByText('You')).toBeInTheDocument()
    expect(
      shepherdsSection().queryByRole('button', { name: /^Remove|^Stop shepherding/ }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /as shepherd$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Stop shepherding/ })).not.toBeInTheDocument()
    expect(shepherdsSection().getByRole('button', { name: 'Add shepherd' })).toBeInTheDocument()
  })

  it('with two shepherds, offers Remove for the co-shepherd and Stop shepherding on my row', async () => {
    renderPage([ME_SHEPHERD, OTHER])
    await screen.findByRole('button', { name: `Remove ${OTHER.name} as shepherd` })
    const other = within(rowOf(OTHER.name))
    expect(other.getByText('Co-shepherd')).toBeInTheDocument()
    expect(
      other.getByRole('button', { name: `Remove ${OTHER.name} as shepherd` }),
    ).toHaveTextContent('Remove')
    const mine = within(rowOf(ME.name))
    expect(mine.getByText('You')).toBeInTheDocument()
    expect(mine.getByRole('button', { name: 'Stop shepherding Sam Sheep' })).toHaveTextContent(
      'Remove',
    )
    expect(
      screen.queryByRole('button', { name: `Remove ${ME.name} as shepherd` }),
    ).not.toBeInTheDocument()
  })
})

describe('Removing another shepherd', () => {
  it('confirms in a dialog, sends the other shepherd id, shows the returned list and stays', async () => {
    const user = userEvent.setup()
    const { mock, result } = unassignMock(OTHER.id, [ME_SHEPHERD])
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await screen.findByRole('button', { name: `Remove ${OTHER.name} as shepherd` })
    await user.click(removeButton(OTHER.name))
    expect(result).not.toHaveBeenCalled()
    const dialog = openDialog(`Remove ${OTHER.name} as a shepherd?`)
    await user.click(within(dialog).getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(shepherdsSection().queryByText(OTHER.name)).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(shepherdsSection().getByText(ME.name, { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })

  it('Cancel closes the dialog and sends nothing', async () => {
    const user = userEvent.setup()
    const { mock, result } = unassignMock(OTHER.id, [ME_SHEPHERD])
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await screen.findByRole('button', { name: `Remove ${OTHER.name} as shepherd` })
    await user.click(removeButton(OTHER.name))
    await user.click(
      within(openDialog(`Remove ${OTHER.name} as a shepherd?`)).getByRole('button', {
        name: 'Cancel',
      }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(removeButton(OTHER.name)).toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
  })

  it('the dialog Close button closes it and sends nothing', async () => {
    const user = userEvent.setup()
    const { mock, result } = unassignMock(OTHER.id, [ME_SHEPHERD])
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await screen.findByRole('button', { name: `Remove ${OTHER.name} as shepherd` })
    await user.click(removeButton(OTHER.name))
    await user.click(
      within(openDialog(`Remove ${OTHER.name} as a shepherd?`)).getByRole('button', {
        name: 'Close',
      }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
  })

  it('keeps the dialog open with a BAD_USER_INPUT message as-is, and the shepherd listed', async () => {
    const user = userEvent.setup()
    const message = 'A person needs at least one shepherd. Delete them instead.'
    const mock = failing(
      G.UnassignPersonDocument,
      { personId: PERSON_ID, userId: OTHER.id },
      message,
      'BAD_USER_INPUT',
    )
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await screen.findByRole('button', { name: `Remove ${OTHER.name} as shepherd` })
    await user.click(removeButton(OTHER.name))
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    const dialog = openDialog(`Remove ${OTHER.name} as a shepherd?`)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
    expect(shepherdsSection().getByText(OTHER.name)).toBeInTheDocument()
  })
})

describe('Stop shepherding', () => {
  it('confirms, sends my id, refetches MyPeople and navigates to the list', async () => {
    const user = userEvent.setup()
    const { mock, result } = unassignMock(ME.id, [OTHER])
    const { myPeople } = renderPage([ME_SHEPHERD, OTHER], [mock])
    await screen.findByRole('button', { name: 'Stop shepherding Sam Sheep' })
    await user.click(stopButton())
    expect(result).not.toHaveBeenCalled()
    const dialog = openDialog('Stop shepherding Sam Sheep?')
    await user.click(within(dialog).getByRole('button', { name: 'Yes, stop' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    expect(await screen.findByText('People list stub')).toBeInTheDocument()
    await waitFor(() => expect(myPeople).toHaveBeenCalled())
  })

  it('Cancel closes the dialog, sends nothing and stays on the page', async () => {
    const user = userEvent.setup()
    const { mock, result } = unassignMock(ME.id, [OTHER])
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await screen.findByRole('button', { name: 'Stop shepherding Sam Sheep' })
    await user.click(stopButton())
    await user.click(
      within(openDialog('Stop shepherding Sam Sheep?')).getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(stopButton()).toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })

  it('keeps the dialog with the error in an alert and does not navigate when it fails', async () => {
    const user = userEvent.setup()
    const message = 'A person needs at least one shepherd. Delete them instead.'
    const mock = failing(
      G.UnassignPersonDocument,
      { personId: PERSON_ID, userId: ME.id },
      message,
      'BAD_USER_INPUT',
    )
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await screen.findByRole('button', { name: 'Stop shepherding Sam Sheep' })
    await user.click(stopButton())
    await user.click(screen.getByRole('button', { name: 'Yes, stop' }))
    const dialog = openDialog('Stop shepherding Sam Sheep?')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })
})

describe('Delete person', () => {
  const deleteButton = () => screen.findByRole('button', { name: 'Delete Sam Sheep' })

  it('shows the button with the name and warns in the dialog that it cannot be undone', async () => {
    const user = userEvent.setup()
    renderPage([ME_SHEPHERD])
    const button = await deleteButton()
    expect(button).toHaveTextContent('Delete Sam Sheep')
    await user.click(button)
    const dialog = openDialog('Delete Sam Sheep?')
    expect(dialog).toHaveTextContent("It can't be undone.")
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('deletes by id, refetches MyPeople and navigates', async () => {
    const user = userEvent.setup()
    const { mock, result } = deleteMock()
    const { myPeople } = renderPage([ME_SHEPHERD], [mock])
    await user.click(await deleteButton())
    expect(result).not.toHaveBeenCalled()
    await user.click(
      within(openDialog('Delete Sam Sheep?')).getByRole('button', { name: 'Yes, delete' }),
    )
    await waitFor(() => expect(result).toHaveBeenCalled())
    expect(await screen.findByText('People list stub')).toBeInTheDocument()
    await waitFor(() => expect(myPeople).toHaveBeenCalled())
  })

  it('Cancel closes the dialog and sends nothing', async () => {
    const user = userEvent.setup()
    const { mock, result } = deleteMock()
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await user.click(await deleteButton())
    await user.click(
      within(openDialog('Delete Sam Sheep?')).getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Sam Sheep' })).toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })

  it('keeps the dialog with a BAD_USER_INPUT message in an alert and stays put', async () => {
    const user = userEvent.setup()
    const mock = failing(
      G.DeletePersonDocument,
      { id: PERSON_ID },
      'Cannot delete this one',
      'BAD_USER_INPUT',
    )
    renderPage([ME_SHEPHERD], [mock])
    await user.click(await deleteButton())
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    const dialog = openDialog('Delete Sam Sheep?')
    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText('Cannot delete this one')).toBeInTheDocument()
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })
})
