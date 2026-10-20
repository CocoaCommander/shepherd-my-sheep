package com.shepherdmysheep.models

/**
 * Domain models shared across Android and iOS.
 *
 * These are plain Kotlin data classes — not tied to any
 * framework. Apollo-generated GraphQL types are mapped to
 * these in the repository layer so the UI never depends
 * on the networking library directly.
 */

data class User(val id: String, val name: String, val username: String, val createdAt: String, val updatedAt: String)

/** A user as search results show them, without timestamps. */
data class UserSummary(val id: String, val name: String, val username: String)

/** Just enough of a person to label a row on the prayer list, with their status pill. */
data class PersonRef(val id: String, val name: String, val status: Status? = null)

data class Person(
    val id: String,
    val name: String,
    val age: Int? = null,
    val yearMet: Int? = null,
    val isActive: Boolean,
    val status: Status,
    /** Computed by the server (business rule 6). Show it as given; never recompute it. */
    val contactState: ContactState,
    /** Null when contactState is NOT_TRACKED. */
    val contactDueAt: String? = null,
    /**
     * When the current contact window started: the last contact, when the person
     * was added, or a status move. The window is contactDueAt minus this.
     * Null when contactState is NOT_TRACKED.
     */
    val contactClockStart: String? = null,
    /** Null until a contact is logged. */
    val lastContactedAt: String? = null,
    val createdAt: String,
    val shepherds: List<User> = emptyList(),
    val milestones: List<MilestonePerson> = emptyList(),
    val prayerBurdens: List<PrayerBurden> = emptyList(),
    val comments: List<Comment> = emptyList(),
    /** Newest contactedAt first; may be empty. */
    val contacts: List<ContactLog> = emptyList(),
)

/** Due soon is the last 48 hours before an active person's deadline, or the last 24 before a new contact's. */
enum class ContactState { OVERDUE, DUE_SOON, ON_TRACK, NOT_TRACKED }

/**
 * A logged contact. Contacts are ordered by contactedAt, so a back-dated one
 * isn't first: the one just logged is the one with the newest createdAt.
 */
data class ContactLog(
    val id: String,
    /** Null for imported history, or once that user is deleted. */
    val contactedBy: User? = null,
    val contactedAt: String,
    /** True for the contact that followed up a new contact (and moved them to active). */
    val isFollowUp: Boolean,
    val createdAt: String,
)

data class Status(val id: String, val name: String)

data class Milestone(val id: String, val name: String, val description: String? = null)

data class MilestonePerson(
    val id: String,
    val milestone: Milestone,
    val dateAchieved: String? = null,
    val notes: String? = null,
    val recordedBy: User? = null,
    val createdAt: String,
)

data class PrayerBurden(
    val id: String,
    val content: String,
    /** Filled by the prayer-list queries and burden mutations; null under a person's own burdens. */
    val person: PersonRef? = null,
    val releasedDate: String? = null,
    /** Newest first; may be empty. */
    val comments: List<Comment> = emptyList(),
    val createdAt: String,
    val updatedAt: String,
)

data class Comment(
    val id: String,
    val author: User,
    val prayerBurdenId: String? = null,
    /** Set when the note was written by logging that contact; shown as "Logged contact". */
    val contactLogId: String? = null,
    val content: String,
    val createdAt: String,
    val updatedAt: String,
)

data class AuthPayload(val token: String, val user: User)
