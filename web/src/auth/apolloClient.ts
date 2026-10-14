import { ApolloClient, HttpLink, InMemoryCache, from } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'

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

  const errorLink = onError(({ networkError }) => {
    if (networkError && 'statusCode' in networkError && networkError.statusCode === 401) {
      onUnauthenticated()
    }
  })

  return new ApolloClient({
    link: from([errorLink, authLink, new HttpLink({ uri: '/graphql' })]),
    cache: new InMemoryCache(),
  })
}
