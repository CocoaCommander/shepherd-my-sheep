import type { ApolloError } from '@apollo/client'

// The API puts a code on every error (backend/src/graphql/ErrorMapping.hpp).
// Messages for BAD_USER_INPUT, CONFLICT and UNAVAILABLE are written for
// users; anything else is replaced here so raw server text never shows.

export const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again."
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.'
export const NOT_FOUND_MESSAGE = 'This was changed or removed by someone else.'
export const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

const SHOW_SERVER_MESSAGE = new Set(['BAD_USER_INPUT', 'CONFLICT', 'UNAVAILABLE'])

export function errorCode(error: ApolloError | undefined): string | undefined {
  const code = error?.graphQLErrors[0]?.extensions?.code
  return typeof code === 'string' ? code : undefined
}

export function friendlyMessage(error: ApolloError): string {
  const { networkError } = error
  if (networkError) {
    return 'statusCode' in networkError && networkError.statusCode === 401
      ? SESSION_EXPIRED_MESSAGE
      : NETWORK_MESSAGE
  }

  const code = errorCode(error)
  if (code === 'NOT_FOUND') return NOT_FOUND_MESSAGE
  if (code && SHOW_SERVER_MESSAGE.has(code)) return error.graphQLErrors[0].message
  return GENERIC_MESSAGE
}
