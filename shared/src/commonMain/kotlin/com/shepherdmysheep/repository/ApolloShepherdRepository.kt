package com.shepherdmysheep.repository

import com.apollographql.apollo.ApolloClient
import com.shepherdmysheep.models.*

/**
 * Apollo-backed implementation of ShepherdRepository.
 *
 * Each method builds an Apollo query/mutation from the generated
 * GraphQL types, executes it, and maps the response to domain models.
 *
 * Apollo Kotlin generates type-safe Kotlin classes from schema.graphql
 * at build time (via the apollo Gradle plugin). Those generated classes
 * live in com.shepherdmysheep.graphql.*.
 */
class ApolloShepherdRepository(
    private val apolloClient: ApolloClient
) : ShepherdRepository {

    // ── Auth ────────────────────────────────────────────────

    override suspend fun register(name: String, username: String, password: String): AuthPayload {
        // Uses generated RegisterMutation from schema.graphql
        TODO("Wire up RegisterMutation once Apollo codegen runs")
    }

    override suspend fun login(username: String, password: String): AuthPayload {
        TODO("Wire up LoginMutation once Apollo codegen runs")
    }

    // ── People ──────────────────────────────────────────────

    override suspend fun getMyPeople(): List<Person> {
        TODO("Wire up MyPeopleQuery once Apollo codegen runs")
    }

    override suspend fun getPerson(id: String): Person? {
        TODO("Wire up PersonQuery once Apollo codegen runs")
    }

    override suspend fun createPerson(name: String, statusId: String, age: Int?, yearMet: Int?): Person {
        TODO("Wire up CreatePersonMutation once Apollo codegen runs")
    }

    override suspend fun updatePerson(id: String, name: String?, age: Int?, yearMet: Int?, lastContactDate: String?, isActive: Boolean?, statusId: String?): Person {
        TODO("Wire up UpdatePersonMutation once Apollo codegen runs")
    }

    override suspend fun deletePerson(id: String): Boolean {
        TODO("Wire up DeletePersonMutation once Apollo codegen runs")
    }

    override suspend fun assignPerson(personId: String, userId: String): Person {
        TODO("Wire up AssignPersonMutation once Apollo codegen runs")
    }

    override suspend fun unassignPerson(personId: String, userId: String): Person {
        TODO("Wire up UnassignPersonMutation once Apollo codegen runs")
    }

    // ── Lookups ─────────────────────────────────────────────

    override suspend fun getStatuses(): List<Status> {
        TODO("Wire up StatusesQuery once Apollo codegen runs")
    }

    override suspend fun getMilestones(): List<Milestone> {
        TODO("Wire up MilestonesQuery once Apollo codegen runs")
    }

    // ── Milestones ──────────────────────────────────────────

    override suspend fun recordMilestone(personId: String, milestoneId: String, dateAchieved: String?, notes: String?): MilestonePerson {
        TODO("Wire up RecordMilestoneMutation once Apollo codegen runs")
    }

    override suspend fun removeMilestone(personId: String, milestoneId: String): Boolean {
        TODO("Wire up RemoveMilestoneMutation once Apollo codegen runs")
    }

    // ── Prayer Burdens ──────────────────────────────────────

    override suspend fun getActivePrayerBurdens(personId: String?): List<PrayerBurden> {
        TODO("Wire up ActivePrayerBurdensQuery once Apollo codegen runs")
    }

    override suspend fun createPrayerBurden(personId: String, content: String): PrayerBurden {
        TODO("Wire up CreatePrayerBurdenMutation once Apollo codegen runs")
    }

    override suspend fun releasePrayerBurden(id: String): PrayerBurden {
        TODO("Wire up ReleasePrayerBurdenMutation once Apollo codegen runs")
    }

    // ── Comments ────────────────────────────────────────────

    override suspend fun createComment(personId: String, content: String, prayerBurdenId: String?): Comment {
        TODO("Wire up CreateCommentMutation once Apollo codegen runs")
    }

    override suspend fun deleteComment(id: String): Boolean {
        TODO("Wire up DeleteCommentMutation once Apollo codegen runs")
    }
}
