package com.shepherdmysheep.network

import com.apollographql.apollo.api.http.HttpRequest
import com.apollographql.apollo.api.http.HttpResponse
import com.apollographql.apollo.network.http.HttpInterceptor
import com.apollographql.apollo.network.http.HttpInterceptorChain

/**
 * Adds "Authorization: Bearer <token>" when signed in. Requests without
 * a token still go out: login and register don't need one, and the
 * server answers anything else with 401.
 */
class AuthorizationInterceptor(
    private val tokenStore: TokenStore
) : HttpInterceptor {

    override suspend fun intercept(request: HttpRequest, chain: HttpInterceptorChain): HttpResponse {
        val token = tokenStore.token ?: return chain.proceed(request)

        return chain.proceed(
            request.newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
        )
    }
}
