import { gql } from '@apollo/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApolloClient } from './apolloClient'

const QUERY = gql`
  query Statuses {
    statuses {
      id
    }
  }
`
const MUTATION = gql`
  mutation Poke {
    poke
  }
`

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Answers the query normally and the mutation with the given response.
function stubFetch(mutationResponse: () => Response) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { operationName } = JSON.parse(String(init?.body))
    if (operationName === 'Poke') return mutationResponse()
    return jsonResponse({ data: { statuses: [{ __typename: 'Status', id: '1' }] } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function queryCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(
    ([, init]) => JSON.parse(String(init?.body)).operationName === 'Statuses',
  ).length
}

async function watchThenMutate(
  fetchMock: ReturnType<typeof stubFetch>,
  onUnauthenticated = vi.fn(),
) {
  const client = createApolloClient({ getToken: () => 'tok', onUnauthenticated })
  const sub = client.watchQuery({ query: QUERY }).subscribe({})
  await vi.waitFor(() => expect(queryCalls(fetchMock)).toBe(1))
  await client.mutate({ mutation: MUTATION, errorPolicy: 'all' }).catch(() => {})
  return { sub, onUnauthenticated }
}

afterEach(() => vi.unstubAllGlobals())

const errorBody = (code: string) => ({
  data: null,
  errors: [{ message: 'Nope', extensions: { code } }],
})

describe('createApolloClient', () => {
  it.each(['NOT_FOUND', 'CONFLICT'])(
    'refetches active queries after a %s mutation error',
    async (code) => {
      const fetchMock = stubFetch(() => jsonResponse(errorBody(code)))
      const { sub } = await watchThenMutate(fetchMock)
      await vi.waitFor(() => expect(queryCalls(fetchMock)).toBe(2))
      sub.unsubscribe()
    },
  )

  it('does not refetch after a BAD_USER_INPUT mutation error', async () => {
    const fetchMock = stubFetch(() => jsonResponse(errorBody('BAD_USER_INPUT')))
    const { sub } = await watchThenMutate(fetchMock)
    await new Promise((r) => setTimeout(r, 100))
    expect(queryCalls(fetchMock)).toBe(1)
    sub.unsubscribe()
  })

  it('calls onUnauthenticated on a 401', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ errors: [{ message: 'x', extensions: { code: 'UNAUTHENTICATED' } }] }, 401),
    )
    const { sub, onUnauthenticated } = await watchThenMutate(fetchMock)
    expect(onUnauthenticated).toHaveBeenCalled()
    sub.unsubscribe()
  })
})
