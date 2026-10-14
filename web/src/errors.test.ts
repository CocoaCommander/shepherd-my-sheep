import { ApolloError } from '@apollo/client'
import { GraphQLError } from 'graphql'
import { describe, expect, it } from 'vitest'
import { errorCode, friendlyMessage } from './errors'

function gqlError(code: string | undefined, message = 'server text') {
  return new ApolloError({
    graphQLErrors: [new GraphQLError(message, code ? { extensions: { code } } : undefined)],
  })
}

function networkError(statusCode?: number) {
  const err = Object.assign(new Error('network'), statusCode ? { statusCode } : {})
  return new ApolloError({ networkError: err })
}

const GENERIC = 'Something went wrong. Please try again.'

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
