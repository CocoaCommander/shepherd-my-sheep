package com.shepherdmysheep.repository

import com.shepherdmysheep.models.*

/**
 * Repository interface — the single source of truth for data operations.
 *
 * Android and iOS both depend on this interface. The implementation
 * uses Apollo Kotlin to call the GraphQL backend. This abstraction
 * makes it possible to swap in a fake for testing.
 */
interface ShepherdRepository {

    // Auth
    suspend fun register(name: String, username: String, password: String): AuthPayload
    suspend fun login(username: String, password: String): AuthPayload

    // People
    suspend fun getMyPeople(): List<Person>
    suspend fun getPerson(id: String): Person?
    suspend fun createPerson(name: String, statusId: String, age: Int? = null, yearMet: Int? = null): Person
    suspend fun updatePerson(id: String, name: String? = null, age: Int? = null, yearMet: Int? = null, lastContactDate: String? = null, isActive: Boolean? = null, statusId: String? = null): Person
    suspend fun deletePerson(id: String): Boolean
    suspend fun assignPerson(personId: String, userId: String): Person
    suspend fun unassignPerson(personId: String, userId: String): Person

    // Lookups
    suspend fun getStatuses(): List<Status>
    suspend fun getMilestones(): List<Milestone>

    // Milestones
    suspend fun recordMilestone(personId: String, milestoneId: String, dateAchieved: String? = null, notes: String? = null): MilestonePerson
    suspend fun removeMilestone(personId: String, milestoneId: String): Boolean

    // Prayer Burdens
    suspend fun getActivePrayerBurdens(personId: String? = null): List<PrayerBurden>
    suspend fun createPrayerBurden(personId: String, content: String): PrayerBurden
    suspend fun releasePrayerBurden(id: String): PrayerBurden

    // Comments
    suspend fun createComment(personId: String, content: String, prayerBurdenId: String? = null): Comment
    suspend fun deleteComment(id: String): Boolean
}
