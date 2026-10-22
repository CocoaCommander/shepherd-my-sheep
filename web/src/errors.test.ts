import { ApolloError } from '@apollo/client'
import { GraphQLError } from 'graphql'
import { describe, expect, it } from 'vitest'
import { errorCode, friendlyMessage } from './errors'

function gqlError(code: string | undefined, message = 'server text') {
  return new ApolloError({
    graphQLErrors: [new GraphQLError(message, code ? { extensions: { code } } : undefined)],
  })
}

/** `result` is the parsed body, as Apollo's ServerError carries it. */
function networkError(statusCode?: number, result?: unknown) {
  const err = Object.assign(
    new Error('network'),
    statusCode ? { statusCode } : {},
    result !== undefined ? { result } : {},
  )
  return new ApolloError({ networkError: err })
}

function rateLimitedBody(message: string, code = 'RATE_LIMITED') {
  return { errors: [{ message, extensions: { code } }] }
}

const GENERIC = 'Something went wrong. Please try again.'
const RATE_LIMITED = 'Too many attempts. Please wait a moment and try again.'

describe('errorCode', () => {
  it('is undefined for no error', () => {
    expect(errorCode(undefined)).toBeUndefined()
  })

  it('reads the code of the first GraphQL error', () => {
    expect(errorCode(gqlError('NOT_FOUND'))).toBe('NOT_FOUND')
  })

  it('is undefined when the error has no code or no GraphQL errors', () => {
    expect(errorCode(gqlError(undefined))).toBeUndefined()
    expect(errorCode(networkError())).toBeUndefined()
  })
})

describe('friendlyMessage', () => {
  it('explains an expired session for HTTP 401', () => {
    expect(friendlyMessage(networkError(401))).toBe(
      'Your session has expired. Please sign in again.',
    )
  })

  it('explains other network errors', () => {
    const msg = "Couldn't reach the server. Check your connection and try again."
    expect(friendlyMessage(networkError())).toBe(msg)
    expect(friendlyMessage(networkError(500))).toBe(msg)
    expect(friendlyMessage(networkError(500, rateLimitedBody('Exactly this')))).toBe(msg)
  })

  it('passes the server message through for HTTP 429 with RATE_LIMITED', () => {
    expect(friendlyMessage(networkError(429, rateLimitedBody('Exactly this')))).toBe('Exactly this')
  })

  it('falls back to the rate-limit message for HTTP 429 without a RATE_LIMITED body', () => {
    expect(friendlyMessage(networkError(429))).toBe(RATE_LIMITED)
    expect(friendlyMessage(networkError(429, 'Too Many Requests'))).toBe(RATE_LIMITED)
    expect(friendlyMessage(networkError(429, { errors: [] }))).toBe(RATE_LIMITED)
    expect(friendlyMessage(networkError(429, rateLimitedBody('secret', 'INTERNAL')))).toBe(
      RATE_LIMITED,
    )
    expect(friendlyMessage(networkError(429, rateLimitedBody('')))).toBe(RATE_LIMITED)
  })

  it('tells the user something changed for NOT_FOUND', () => {
    expect(friendlyMessage(gqlError('NOT_FOUND', 'Person not found'))).toBe(
      'This was changed or removed by someone else.',
    )
  })

  it.each(['BAD_USER_INPUT', 'CONFLICT', 'UNAVAILABLE'])(
    'passes the server message through for %s',
    (code) => {
      expect(friendlyMessage(gqlError(code, 'Exactly this'))).toBe('Exactly this')
    },
  )

  it('hides raw text for INTERNAL, unknown and missing codes', () => {
    expect(friendlyMessage(gqlError('INTERNAL', 'secret'))).toBe(GENERIC)
    expect(friendlyMessage(gqlError('WHATEVER', 'secret'))).toBe(GENERIC)
    expect(friendlyMessage(gqlError(undefined, 'secret'))).toBe(GENERIC)
  })
})
