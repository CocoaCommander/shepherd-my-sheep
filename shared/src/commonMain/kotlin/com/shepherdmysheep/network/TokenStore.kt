package com.shepherdmysheep.network

/**
 * Holds the access token returned by login/register.
 *
 * The repository writes it on sign-in and clears it when the server
 * answers 401; AuthorizationInterceptor reads it on every request.
 */
interface TokenStore {
    var token: String?
}

/**
 * Keeps the token for the life of the process only, so the user signs in
 * again after a restart. Swap in a Keychain / EncryptedSharedPreferences
 * backed store per platform to persist it.
 */
class InMemoryTokenStore : TokenStore {
    override var token: String? = null
}
