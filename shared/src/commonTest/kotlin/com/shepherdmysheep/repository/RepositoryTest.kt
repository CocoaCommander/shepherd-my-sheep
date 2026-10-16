package com.shepherdmysheep.repository

import com.apollographql.apollo.ApolloClient
import com.apollographql.apollo.api.http.HttpRequest
import com.apollographql.apollo.api.http.HttpResponse
import com.apollographql.apollo.network.http.HttpEngine
import com.shepherdmysheep.network.InMemoryTokenStore
import kotlinx.coroutines.test.runTest
import okio.Buffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Serves canned HTTP responses and records request bodies. */
private class FakeEngine(private val status: Int = 200, private val body: String) : HttpEngine {
    val requestBodies = mutableListOf<String>()

    override suspend fun execute(request: HttpRequest): HttpResponse {
        requestBodies += Buffer().also { request.body?.writeTo(it) }.readUtf8()
        return HttpResponse.Builder(statusCode = status).body(Buffer().writeUtf8(body)).build()
    }

    override fun close() = Unit
}

// The API puts "__typename" on every object (backend/src/models/DTOs.hpp), and
// Apollo needs it to read fragments, so every fixture object carries one.
private fun user(id: String = "u1") =
    """{"__typename":"User","id":"$id","name":"Pat Shepherd","username":"pat","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}"""

private fun comment(id: String, burdenId: String?) = """{"__typename":"Comment","id":"$id","content":"note $id",
 "createdAt":"2026-01-02T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","author":${user()},
 "prayerBurden":${burdenId?.let { """{"__typename":"PrayerBurden","id":"$it"}""" } ?: "null"}}"""

private fun burden(id: String, person: String = "") =
    """{"__typename":"PrayerBurden","id":"$id","content":"burden $id","releasedDate":null,
 "createdAt":"2026-01-03T00:00:00Z","updatedAt":"2026-01-03T00:00:00Z"$person}"""

private const val PERSON_SUMMARY = """"__typename":"Person","id":"p1","name":"Sam Sheep","age":null,"yearMet":null,
 "lastContactDate":null,"isActive":true,"status":{"__typename":"Status","id":"s1","name":"active"}"""

private fun personDetail(milestones: String = "[]", burdens: String = "[]", comments: String = "[]") =
    """{"person":{$PERSON_SUMMARY,"shepherds":[],"milestones":$milestones,
 "prayerBurdens":$burdens,"comments":$comments}}"""

private fun data(json: String) = """{"data":$json}"""

private fun errorBody(code: String?, message: String) = """{"data":null,"errors":[{"message":"$message"
 ${code?.let { ""","extensions":{"code":"$it"}""" } ?: ""}}]}"""

class RepositoryTest {

    private val tokens = InMemoryTokenStore()

    private fun repo(body: String, status: Int = 200, engine: FakeEngine = FakeEngine(status, body)) =
        ApolloShepherdRepository(
            ApolloClient.Builder().serverUrl("http://localhost/graphql").httpEngine(engine).build(),
            tokens,
        )

    // ── Errors ──────────────────────────────────────────────

    @Test
    fun firstGraphQlErrorDecidesTheException() = runTest {
        val body = """{"data":null,"errors":[
          {"message":"gone","extensions":{"code":"NOT_FOUND"}},
          {"message":"other","extensions":{"code":"CONFLICT"}}]}"""
        val e = assertFailsWith<ShepherdException.Api.NotFound> { repo(body).getMyPeople() }
        assertEquals("This was changed or removed by someone else.", e.message)
    }

    @Test
    fun errorCodesMapThroughRepository() = runTest {
        assertFailsWith<ShepherdException.Api.Conflict> { repo(errorBody("CONFLICT", "dup")).getMyPeople() }
        assertFailsWith<ShepherdException.Api.BadInput> { repo(errorBody("BAD_USER_INPUT", "bad")).getMyPeople() }
        assertFailsWith<ShepherdException.Api.Unavailable> { repo(errorBody("UNAVAILABLE", "down")).getMyPeople() }
        assertFailsWith<ShepherdException.Api.Internal> { repo(errorBody("INTERNAL", "boom")).getMyPeople() }
    }

    @Test
    fun errorWithoutCodeIsInternalAndHidesServerText() = runTest {
        val e = assertFailsWith<ShepherdException.Api.Internal> {
            repo(errorBody(null, "stack trace here")).getMyPeople()
        }
        assertEquals("Something went wrong. Please try again.", e.message)
        assertNull(e.code)
    }

    @Test
    fun unknownCodeIsInternal() = runTest {
        val e = assertFailsWith<ShepherdException.Api.Internal> {
            repo(errorBody("TEAPOT", "stack trace here")).getMyPeople()
        }
        assertEquals("TEAPOT", e.code)
    }

    @Test
    fun noDataAndNoErrorsIsInternal() = runTest {
        assertFailsWith<ShepherdException.Api.Internal> { repo("{}").getMyPeople() }
    }

    @Test
    fun unauthorizedClearsTokenAndThrowsNotAuthenticated() = runTest {
        tokens.token = "made-up-token"
        assertFailsWith<ShepherdException.NotAuthenticated> { repo("{}", status = 401).getMyPeople() }
        assertNull(tokens.token)
    }

    @Test
    fun otherHttpFailureIsNetworkAndKeepsToken() = runTest {
        tokens.token = "made-up-token"
        assertFailsWith<ShepherdException.Network> { repo("oops", status = 500).getMyPeople() }
        assertEquals("made-up-token", tokens.token)
    }

    // ── searchUsers ─────────────────────────────────────────

    @Test
    fun searchUsersMapsResults() = runTest {
        val engine = FakeEngine(
            body = data(
                """{"searchUsers":[{"__typename":"User","id":"u1","name":"Pat Shepherd","username":"pat"},
                {"__typename":"User","id":"u2","name":"Lee Shepherd","username":"lee"}]}""",
            ),
        )
        val result = repo("", engine = engine).searchUsers("shep")
        assertEquals(listOf("u1", "u2"), result.map { it.id })
        assertEquals("Pat Shepherd", result[0].name)
        assertEquals("lee", result[1].username)
        assertTrue(engine.requestBodies.single().contains("shep"))
    }

    @Test
    fun searchUsersEmptyResultIsEmptyList() = runTest {
        assertEquals(emptyList(), repo(data("""{"searchUsers":[]}""")).searchUsers("zz"))
    }

    @Test
    fun searchUsersPassesQueryUnchanged() = runTest {
        val engine = FakeEngine(body = data("""{"searchUsers":[]}"""))
        repo("", engine = engine).searchUsers("  a ")
        assertTrue(engine.requestBodies.single().contains("\"  a \""))
    }

    @Test
    fun searchUsersOverlongQueryIsBadInput() = runTest {
        assertFailsWith<ShepherdException.Api.BadInput> {
            repo(errorBody("BAD_USER_INPUT", "too long")).searchUsers("x".repeat(500))
        }
    }

    // ── Prayer list person ──────────────────────────────────

    @Test
    fun activePrayerBurdensFillsPerson() = runTest {
        val withPerson = ""","person":{"__typename":"Person","id":"p1","name":"Sam Sheep"}"""
        val body = data("""{"activePrayerBurdens":[${burden("b1", withPerson)}]}""")
        val result = repo(body).getActivePrayerBurdens()
        assertEquals("p1", result.single().person?.id)
        assertEquals("Sam Sheep", result.single().person?.name)
    }

    @Test
    fun activePrayerBurdensEmptyIsValid() = runTest {
        assertEquals(emptyList(), repo(data("""{"activePrayerBurdens":[]}""")).getActivePrayerBurdens("p1"))
    }

    @Test
    fun createAndReleaseBurdenHaveNoPerson() = runTest {
        val created = repo(data("""{"createPrayerBurden":${burden("b1")}}""")).createPrayerBurden("p1", "text")
        assertNull(created.person)
        val released = repo(data("""{"releasePrayerBurden":${burden("b1")}}""")).releasePrayerBurden("b1")
        assertNull(released.person)
    }

    @Test
    fun getPersonBurdensHaveNoPerson() = runTest {
        val person = repo(data(personDetail(burdens = "[${burden("b1")}]"))).getPerson("p1")
        assertNull(person!!.prayerBurdens.single().person)
    }

    // ── Mappers via getPerson / getMyPeople ─────────────────

    @Test
    fun getMyPeopleEmptyIsEmptyList() = runTest {
        assertEquals(emptyList(), repo(data("""{"myPeople":[]}""")).getMyPeople())
    }

    @Test
    fun personWithNothingMapsToEmptyLists() = runTest {
        val person = repo(data(personDetail())).getPerson("p1")!!
        assertEquals(emptyList(), person.milestones)
        assertEquals(emptyList(), person.prayerBurdens)
        assertEquals(emptyList(), person.comments)
    }

    @Test
    fun burdenWithoutCommentsGetsEmptyList() = runTest {
        val person = repo(data(personDetail(burdens = "[${burden("b1")}]"))).getPerson("p1")!!
        assertEquals(emptyList(), person.prayerBurdens.single().comments)
    }

    @Test
    fun standaloneCommentsStayOnPersonOnly() = runTest {
        val body = data(personDetail(burdens = "[${burden("b1")}]", comments = "[${comment("c1", null)}]"))
        val person = repo(body).getPerson("p1")!!
        assertEquals(listOf("c1"), person.comments.map { it.id })
        assertNull(person.comments.single().prayerBurdenId)
        assertEquals(emptyList(), person.prayerBurdens.single().comments)
    }

    @Test
    fun linkedCommentsAttachToTheirBurdenAndStayOnPerson() = runTest {
        val body = data(
            personDetail(
                burdens = "[${burden("b1")},${burden("b2")}]",
                comments = "[${comment("c1", "b1")},${comment("c2", null)},${comment("c3", "b1")}]",
            ),
        )
        val person = repo(body).getPerson("p1")!!
        assertEquals(listOf("c1", "c2", "c3"), person.comments.map { it.id })
        val (b1, b2) = person.prayerBurdens
        assertEquals(listOf("c1", "c3"), b1.comments.map { it.id })
        assertEquals(emptyList(), b2.comments)
        assertIs<String>(b1.comments.first().prayerBurdenId)
    }
}
