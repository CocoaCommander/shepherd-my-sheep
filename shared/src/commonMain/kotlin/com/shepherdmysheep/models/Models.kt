package com.shepherdmysheep.models

/**
 * Domain models shared across Android and iOS.
 *
 * These are plain Kotlin data classes — not tied to any
 * framework. Apollo-generated GraphQL types are mapped to
 * these in the repository layer so the UI never depends
 * on the networking library directly.
 */

data class User(
    val id: String,
    val name: String,
    val username: String,
    val createdAt: String,
    val updatedAt: String
)

data class Person(
    val id: String,
    val name: String,
    val age: Int? = null,
    val yearMet: Int? = null,
    val lastContactDate: String? = null,
    val isActive: Boolean,
    val status: Status,
    val shepherds: List<User> = emptyList(),
    val milestones: List<MilestonePerson> = emptyList(),
    val prayerBurdens: List<PrayerBurden> = emptyList(),
    val comments: List<Comment> = emptyList()
)

data class Status(
    val id: String,
    val name: String
)

data class Milestone(
    val id: String,
    val name: String,
    val description: String? = null
)

data class MilestonePerson(
    val id: String,
    val milestone: Milestone,
    val dateAchieved: String? = null,
    val notes: String? = null,
    val recordedBy: User? = null,
    val createdAt: String
)

data class PrayerBurden(
    val id: String,
    val content: String,
    val releasedDate: String? = null,
    val comments: List<Comment> = emptyList(),
    val createdAt: String,
    val updatedAt: String
)

data class Comment(
    val id: String,
    val author: User,
    val prayerBurdenId: String? = null,
    val content: String,
    val createdAt: String,
    val updatedAt: String
)

data class AuthPayload(
    val token: String,
    val user: User
)
