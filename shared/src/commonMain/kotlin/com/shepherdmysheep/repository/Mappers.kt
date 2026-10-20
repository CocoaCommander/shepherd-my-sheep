package com.shepherdmysheep.repository

import com.shepherdmysheep.graphql.fragment.CommentFields
import com.shepherdmysheep.graphql.fragment.ContactLogFields
import com.shepherdmysheep.graphql.fragment.MilestonePersonFields
import com.shepherdmysheep.graphql.fragment.PersonDetail
import com.shepherdmysheep.graphql.fragment.PersonSummary
import com.shepherdmysheep.graphql.fragment.PrayerBurdenFields
import com.shepherdmysheep.graphql.fragment.PrayerListBurden
import com.shepherdmysheep.graphql.fragment.UserFields
import com.shepherdmysheep.models.Comment
import com.shepherdmysheep.models.ContactLog
import com.shepherdmysheep.models.ContactState
import com.shepherdmysheep.models.Milestone
import com.shepherdmysheep.models.MilestonePerson
import com.shepherdmysheep.models.Person
import com.shepherdmysheep.models.PersonRef
import com.shepherdmysheep.models.PrayerBurden
import com.shepherdmysheep.models.Status
import com.shepherdmysheep.models.User
import com.shepherdmysheep.graphql.type.ContactState as ApiContactState

// Generated Apollo types → domain models. Kept here so the UI never
// depends on the networking library (see Models.kt).

internal fun UserFields.toModel() = User(
    id = id,
    name = name,
    username = username,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

/** Nested lists stay empty: myPeople does not load them. */
internal fun PersonSummary.toModel() = Person(
    id = id,
    name = name,
    age = age,
    yearMet = yearMet,
    isActive = isActive,
    status = Status(id = status.id, name = status.name),
    contactState = contactState.toModel(),
    contactDueAt = contactDueAt,
    contactClockStart = contactClockStart,
    lastContactedAt = lastContactedAt,
    createdAt = createdAt,
)

internal fun ApiContactState.toModel() = when (this) {
    ApiContactState.OVERDUE -> ContactState.OVERDUE

    ApiContactState.DUE_SOON -> ContactState.DUE_SOON

    ApiContactState.ON_TRACK -> ContactState.ON_TRACK

    ApiContactState.NOT_TRACKED -> ContactState.NOT_TRACKED

    // A state added to the API after this build: show no alert rather than guess one.
    ApiContactState.UNKNOWN__ -> ContactState.NOT_TRACKED
}

internal fun PersonDetail.toModel(): Person {
    val comments = comments.map { it.commentFields.toModel() }

    return personSummary.toModel().copy(
        shepherds = shepherds.map { it.userFields.toModel() },
        milestones = milestones.map { it.milestonePersonFields.toModel() },
        // The API returns comments per person; attach each burden's own.
        prayerBurdens = prayerBurdens.map { burden ->
            burden.prayerBurdenFields.toModel().let { model ->
                model.copy(comments = comments.filter { it.prayerBurdenId == model.id })
            }
        },
        comments = comments,
        contacts = contacts.map { it.contactLogFields.toModel() },
    )
}

internal fun ContactLogFields.toModel() = ContactLog(
    id = id,
    contactedBy = contactedBy?.userFields?.toModel(),
    contactedAt = contactedAt,
    isFollowUp = isFollowUp,
    createdAt = createdAt,
)

internal fun PrayerBurdenFields.toModel() = PrayerBurden(
    id = id,
    content = content,
    releasedDate = releasedDate,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

internal fun PrayerListBurden.toModel() = prayerBurdenFields.toModel().copy(
    person = PersonRef(
        id = person.id,
        name = person.name,
        status = Status(id = person.status.id, name = person.status.name),
    ),
    comments = comments.map { it.commentFields.toModel() },
)

internal fun CommentFields.toModel() = Comment(
    id = id,
    author = author.userFields.toModel(),
    prayerBurdenId = prayerBurden?.id,
    contactLogId = contactLogId,
    content = content,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

internal fun MilestonePersonFields.toModel() = MilestonePerson(
    id = id,
    milestone = Milestone(
        id = milestone.id,
        name = milestone.name,
        description = milestone.description,
    ),
    dateAchieved = dateAchieved,
    notes = notes,
    recordedBy = recordedBy?.userFields?.toModel(),
    createdAt = createdAt,
)
