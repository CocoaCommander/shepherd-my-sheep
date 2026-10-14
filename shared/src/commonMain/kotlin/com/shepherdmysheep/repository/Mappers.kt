package com.shepherdmysheep.repository

import com.shepherdmysheep.graphql.fragment.CommentFields
import com.shepherdmysheep.graphql.fragment.MilestonePersonFields
import com.shepherdmysheep.graphql.fragment.PersonDetail
import com.shepherdmysheep.graphql.fragment.PersonSummary
import com.shepherdmysheep.graphql.fragment.PrayerBurdenFields
import com.shepherdmysheep.graphql.fragment.UserFields
import com.shepherdmysheep.models.Comment
import com.shepherdmysheep.models.Milestone
import com.shepherdmysheep.models.MilestonePerson
import com.shepherdmysheep.models.Person
import com.shepherdmysheep.models.PrayerBurden
import com.shepherdmysheep.models.Status
import com.shepherdmysheep.models.User

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
    lastContactDate = lastContactDate,
    isActive = isActive,
    status = Status(id = status.id, name = status.name),
)

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
    )
}

internal fun PrayerBurdenFields.toModel() = PrayerBurden(
    id = id,
    content = content,
    releasedDate = releasedDate,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

internal fun CommentFields.toModel() = Comment(
    id = id,
    author = author.userFields.toModel(),
    prayerBurdenId = prayerBurden?.id,
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
