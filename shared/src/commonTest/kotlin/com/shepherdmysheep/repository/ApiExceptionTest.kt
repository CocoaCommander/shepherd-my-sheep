package com.shepherdmysheep.repository

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs

class ApiExceptionTest {

    private val generic = "Something went wrong. Please try again."

    @Test
    fun notFoundUsesFixedMessage() {
        val e = apiException("NOT_FOUND", "Person abc not found")
        assertIs<ShepherdException.Api.NotFound>(e)
        assertEquals("This was changed or removed by someone else.", e.message)
        assertEquals("NOT_FOUND", e.code)
    }

    @Test
    fun conflictPassesServerMessage() {
        val e = apiException("CONFLICT", "Username is taken")
        assertIs<ShepherdException.Api.Conflict>(e)
        assertEquals("Username is taken", e.message)
        assertEquals("CONFLICT", e.code)
    }

    @Test
    fun badInputPassesServerMessage() {
        val e = apiException("BAD_USER_INPUT", "Query is too long")
        assertIs<ShepherdException.Api.BadInput>(e)
        assertEquals("Query is too long", e.message)
        assertEquals("BAD_USER_INPUT", e.code)
    }

    @Test
    fun unavailablePassesServerMessage() {
        val e = apiException("UNAVAILABLE", "Database is restarting")
        assertIs<ShepherdException.Api.Unavailable>(e)
        assertEquals("Database is restarting", e.message)
        assertEquals("UNAVAILABLE", e.code)
    }

    @Test
    fun internalHidesServerText() {
        val e = apiException("INTERNAL", "pq: relation \"people\" does not exist")
        assertIs<ShepherdException.Api.Internal>(e)
        assertEquals(generic, e.message)
        assertEquals("INTERNAL", e.code)
    }

    @Test
    fun nullCodeIsInternal() {
        val e = apiException(null, "secret detail")
        assertIs<ShepherdException.Api.Internal>(e)
        assertEquals(generic, e.message)
        assertEquals(null, e.code)
    }

    @Test
    fun unknownCodesAreInternalAndKeepRawCode() {
        for (code in listOf("TEAPOT", "", "not_found", "Not_Found", " NOT_FOUND")) {
            val e = apiException(code, "secret detail")
            assertIs<ShepherdException.Api.Internal>(e, "code '$code'")
            assertEquals(generic, e.message)
            assertFalse(e.message.orEmpty().contains("secret"))
            assertEquals(code, e.code)
        }
    }

    @Test
    fun allSubtypesAreApiExceptions() {
        val all = listOf("NOT_FOUND", "CONFLICT", "BAD_USER_INPUT", "UNAVAILABLE", "INTERNAL", null)
            .map { apiException(it, "x") }
        all.forEach { assertIs<ShepherdException.Api>(it) }
        all.forEach { assertIs<ShepherdException>(it) }
    }
}
