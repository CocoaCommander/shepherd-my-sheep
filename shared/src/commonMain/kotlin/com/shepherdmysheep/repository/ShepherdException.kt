package com.shepherdmysheep.repository

/** Every failure ShepherdRepository throws. */
sealed class ShepherdException(message: String, cause: Throwable? = null) : Exception(message, cause) {

    /** Missing or expired token. The stored token has been cleared; show the login screen. */
    class NotAuthenticated : ShepherdException("Not authenticated")

    /**
     * The server rejected the request. Every message is safe to show the user.
     * `code` is the raw `errors[].extensions.code` (see backend/src/graphql/ErrorMapping.hpp).
     */
    sealed class Api(message: String, val code: String?) : ShepherdException(message) {

        /** The record is gone, or the caller may not touch it. */
        class NotFound(code: String?) : Api(NOT_FOUND_MESSAGE, code)

        /** It already exists, e.g. a duplicate username or milestone. */
        class Conflict(message: String, code: String?) : Api(message, code)

        /** The request itself is wrong; the message says how. */
        class BadInput(message: String, code: String?) : Api(message, code)

        /** The server is busy; retrying may succeed. */
        class Unavailable(message: String, code: String?) : Api(message, code)

        /** Too many attempts (HTTP 429); waiting a moment and retrying will work. */
        class RateLimited(message: String, code: String?) : Api(message, code)

        /** Anything else. The server's text is not shown. */
        class Internal(code: String?) : Api(GENERIC_MESSAGE, code)
    }

    /**
     * The server could not be reached or sent something unreadable. The message is fixed:
     * Apollo's can carry hosts or response fragments. Log `cause` for the details.
     */
    class Network(cause: Throwable) : ShepherdException(NETWORK_MESSAGE, cause)
}

// Same wording as web/src/errors.ts.
internal const val NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again."
internal const val NOT_FOUND_MESSAGE = "This was changed or removed by someone else."
internal const val GENERIC_MESSAGE = "Something went wrong. Please try again."
internal const val RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a moment and try again."

/**
 * Maps an API error code to its exception. Messages for BAD_USER_INPUT,
 * CONFLICT, UNAVAILABLE and RATE_LIMITED are written for users; anything
 * else is replaced so raw server text never shows.
 */
internal fun apiException(code: String?, serverMessage: String): ShepherdException.Api = when (code) {
    "NOT_FOUND" -> ShepherdException.Api.NotFound(code)
    "CONFLICT" -> ShepherdException.Api.Conflict(serverMessage, code)
    "BAD_USER_INPUT" -> ShepherdException.Api.BadInput(serverMessage, code)
    "UNAVAILABLE" -> ShepherdException.Api.Unavailable(serverMessage, code)
    "RATE_LIMITED" -> ShepherdException.Api.RateLimited(serverMessage, code)
    else -> ShepherdException.Api.Internal(code)
}
