import { ApolloClient, HttpLink, InMemoryCache, from } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'

const STALE_CODES = new Set(['NOT_FOUND', 'CONFLICT'])

interface Options {
  getToken: () => string | null
  /** Called when the server answers 401 — the token is missing, expired or forged. */
  onUnauthenticated: () => void
}

export function createApolloClient({ getToken, onUnauthenticated }: Options) {
  // Read on every request, so signing in takes effect immediately.
  const authLink = setContext((_, { headers }) => {
    const token = getToken()
    return {
      headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers,
    }
  })

  const errorLink = onError(({ networkError, graphQLErrors, operation }) => {
    if (networkError && 'statusCode' in networkError && networkError.statusCode === 401) {
      onUnauthenticated()
    }

    // NOT_FOUND or CONFLICT on a change means the screen is out of date:
    // someone else removed, released or recorded it first. Reload what is
    // shown so the user sees the current state alongside the message.
    const isMutation = operation.query.definitions.some(
      (d) => d.kind === 'OperationDefinition' && d.operation === 'mutation',
    )
    const stale = graphQLErrors?.some((e) => STALE_CODES.has(String(e.extensions?.code)))
    if (isMutation && stale) {
      void client.refetchQueries({ include: 'active' })
    }
  })

  const client = new ApolloClient({
    link: from([errorLink, authLink, new HttpLink({ uri: '/graphql' })]),
    cache: new InMemoryCache(),
  })
  return client
}
