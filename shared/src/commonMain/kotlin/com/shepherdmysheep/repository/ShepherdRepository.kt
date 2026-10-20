package com.shepherdmysheep.repository

import com.shepherdmysheep.models.*
import kotlin.time.Instant

/**
 * Repository interface — the single source of truth for data operations.
 *
 * Android and iOS both depend on this interface. The implementation
 * uses Apollo Kotlin to call the GraphQL backend. This abstraction
 * makes it possible to swap in a fake for testing.
 *
 * Every method throws ShepherdException on failure. NotAuthenticated
 * means the session has ended and the UI should return to login.
 */
interface ShepherdRepository {

    // Auth — register and login store the token for later calls.
    suspend fun register(name: String, username: String, password: String): AuthPayload
    suspend fun login(username: String, password: String): AuthPayload
    suspend fun getMe(): User
    fun logout()

    // People — only people assigned to the signed-in user are visible.
    // getMyPeople returns summaries (nested lists empty); getPerson and
    // the single-person mutations return full detail.
    suspend fun getMyPeople(): List<Person>

    /** People who are OVERDUE or DUE_SOON, most urgent first; summaries, may be empty. */
    suspend fun getContactAlerts(): List<Person>
    suspend fun getPerson(id: String): Person?

    /** `comment` is saved as a note on the new person, written by you; null or blank adds none. */
    suspend fun createPerson(
        name: String,
        statusId: String,
        age: Int? = null,
        yearMet: Int? = null,
        comment: String? = null,
    ): Person
    suspend fun updatePerson(
        id: String,
        name: String? = null,
        age: Int? = null,
        yearMet: Int? = null,
        isActive: Boolean? = null,
        statusId: String? = null,
    ): Person
    suspend fun deletePerson(id: String): Boolean
    suspend fun assignPerson(personId: String, userId: String): Person
    suspend fun unassignPerson(personId: String, userId: String): Person

    // Contacts (business rule 6). Logging a contact saves `note` as a note
    // linked to it, and a non-blank `prayerBurden` as a burden linked to it.
    // For a new contact it is their follow-up and moves them to active.
    // `contactedAt` may not be in the future; a blank note is BadInput.
    // Deleting a contact (Undo) also deletes its note and burden, and moves
    // the person back to new contact if it promoted them and they are still
    // active. Both return the person in full.
    suspend fun logContact(personId: String, contactedAt: Instant, note: String, prayerBurden: String? = null): Person
    suspend fun deleteContact(id: String): Person

    // Users — matches name or username, excluding the signed-in user.
    // Queries too short to search return an empty list.
    suspend fun searchUsers(query: String): List<UserSummary>

    // Lookups
    suspend fun getStatuses(): List<Status>
    suspend fun getMilestones(): List<Milestone>

    // Milestones
    suspend fun recordMilestone(
        personId: String,
        milestoneId: String,
        dateAchieved: String? = null,
        notes: String? = null,
    ): MilestonePerson
    suspend fun removeMilestone(personId: String, milestoneId: String): Boolean

    // Prayer Burdens — these all fill PrayerBurden.person (id, name and
    // status) and its comments, newest first; getPerson's burdens have no person.
    suspend fun getActivePrayerBurdens(personId: String? = null): List<PrayerBurden>

    /** The latest 5 releases, of any age, newest release first; may be empty. */
    suspend fun getRecentlyReleasedPrayerBurdens(personId: String? = null): List<PrayerBurden>
    suspend fun createPrayerBurden(personId: String, content: String): PrayerBurden
    suspend fun releasePrayerBurden(id: String): PrayerBurden

    /** Undo of a release, by any shepherd, at any time. NotFound if it isn't released. */
    suspend fun unreleasePrayerBurden(id: String): PrayerBurden

    // Comments
    suspend fun createComment(personId: String, content: String, prayerBurdenId: String? = null): Comment
    suspend fun deleteComment(id: String): Boolean
}
