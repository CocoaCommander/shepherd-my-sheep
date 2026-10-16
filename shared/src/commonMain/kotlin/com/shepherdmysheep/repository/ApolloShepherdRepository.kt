package com.shepherdmysheep.repository

import com.apollographql.apollo.ApolloCall
import com.apollographql.apollo.ApolloClient
import com.apollographql.apollo.api.Operation
import com.apollographql.apollo.api.Optional
import com.apollographql.apollo.exception.ApolloHttpException
import com.shepherdmysheep.graphql.*
import com.shepherdmysheep.graphql.type.CreateCommentInput
import com.shepherdmysheep.graphql.type.CreatePersonInput
import com.shepherdmysheep.graphql.type.CreatePrayerBurdenInput
import com.shepherdmysheep.graphql.type.LoginInput
import com.shepherdmysheep.graphql.type.RecordMilestoneInput
import com.shepherdmysheep.graphql.type.RegisterInput
import com.shepherdmysheep.graphql.type.UpdatePersonInput
import com.shepherdmysheep.models.*
import com.shepherdmysheep.network.TokenStore

/**
 * Apollo-backed implementation of ShepherdRepository.
 *
 * Each method builds an Apollo query/mutation from the generated
 * GraphQL types, executes it, and maps the response to domain models.
 *
 * Apollo Kotlin generates type-safe Kotlin classes from the operations
 * in src/commonMain/graphql at build time (via the apollo Gradle
 * plugin). Those generated classes live in com.shepherdmysheep.graphql.*.
 *
 * `apolloClient` must send the token from `tokenStore` — build it with
 * createApolloClient().
 */
class ApolloShepherdRepository(private val apolloClient: ApolloClient, private val tokenStore: TokenStore) :
    ShepherdRepository {

    // ── Auth ────────────────────────────────────────────────

    override suspend fun register(name: String, username: String, password: String): AuthPayload {
        val result = execute(
            apolloClient.mutation(
                RegisterMutation(RegisterInput(name = name, username = username, password = password)),
            ),
        ).register
        tokenStore.token = result.token
        return AuthPayload(token = result.token, user = result.user.userFields.toModel())
    }

    override suspend fun login(username: String, password: String): AuthPayload {
        val result = execute(
            apolloClient.mutation(LoginMutation(LoginInput(username = username, password = password))),
        ).login
        tokenStore.token = result.token
        return AuthPayload(token = result.token, user = result.user.userFields.toModel())
    }

    override suspend fun getMe(): User = execute(apolloClient.query(MeQuery())).me.userFields.toModel()

    override fun logout() {
        tokenStore.token = null
    }

    // ── People ──────────────────────────────────────────────

    override suspend fun getMyPeople(): List<Person> =
        execute(apolloClient.query(MyPeopleQuery())).myPeople.map { it.personSummary.toModel() }

    override suspend fun getPerson(id: String): Person? =
        execute(apolloClient.query(PersonQuery(id = id))).person?.personDetail?.toModel()

    override suspend fun createPerson(name: String, statusId: String, age: Int?, yearMet: Int?): Person {
        val input = CreatePersonInput(
            name = name,
            statusId = statusId,
            age = Optional.presentIfNotNull(age),
            yearMet = Optional.presentIfNotNull(yearMet),
        )
        return execute(apolloClient.mutation(CreatePersonMutation(input))).createPerson.personDetail.toModel()
    }

    /** Null arguments are left unchanged on the server. */
    override suspend fun updatePerson(
        id: String,
        name: String?,
        age: Int?,
        yearMet: Int?,
        lastContactDate: String?,
        isActive: Boolean?,
        statusId: String?,
    ): Person {
        val input = UpdatePersonInput(
            name = Optional.presentIfNotNull(name),
            age = Optional.presentIfNotNull(age),
            yearMet = Optional.presentIfNotNull(yearMet),
            lastContactDate = Optional.presentIfNotNull(lastContactDate),
            isActive = Optional.presentIfNotNull(isActive),
            statusId = Optional.presentIfNotNull(statusId),
        )
        return execute(
            apolloClient.mutation(UpdatePersonMutation(id = id, input = input)),
        ).updatePerson.personDetail.toModel()
    }

    override suspend fun deletePerson(id: String): Boolean =
        execute(apolloClient.mutation(DeletePersonMutation(id = id))).deletePerson

    override suspend fun assignPerson(personId: String, userId: String): Person =
        execute(apolloClient.mutation(AssignPersonMutation(personId = personId, userId = userId)))
            .assignPerson.personDetail.toModel()

    override suspend fun unassignPerson(personId: String, userId: String): Person =
        execute(apolloClient.mutation(UnassignPersonMutation(personId = personId, userId = userId)))
            .unassignPerson.personDetail.toModel()

    // ── Users ───────────────────────────────────────────────

    override suspend fun searchUsers(query: String): List<UserSummary> =
        execute(apolloClient.query(SearchUsersQuery(query = query))).searchUsers.map {
            UserSummary(id = it.id, name = it.name, username = it.username)
        }

    // ── Lookups ─────────────────────────────────────────────

    override suspend fun getStatuses(): List<Status> =
        execute(apolloClient.query(StatusesQuery())).statuses.map { Status(id = it.id, name = it.name) }

    override suspend fun getMilestones(): List<Milestone> =
        execute(apolloClient.query(MilestonesQuery())).milestones.map {
            Milestone(id = it.id, name = it.name, description = it.description)
        }

    // ── Milestones ──────────────────────────────────────────

    override suspend fun recordMilestone(
        personId: String,
        milestoneId: String,
        dateAchieved: String?,
        notes: String?,
    ): MilestonePerson {
        val input = RecordMilestoneInput(
            personId = personId,
            milestoneId = milestoneId,
            dateAchieved = Optional.presentIfNotNull(dateAchieved),
            notes = Optional.presentIfNotNull(notes),
        )
        return execute(
            apolloClient.mutation(RecordMilestoneMutation(input)),
        ).recordMilestone.milestonePersonFields.toModel()
    }

    override suspend fun removeMilestone(personId: String, milestoneId: String): Boolean = execute(
        apolloClient.mutation(RemoveMilestoneMutation(personId = personId, milestoneId = milestoneId)),
    ).removeMilestone

    // ── Prayer Burdens ──────────────────────────────────────

    override suspend fun getActivePrayerBurdens(personId: String?): List<PrayerBurden> =
        execute(apolloClient.query(ActivePrayerBurdensQuery(personId = Optional.presentIfNotNull(personId))))
            .activePrayerBurdens.map {
                it.prayerBurdenFields.toModel().copy(person = PersonRef(id = it.person.id, name = it.person.name))
            }

    override suspend fun createPrayerBurden(personId: String, content: String): PrayerBurden = execute(
        apolloClient.mutation(
            CreatePrayerBurdenMutation(CreatePrayerBurdenInput(personId = personId, content = content)),
        ),
    )
        .createPrayerBurden.prayerBurdenFields.toModel()

    override suspend fun releasePrayerBurden(id: String): PrayerBurden =
        execute(apolloClient.mutation(ReleasePrayerBurdenMutation(id = id)))
            .releasePrayerBurden.prayerBurdenFields.toModel()

    // ── Comments ────────────────────────────────────────────

    override suspend fun createComment(personId: String, content: String, prayerBurdenId: String?): Comment {
        val input = CreateCommentInput(
            personId = personId,
            content = content,
            prayerBurdenId = Optional.presentIfNotNull(prayerBurdenId),
        )
        return execute(apolloClient.mutation(CreateCommentMutation(input))).createComment.commentFields.toModel()
    }

    override suspend fun deleteComment(id: String): Boolean =
        execute(apolloClient.mutation(DeleteCommentMutation(id = id))).deleteComment

    // ── Execution ───────────────────────────────────────────

    /**
     * Apollo reports failures on the response rather than throwing; this
     * turns them into ShepherdException. A 401 also clears the token so
     * the app knows it is signed out.
     */
    private suspend fun <D : Operation.Data> execute(call: ApolloCall<D>): D {
        val response = call.execute()

        when (val exception = response.exception) {
            null -> Unit

            is ApolloHttpException ->
                if (exception.statusCode == 401) {
                    tokenStore.token = null
                    throw ShepherdException.NotAuthenticated()
                } else {
                    throw ShepherdException.Network(exception)
                }

            else -> throw ShepherdException.Network(exception)
        }

        response.errors?.firstOrNull()?.let { throw apiException(it.extensions?.get("code") as? String, it.message) }
        return response.data ?: throw apiException(null, "Empty response")
    }
}
