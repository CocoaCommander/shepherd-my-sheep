package com.shepherdmysheep.repository

import com.apollographql.apollo.ApolloClient
import com.apollographql.apollo.api.http.HttpRequest
import com.apollographql.apollo.api.http.HttpResponse
import com.apollographql.apollo.network.http.HttpEngine
import com.shepherdmysheep.models.ContactState
import com.shepherdmysheep.network.InMemoryTokenStore
import kotlinx.coroutines.test.runTest
import okio.Buffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

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

private fun jsonOrNull(value: String?) = value?.let { "\"$it\"" } ?: "null"

private fun comment(id: String, burdenId: String?, contactId: String? = null) =
    """{"__typename":"Comment","id":"$id","content":"note $id",
 "createdAt":"2026-01-02T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","author":${user()},
 "prayerBurden":${burdenId?.let { """{"__typename":"PrayerBurden","id":"$it"}""" } ?: "null"},
 "contactLogId":${jsonOrNull(contactId)}}"""

private fun burden(id: String, person: String = "", released: String? = null) =
    """{"__typename":"PrayerBurden","id":"$id","content":"burden $id","releasedDate":${jsonOrNull(released)},
 "createdAt":"2026-01-03T00:00:00Z","updatedAt":"2026-01-03T00:00:00Z"$person}"""

/** The `person { id name status { id name } }` and `comments` a prayer list burden carries. */
private fun personAndComments(comments: String = "[]", status: String = "active") =
    ""","person":{"__typename":"Person","id":"p1","name":"Sam Sheep",
 "status":{"__typename":"Status","id":"s1","name":"$status"}},"comments":$comments"""

private fun contact(id: String, contactedAt: String, by: String? = user(), isFollowUp: Boolean = false) =
    """{"__typename":"ContactLog","id":"$id","contactedAt":"$contactedAt","isFollowUp":$isFollowUp,
 "createdAt":"2026-01-04T00:00:00Z","contactedBy":${by ?: "null"}}"""

private fun personSummary(
    status: String = "active",
    state: String = "ON_TRACK",
    dueAt: String? = "2026-01-10T00:00:00Z",
    clockStart: String? = "2026-01-03T00:00:00Z",
    lastContactedAt: String? = "2026-01-03T00:00:00Z",
) = """"__typename":"Person","id":"p1","name":"Sam Sheep","age":null,"yearMet":null,"isActive":true,
 "status":{"__typename":"Status","id":"s1","name":"$status"},"contactState":"$state",
 "contactDueAt":${jsonOrNull(dueAt)},"contactClockStart":${jsonOrNull(clockStart)},
 "lastContactedAt":${jsonOrNull(lastContactedAt)},
 "createdAt":"2026-01-01T00:00:00Z""""

/** `field` is the operation's root field: person, logContact, deleteContact… */
private fun personDetail(
    milestones: String = "[]",
    burdens: String = "[]",
    comments: String = "[]",
    contacts: String = "[]",
    summary: String = personSummary(),
    field: String = "person",
) = """{"$field":{$summary,"shepherds":[],"milestones":$milestones,
 "prayerBurdens":$burdens,"comments":$comments,"contacts":$contacts}}"""

private fun data(json: String) = """{"data":$json}"""

/** The JSON variables of a recorded request, so assertions skip the query text. */
private fun variables(body: String) = body.substringAfter("\"variables\":")

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
        val body = data("""{"activePrayerBurdens":[${burden("b1", personAndComments())}]}""")
        val result = repo(body).getActivePrayerBurdens()
        assertEquals("p1", result.single().person?.id)
        assertEquals("Sam Sheep", result.single().person?.name)
        assertEquals("active", result.single().person?.status?.name)
    }

    @Test
    fun activePrayerBurdensKeepCommentsNewestFirst() = runTest {
        val two = "[${comment("c2", "b1")},${comment("c1", "b1")}]"
        val body = data(
            """{"activePrayerBurdens":[${burden(
                "b1",
                personAndComments(two),
            )},${burden("b2", personAndComments())}]}""",
        )
        val (b1, b2) = repo(body).getActivePrayerBurdens()
        assertEquals(listOf("c2", "c1"), b1.comments.map { it.id })
        assertEquals("note c2", b1.comments.first().content)
        assertEquals("u1", b1.comments.first().author.id)
        assertEquals(emptyList(), b2.comments)
    }

    // ── Recently released / unrelease ───────────────────────

    @Test
    fun recentlyReleasedEmptyIsEmptyList() = runTest {
        assertEquals(
            emptyList(),
            repo(data("""{"recentlyReleasedPrayerBurdens":[]}""")).getRecentlyReleasedPrayerBurdens(),
        )
    }

    @Test
    fun recentlyReleasedMapsReleasedDatePersonAndComments() = runTest {
        val extra = personAndComments("[${comment("c1", "b1")}]", status = "inactive")
        val body = data(
            """{"recentlyReleasedPrayerBurdens":[${burden("b1", extra, released = "2026-02-01T00:00:00Z")}]}""",
        )
        val result = repo(body).getRecentlyReleasedPrayerBurdens().single()
        assertEquals("2026-02-01T00:00:00Z", result.releasedDate)
        assertEquals("p1", result.person?.id)
        assertEquals("inactive", result.person?.status?.name)
        assertEquals(listOf("c1"), result.comments.map { it.id })
    }

    @Test
    fun recentlyReleasedSendsPersonIdOnlyWhenGiven() = runTest {
        val body = data("""{"recentlyReleasedPrayerBurdens":[]}""")
        val with = FakeEngine(body = body)
        repo("", engine = with).getRecentlyReleasedPrayerBurdens("p1")
        assertTrue(variables(with.requestBodies.single()).contains(""""personId":"p1""""))

        val without = FakeEngine(body = body)
        repo("", engine = without).getRecentlyReleasedPrayerBurdens()
        // The query text names $personId too, so look for the JSON key.
        assertFalse(variables(without.requestBodies.single()).contains("\"personId\":"))
    }

    @Test
    fun recentlyReleasedErrorsMapThrough() = runTest {
        assertFailsWith<ShepherdException.Api.NotFound> {
            repo(errorBody("NOT_FOUND", "gone")).getRecentlyReleasedPrayerBurdens("p1")
        }
    }

    @Test
    fun unreleaseSendsIdAndClearsReleasedDate() = runTest {
        val engine = FakeEngine(
            body = data("""{"unreleasePrayerBurden":${burden("b1", personAndComments("[${comment("c1", "b1")}]"))}}"""),
        )
        val result = repo("", engine = engine).unreleasePrayerBurden("b1")
        assertTrue(variables(engine.requestBodies.single()).contains(""""id":"b1""""))
        assertNull(result.releasedDate)
        assertEquals("p1", result.person?.id)
        assertEquals("active", result.person?.status?.name)
        assertEquals(listOf("c1"), result.comments.map { it.id })
    }

    @Test
    fun unreleaseMissingBurdenIsNotFound() = runTest {
        assertFailsWith<ShepherdException.Api.NotFound> {
            repo(errorBody("NOT_FOUND", "gone")).unreleasePrayerBurden("b1")
        }
    }

    @Test
    fun activePrayerBurdensEmptyIsValid() = runTest {
        assertEquals(emptyList(), repo(data("""{"activePrayerBurdens":[]}""")).getActivePrayerBurdens("p1"))
    }

    @Test
    fun createBurdenCarriesPersonAndNoComments() = runTest {
        val body = data("""{"createPrayerBurden":${burden("b1", personAndComments())}}""")
        val created = repo(body).createPrayerBurden("p1", "text")
        assertEquals("p1", created.person?.id)
        assertEquals("Sam Sheep", created.person?.name)
        assertEquals("active", created.person?.status?.name)
        assertEquals(emptyList(), created.comments)
    }

    @Test
    fun releaseBurdenCarriesDatePersonAndComments() = runTest {
        val extra = personAndComments("[${comment("c1", "b1")}]")
        val body = data("""{"releasePrayerBurden":${burden("b1", extra, released = "2026-02-01T00:00:00Z")}}""")
        val released = repo(body).releasePrayerBurden("b1")
        assertEquals("2026-02-01T00:00:00Z", released.releasedDate)
        assertEquals("p1", released.person?.id)
        assertEquals("active", released.person?.status?.name)
        assertEquals(listOf("c1"), released.comments.map { it.id })
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

    // ── Contact fields ──────────────────────────────────────

    @Test
    fun contactFieldsMapOnSummaries() = runTest {
        val body = data("""{"myPeople":[{${personSummary(state = "DUE_SOON")}}]}""")
        val person = repo(body).getMyPeople().single()
        assertEquals(ContactState.DUE_SOON, person.contactState)
        assertEquals("2026-01-10T00:00:00Z", person.contactDueAt)
        assertEquals("2026-01-03T00:00:00Z", person.contactClockStart)
        assertEquals("2026-01-03T00:00:00Z", person.lastContactedAt)
        assertEquals("2026-01-01T00:00:00Z", person.createdAt)
        assertEquals(emptyList(), person.contacts)
    }

    @Test
    fun clockStartFromAMoveMapsAsGiven() = runTest {
        // A status move after the last contact restarts the clock; the model keeps both.
        val summary = personSummary(dueAt = "2026-01-12T00:00:00Z", clockStart = "2026-01-05T00:00:00Z")
        val person = repo(data("""{"myPeople":[{$summary}]}""")).getMyPeople().single()
        assertEquals("2026-01-05T00:00:00Z", person.contactClockStart)
        assertEquals("2026-01-03T00:00:00Z", person.lastContactedAt)
    }

    @Test
    fun notTrackedHasNoDueDate() = runTest {
        val summary = personSummary(
            status = "inactive",
            state = "NOT_TRACKED",
            dueAt = null,
            clockStart = null,
            lastContactedAt = null,
        )
        val person = repo(data("""{"myPeople":[{$summary}]}""")).getMyPeople().single()
        assertEquals(ContactState.NOT_TRACKED, person.contactState)
        assertNull(person.contactDueAt)
        assertNull(person.contactClockStart)
        assertNull(person.lastContactedAt)
    }

    @Test
    fun unknownContactStateIsNotTracked() = runTest {
        val body = data("""{"myPeople":[{${personSummary(state = "SNOOZED")}}]}""")
        assertEquals(ContactState.NOT_TRACKED, repo(body).getMyPeople().single().contactState)
    }

    @Test
    fun contactAlertsMapAndMayBeEmpty() = runTest {
        assertEquals(emptyList(), repo(data("""{"contactAlerts":[]}""")).getContactAlerts())
        val body = data("""{"contactAlerts":[{${personSummary(state = "OVERDUE")}}]}""")
        assertEquals(ContactState.OVERDUE, repo(body).getContactAlerts().single().contactState)
    }

    @Test
    fun contactsKeepServerOrderAndContactorIsOptional() = runTest {
        val contacts = "[${contact("k2", "2026-01-03T00:00:00Z", isFollowUp = true)}," +
            "${contact("k1", "2026-01-02T00:00:00Z", by = null)}]"
        val person = repo(data(personDetail(contacts = contacts))).getPerson("p1")!!
        assertEquals(listOf("k2", "k1"), person.contacts.map { it.id })
        val (followUp, imported) = person.contacts
        assertTrue(followUp.isFollowUp)
        assertEquals("u1", followUp.contactedBy?.id)
        assertEquals("2026-01-03T00:00:00Z", followUp.contactedAt)
        assertFalse(imported.isFollowUp)
        assertNull(imported.contactedBy)
    }

    @Test
    fun contactNoteKeepsItsContactId() = runTest {
        val comments = "[${comment("c1", null, contactId = "k1")},${comment("c2", null)}]"
        val person = repo(data(personDetail(comments = comments))).getPerson("p1")!!
        assertEquals(listOf("k1", null), person.comments.map { it.contactLogId })
    }

    // ── logContact / deleteContact ──────────────────────────

    @Test
    fun logContactSendsInputAndMapsPerson() = runTest {
        val engine = FakeEngine(
            body = data(
                personDetail(
                    field = "logContact",
                    contacts = "[${contact("k1", "2026-01-05T12:00:00Z", isFollowUp = true)}]",
                    comments = "[${comment("c1", null, contactId = "k1")}]",
                ),
            ),
        )
        val person = repo("", engine = engine)
            .logContact("p1", Instant.parse("2026-01-05T12:00:00Z"), "Talked about work", "New job")
        val sent = variables(engine.requestBodies.single())
        assertTrue(sent.contains(""""personId":"p1""""), sent)
        assertTrue(sent.contains(""""contactedAt":"2026-01-05T12:00:00Z""""), sent)
        assertTrue(sent.contains(""""note":"Talked about work""""), sent)
        assertTrue(sent.contains(""""prayerBurden":"New job""""), sent)
        assertEquals("k1", person.contacts.single().id)
        assertEquals("k1", person.comments.single().contactLogId)
    }

    @Test
    fun logContactNeverSendsFollowUpOrMissingBurden() = runTest {
        val engine = FakeEngine(body = data(personDetail(field = "logContact")))
        repo("", engine = engine).logContact("p1", Instant.parse("2026-01-05T12:00:00Z"), "Coffee")
        val sent = variables(engine.requestBodies.single())
        assertFalse(sent.contains("isFollowUp"), sent)
        assertFalse(sent.contains("prayerBurden"), sent)
    }

    @Test
    fun logContactBlankNoteIsBadInput() = runTest {
        val e = assertFailsWith<ShepherdException.Api.BadInput> {
            repo(errorBody("BAD_USER_INPUT", "Note must not be blank"))
                .logContact("p1", Instant.parse("2026-01-05T12:00:00Z"), " ")
        }
        assertEquals("Note must not be blank", e.message)
    }

    @Test
    fun logContactForMissingPersonIsNotFound() = runTest {
        assertFailsWith<ShepherdException.Api.NotFound> {
            repo(errorBody("NOT_FOUND", "gone")).logContact("p1", Instant.parse("2026-01-05T12:00:00Z"), "Hi")
        }
    }

    @Test
    fun deleteContactSendsIdAndMapsRevertedPerson() = runTest {
        val summary = personSummary(status = "new contact", state = "OVERDUE", lastContactedAt = null)
        val engine = FakeEngine(body = data(personDetail(field = "deleteContact", summary = summary)))
        val person = repo("", engine = engine).deleteContact("k1")
        assertTrue(variables(engine.requestBodies.single()).contains(""""id":"k1""""))
        assertEquals("new contact", person.status.name)
        assertEquals(ContactState.OVERDUE, person.contactState)
        assertEquals(emptyList(), person.contacts)
        assertEquals(emptyList(), person.comments)
    }

    // ── createPerson comment ────────────────────────────────

    @Test
    fun createPersonSendsCommentOnlyWhenGiven() = runTest {
        val body = data(personDetail(field = "createPerson"))
        val withComment = FakeEngine(body = body)
        repo("", engine = withComment).createPerson("Sam Sheep", "s1", comment = "Met at the cafe")
        assertTrue(variables(withComment.requestBodies.single()).contains(""""comment":"Met at the cafe""""))

        val without = FakeEngine(body = body)
        repo("", engine = without).createPerson("Sam Sheep", "s1")
        assertFalse(variables(without.requestBodies.single()).contains("comment"))
    }
}
