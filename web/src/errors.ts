import type { ApolloError } from '@apollo/client'

// The API puts a code on every error (backend/src/graphql/ErrorMapping.hpp).
// Messages for BAD_USER_INPUT, CONFLICT and UNAVAILABLE are written for
// users; anything else is replaced here so raw server text never shows.
// RATE_LIMITED comes with HTTP 429, so Apollo reports it as a network error
// with the parsed body in `result`.

export const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again."
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.'
export const NOT_FOUND_MESSAGE = 'This was changed or removed by someone else.'
export const GENERIC_MESSAGE = 'Something went wrong. Please try again.'
export const RATE_LIMITED_MESSAGE = 'Too many attempts. Please wait a moment and try again.'

const SHOW_SERVER_MESSAGE = new Set(['BAD_USER_INPUT', 'CONFLICT', 'UNAVAILABLE'])

type NetworkError = NonNullable<ApolloError['networkError']>

export function errorCode(error: ApolloError | undefined): string | undefined {
  const code = error?.graphQLErrors[0]?.extensions?.code
  return typeof code === 'string' ? code : undefined
}

/** The message of a RATE_LIMITED error in a 429 body, if there is one. */
function rateLimitedMessage(networkError: NetworkError): string | undefined {
  const result: unknown = 'result' in networkError ? networkError.result : undefined
  const first: unknown =
    typeof result === 'object' &&
    result !== null &&
    'errors' in result &&
    Array.isArray(result.errors)
      ? result.errors[0]
      : undefined
  if (typeof first !== 'object' || first === null) return undefined
  const { message, extensions } = first as { message?: unknown; extensions?: { code?: unknown } }
  return extensions?.code === 'RATE_LIMITED' && typeof message === 'string' && message
    ? message
    : undefined
}

export function friendlyMessage(error: ApolloError): string {
  const { networkError } = error
  if (networkError) {
    const status = 'statusCode' in networkError ? networkError.statusCode : undefined
    if (status === 401) return SESSION_EXPIRED_MESSAGE
    if (status === 429) return rateLimitedMessage(networkError) ?? RATE_LIMITED_MESSAGE
    return NETWORK_MESSAGE
  }

  const code = errorCode(error)
  if (code === 'NOT_FOUND') return NOT_FOUND_MESSAGE
  if (code && SHOW_SERVER_MESSAGE.has(code)) return error.graphQLErrors[0].message
  return GENERIC_MESSAGE
}
