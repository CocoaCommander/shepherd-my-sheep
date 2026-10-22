package com.shepherdmysheep.network

import com.apollographql.apollo.ApolloClient

/**
 * The one ApolloClient both apps use. `serverUrl` is the full GraphQL
 * endpoint, e.g. "http://10.0.2.2:8080/graphql" from the Android
 * emulator.
 *
 * Error bodies are kept so a 429 can show the server's message;
 * ApolloShepherdRepository closes them.
 */
fun createApolloClient(serverUrl: String, tokenStore: TokenStore): ApolloClient = ApolloClient.Builder()
    .serverUrl(serverUrl)
    .addHttpInterceptor(AuthorizationInterceptor(tokenStore))
    .httpExposeErrorBody(true)
    .build()
