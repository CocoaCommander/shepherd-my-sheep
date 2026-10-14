package com.shepherdmysheep.repository

/** Every failure ShepherdRepository throws. */
sealed class ShepherdException(message: String, cause: Throwable? = null) : Exception(message, cause) {

    /** Missing or expired token. The stored token has been cleared; show the login screen. */
    class NotAuthenticated : ShepherdException("Not authenticated")

    /** The server rejected the request, e.g. "Person not found". Safe to show the user. */
    class Api(message: String) : ShepherdException(message)

    /** The server could not be reached or sent something unreadable. */
    class Network(cause: Throwable) : ShepherdException(cause.message ?: "Network error", cause)
}
