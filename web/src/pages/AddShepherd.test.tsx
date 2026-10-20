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
const ME_SHEPHERD = { __typename: 'User', id: ME.id, name: ME.name }
const ANNA = { __typename: 'User', id: 'user-anna', name: 'Anna Helper', username: 'anna' }
const BEN = { __typename: 'User', id: 'user-ben', name: 'Ben Helper', username: 'ben' }
const ANNA_SHEPHERD = { __typename: 'User', id: ANNA.id, name: ANNA.name }

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
  const personQuery = vi.fn(() => ({ data: { person: person(shepherds) } }))
  const mocks: MockedResponse[] = [
    {
      request: { query: G.PersonDocument, variables: { id: PERSON_ID } },
      result: personQuery,
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
  return { personQuery }
}

function shepherdsSection() {
  return within(screen.getByText('Shepherds').parentElement as HTMLElement)
}

function searchMock(query: string, users: object[]) {
  const result = vi.fn(() => ({ data: { searchUsers: users } }))
  return {
    result,
    mock: {
      request: { query: G.SearchUsersDocument, variables: { query } } as MockedResponse['request'],
      result,
    },
  }
}

function assignMock(userId: string, shepherds: object[]) {
  const result = vi.fn(() => ({
    data: { assignPerson: { __typename: 'Person', id: PERSON_ID, shepherds } },
  }))
  return {
    result,
    mock: {
      request: {
        query: G.AssignPersonDocument,
        variables: { personId: PERSON_ID, userId },
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

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add shepherd' }))
  return screen.getByLabelText('Search users')
}

describe('Opening the search', () => {
  it('shows the search input and Done after clicking Add shepherd, and Done closes it', async () => {
    const user = userEvent.setup()
    renderPage([ME_SHEPHERD])
    expect(await screen.findByRole('button', { name: 'Add shepherd' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Search users')).not.toBeInTheDocument()

    await openSearch(user)
    expect(screen.getByLabelText('Search users')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByLabelText('Search users')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
  })
})

describe('Searching', () => {
  it('sends the trimmed text after the debounce and lists name and @username', async () => {
    const user = userEvent.setup()
    const { mock, result } = searchMock('helper', [ANNA, BEN])
    renderPage([ME_SHEPHERD], [mock])
    const input = await openSearch(user)
    await user.type(input, '  helper ')
    expect(await screen.findByText('Anna Helper')).toBeInTheDocument()
    expect(screen.getByText('@anna')).toBeInTheDocument()
    expect(screen.getByText('Ben Helper')).toBeInTheDocument()
    expect(screen.getByText('@ben')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Add ${ANNA.name} as shepherd` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Add ${BEN.name} as shepherd` })).toBeInTheDocument()
    expect(result).toHaveBeenCalledTimes(1)
  })

  it('sends nothing and shows no results for fewer than 2 characters', async () => {
    const user = userEvent.setup()
    const one = searchMock('a', [ANNA])
    const spaced = searchMock('b', [BEN])
    renderPage([ME_SHEPHERD], [one.mock, spaced.mock])
    const input = await openSearch(user)
    await user.type(input, 'a')
    await new Promise((r) => setTimeout(r, 600))
    await user.clear(input)
    await user.type(input, ' b ')
    await new Promise((r) => setTimeout(r, 600))
    expect(one.result).not.toHaveBeenCalled()
    expect(spaced.result).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /as shepherd$/ })).not.toBeInTheDocument()
    expect(screen.queryByText('No users found.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('leaves out users who already shepherd this person', async () => {
    const user = userEvent.setup()
    const { mock } = searchMock('helper', [ANNA, BEN])
    renderPage([ME_SHEPHERD, ANNA_SHEPHERD], [mock])
    await user.type(await openSearch(user), 'helper')
    expect(
      await screen.findByRole('button', { name: `Add ${BEN.name} as shepherd` }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `Add ${ANNA.name} as shepherd` }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('@anna')).not.toBeInTheDocument()
  })

  it('says "No users found." when the API returns nothing', async () => {
    const user = userEvent.setup()
    const { mock } = searchMock('zzz', [])
    renderPage([ME_SHEPHERD], [mock])
    await user.type(await openSearch(user), 'zzz')
    expect(await screen.findByText('No users found.')).toBeInTheDocument()
  })

  it('says "No users found." when every result is already a shepherd', async () => {
    const user = userEvent.setup()
    const { mock } = searchMock('anna', [ANNA])
    renderPage([ME_SHEPHERD, ANNA_SHEPHERD], [mock])
    await user.type(await openSearch(user), 'anna')
    expect(await screen.findByText('No users found.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add .* as shepherd$/ })).not.toBeInTheDocument()
  })

  it('shows the generic message in an alert when the search fails with INTERNAL', async () => {
    const user = userEvent.setup()
    const mock = failing(G.SearchUsersDocument, { query: 'helper' }, 'db exploded', 'INTERNAL')
    renderPage([ME_SHEPHERD], [mock])
    await user.type(await openSearch(user), 'helper')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(alert).not.toHaveTextContent('db exploded')
  })
})

describe('Adding a shepherd', () => {
  it('sends personId and userId, shows the new shepherd, closes the search and does not refetch', async () => {
    const user = userEvent.setup()
    const search = searchMock('helper', [ANNA, BEN])
    const assign = assignMock(ANNA.id, [ME_SHEPHERD, ANNA_SHEPHERD])
    const { personQuery } = renderPage([ME_SHEPHERD], [search.mock, assign.mock])
    await user.type(await openSearch(user), 'helper')
    await user.click(await screen.findByRole('button', { name: `Add ${ANNA.name} as shepherd` }))

    await waitFor(() => expect(assign.result).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(shepherdsSection().getByText(ANNA.name)).toBeInTheDocument())
    expect(screen.queryByLabelText('Search users')).not.toBeInTheDocument()
    expect(personQuery).toHaveBeenCalledTimes(1)
  })

  it('shows a CONFLICT message in an alert', async () => {
    const user = userEvent.setup()
    const search = searchMock('helper', [ANNA])
    const message = 'User is already assigned to this person'
    const failed = failing(
      G.AssignPersonDocument,
      { personId: PERSON_ID, userId: ANNA.id },
      message,
      'CONFLICT',
    )
    renderPage([ME_SHEPHERD], [search.mock, failed])
    await user.type(await openSearch(user), 'helper')
    await user.click(await screen.findByRole('button', { name: `Add ${ANNA.name} as shepherd` }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(
      screen.queryByRole('button', { name: `Remove ${ANNA.name} as shepherd` }),
    ).not.toBeInTheDocument()
  })
})
