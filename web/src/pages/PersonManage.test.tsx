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
    contactState: 'NOT_TRACKED',
    isActive: true,
    status: { __typename: 'Status', id: 'st-1', name: 'Active' },
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
          <Route path="/" element={<p>People list stub</p>} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return { myPeople }
}

// The header also shows my name, so look only inside the Shepherds section.
function shepherdsSection() {
  return within(screen.getByText('Shepherds').parentElement as HTMLElement)
}

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
  it('with only me, offers no Remove or Stop shepherding buttons', async () => {
    renderPage([ME_SHEPHERD])
    const heading = await screen.findByText('Shepherds')
    expect(heading).toBeInTheDocument()
    expect(shepherdsSection().getByText(ME.name, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /as shepherd$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop shepherding' })).not.toBeInTheDocument()
  })

  it('with two shepherds, offers Remove for the other and Stop shepherding for me', async () => {
    renderPage([ME_SHEPHERD, OTHER])
    expect(
      await screen.findByRole('button', { name: `Remove ${OTHER.name} as shepherd` }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop shepherding' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `Remove ${ME.name} as shepherd` }),
    ).not.toBeInTheDocument()
  })
})

describe('Removing another shepherd', () => {
  it('confirms, sends the other shepherd id and shows the returned list', async () => {
    const user = userEvent.setup()
    const { mock, result } = unassignMock(OTHER.id, [ME_SHEPHERD])
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await user.click(
      await screen.findByRole('button', { name: `Remove ${OTHER.name} as shepherd` }),
    )
    expect(result).not.toHaveBeenCalled()
    expect(screen.getByText(`Remove ${OTHER.name} as a shepherd?`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    await waitFor(() => expect(shepherdsSection().queryByText(OTHER.name)).not.toBeInTheDocument())
    expect(shepherdsSection().getByText(ME.name, { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })

  it('cancel sends nothing', async () => {
    const user = userEvent.setup()
    const { mock, result } = unassignMock(OTHER.id, [ME_SHEPHERD])
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await user.click(
      await screen.findByRole('button', { name: `Remove ${OTHER.name} as shepherd` }),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(`Remove ${OTHER.name} as a shepherd?`)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: `Remove ${OTHER.name} as shepherd` }),
    ).toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
  })

  it('shows a BAD_USER_INPUT message as-is and stays on the page', async () => {
    const user = userEvent.setup()
    const message = 'A person needs at least one shepherd. Delete them instead.'
    const mock = failing(
      G.UnassignPersonDocument,
      { personId: PERSON_ID, userId: OTHER.id },
      message,
      'BAD_USER_INPUT',
    )
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await user.click(
      await screen.findByRole('button', { name: `Remove ${OTHER.name} as shepherd` }),
    )
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
    expect(screen.getByText('Shepherds')).toBeInTheDocument()
  })
})

describe('Stop shepherding', () => {
  it('confirms, sends my id, refetches MyPeople and navigates to the list', async () => {
    const user = userEvent.setup()
    const { mock, result } = unassignMock(ME.id, [OTHER])
    const { myPeople } = renderPage([ME_SHEPHERD, OTHER], [mock])
    await user.click(await screen.findByRole('button', { name: 'Stop shepherding' }))
    expect(result).not.toHaveBeenCalled()
    expect(screen.getByText(/^Stop shepherding Sam Sheep\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, stop' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    expect(await screen.findByText('People list stub')).toBeInTheDocument()
    await waitFor(() => expect(myPeople).toHaveBeenCalled())
  })

  it('cancel sends nothing and stays on the page', async () => {
    const user = userEvent.setup()
    const { mock, result } = unassignMock(ME.id, [OTHER])
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await user.click(await screen.findByRole('button', { name: 'Stop shepherding' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Stop shepherding' })).toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })

  it('shows the error in an alert and does not navigate when it fails', async () => {
    const user = userEvent.setup()
    const mock = failing(
      G.UnassignPersonDocument,
      { personId: PERSON_ID, userId: ME.id },
      'A person needs at least one shepherd. Delete them instead.',
      'BAD_USER_INPUT',
    )
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await user.click(await screen.findByRole('button', { name: 'Stop shepherding' }))
    await user.click(screen.getByRole('button', { name: 'Yes, stop' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A person needs at least one shepherd. Delete them instead.',
    )
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })
})

describe('Delete person', () => {
  it('warns about every shepherd, deletes by id, refetches MyPeople and navigates', async () => {
    const user = userEvent.setup()
    const { mock, result } = deleteMock()
    const { myPeople } = renderPage([ME_SHEPHERD], [mock])
    await user.click(await screen.findByRole('button', { name: 'Delete person' }))
    expect(result).not.toHaveBeenCalled()
    expect(screen.getByText(/^Delete Sam Sheep\?/)).toBeInTheDocument()
    expect(screen.getByText(/for every shepherd/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(result).toHaveBeenCalled())
    expect(await screen.findByText('People list stub')).toBeInTheDocument()
    await waitFor(() => expect(myPeople).toHaveBeenCalled())
  })

  it('cancel sends nothing and restores the button', async () => {
    const user = userEvent.setup()
    const { mock, result } = deleteMock()
    renderPage([ME_SHEPHERD, OTHER], [mock])
    await user.click(await screen.findByRole('button', { name: 'Delete person' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/^Delete Sam Sheep\?/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete person' })).toBeInTheDocument()
    expect(result).not.toHaveBeenCalled()
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })

  it('shows a BAD_USER_INPUT message in an alert and stays put', async () => {
    const user = userEvent.setup()
    const mock = failing(
      G.DeletePersonDocument,
      { id: PERSON_ID },
      'Cannot delete this one',
      'BAD_USER_INPUT',
    )
    renderPage([ME_SHEPHERD], [mock])
    await user.click(await screen.findByRole('button', { name: 'Delete person' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Cannot delete this one')).toBeInTheDocument()
    expect(screen.queryByText('People list stub')).not.toBeInTheDocument()
  })
})
