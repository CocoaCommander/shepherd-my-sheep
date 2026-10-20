#pragma once

#include "oatpp/core/macro/codegen.hpp"
#include "oatpp/core/Types.hpp"

/**
 * oatpp DTOs — data transfer objects that auto-serialize to/from JSON.
 *
 * Each DTO_FIELD maps to a JSON key. oatpp handles serialization at
 * compile time via macros. Nullable fields use oatpp types directly
 * (String, Int32, etc. are nullable by default in oatpp).
 */

#include OATPP_CODEGEN_BEGIN(DTO)

// ── GraphQL Request/Response ────────────────────────────────

class GraphQLRequest : public oatpp::DTO {
    DTO_INIT(GraphQLRequest, DTO)

    DTO_FIELD(String, query);
    DTO_FIELD(String, operationName);
    DTO_FIELD(oatpp::Any, variables);
};

class GraphQLResponse : public oatpp::DTO {
    DTO_INIT(GraphQLResponse, DTO)

    DTO_FIELD(oatpp::Any, data);
    DTO_FIELD(oatpp::Any, errors);
};

class GraphQLError : public oatpp::DTO {
    DTO_INIT(GraphQLError, DTO)

    DTO_FIELD(String, message);
    DTO_FIELD(oatpp::Fields<String>, extensions);  // e.g. {"code": "UNAUTHENTICATED"}
};

// ── Domain DTOs ─────────────────────────────────────────────
//
// Every object type carries "__typename". Apollo (web and Kotlin) asks
// for it on every selection set and relies on it for cache
// normalisation and fragments; a response without it fails to parse.
//
// The executor does not evaluate selection sets, so a resolver fills
// every field it can. Nested lists the resolver did not load are left
// null — clients must only select them on operations that load them
// (see QueryResolver::resolvePerson).

class StatusDto : public oatpp::DTO {
    DTO_INIT(StatusDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "Status";
    DTO_FIELD(String, id);
    DTO_FIELD(String, name);
};

class MilestoneDto : public oatpp::DTO {
    DTO_INIT(MilestoneDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "Milestone";
    DTO_FIELD(String, id);
    DTO_FIELD(String, name);
    DTO_FIELD(String, description);
};

class UserDto : public oatpp::DTO {
    DTO_INIT(UserDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "User";
    DTO_FIELD(String, id);
    DTO_FIELD(String, name);
    DTO_FIELD(String, username);
    DTO_FIELD(String, createdAt);
    DTO_FIELD(String, updatedAt);
};

/**
 * A Person with only id and name, for places that point at a person without
 * loading them (PersonDto is declared later and embeds burdens itself). The
 * typename and id let clients' caches merge it with the full person.
 */
class PersonRefDto : public oatpp::DTO {
    DTO_INIT(PersonRefDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "Person";
    DTO_FIELD(String, id);
    DTO_FIELD(String, name);
};

class PrayerBurdenDto : public oatpp::DTO {
    DTO_INIT(PrayerBurdenDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "PrayerBurden";
    DTO_FIELD(String, id);
    DTO_FIELD(oatpp::Object<PersonRefDto>, person);  // only set by activePrayerBurdens
    DTO_FIELD(String, content);
    DTO_FIELD(String, releasedDate);  // nullable — null means still active
    DTO_FIELD(String, createdAt);
    DTO_FIELD(String, updatedAt);
};

class CommentDto : public oatpp::DTO {
    DTO_INIT(CommentDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "Comment";
    DTO_FIELD(String, id);
    DTO_FIELD(oatpp::Object<UserDto>, author);
    DTO_FIELD(oatpp::Object<PrayerBurdenDto>, prayerBurden);  // nullable — null means standalone note
    DTO_FIELD(String, contactLogId);  // nullable — set for a note written when logging a contact
    DTO_FIELD(String, content);
    DTO_FIELD(String, createdAt);
    DTO_FIELD(String, updatedAt);
};

class MilestonePersonDto : public oatpp::DTO {
    DTO_INIT(MilestonePersonDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "MilestonePerson";
    DTO_FIELD(String, id);
    DTO_FIELD(oatpp::Object<MilestoneDto>, milestone);
    DTO_FIELD(String, dateAchieved);                // nullable
    DTO_FIELD(String, notes);                       // nullable
    DTO_FIELD(oatpp::Object<UserDto>, recordedBy);  // nullable
    DTO_FIELD(String, createdAt);
};

class ContactLogDto : public oatpp::DTO {
    DTO_INIT(ContactLogDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "ContactLog";
    DTO_FIELD(String, id);
    DTO_FIELD(oatpp::Object<UserDto>, contactedBy);  // nullable
    DTO_FIELD(String, contactedAt);
    DTO_FIELD(Boolean, isFollowUp);
    DTO_FIELD(String, note);  // nullable
    DTO_FIELD(String, createdAt);
};

class PersonDto : public oatpp::DTO {
    DTO_INIT(PersonDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "Person";
    DTO_FIELD(String, id);
    DTO_FIELD(String, name);
    DTO_FIELD(Int32, age);                 // nullable
    DTO_FIELD(Int32, yearMet);             // nullable
    DTO_FIELD(String, lastContactDate);    // nullable; deprecated, date part of lastContactedAt
    DTO_FIELD(String, lastContactedAt);    // nullable
    DTO_FIELD(String, contactDueAt);       // nullable — null when NOT_TRACKED
    DTO_FIELD(String, contactClockStart);  // nullable — null when NOT_TRACKED
    DTO_FIELD(String, contactState);       // ContactState enum value
    DTO_FIELD(Boolean, isActive);
    DTO_FIELD(oatpp::Object<StatusDto>, status);
    DTO_FIELD(String, createdAt);
    DTO_FIELD(String, updatedAt);

    // Summaries, set wherever a person is returned, so list screens don't
    // need the nested lists.
    DTO_FIELD(oatpp::Vector<String>, recordedMilestoneIds);  // Milestone ids, in any order; may be empty
    DTO_FIELD(Int32, activeBurdenCount);
    DTO_FIELD(oatpp::Object<CommentDto>, latestComment);  // nullable — no comments yet

    // Shepherds are loaded everywhere a person is returned; the rest only
    // by the `person` query and mutations returning Person. Each may be
    // empty, never null, when loaded: a new contact has no milestones,
    // burdens or comments.
    DTO_FIELD(oatpp::Vector<oatpp::Object<UserDto>>, shepherds);
    DTO_FIELD(oatpp::Vector<oatpp::Object<MilestonePersonDto>>, milestones);
    DTO_FIELD(oatpp::Vector<oatpp::Object<PrayerBurdenDto>>, prayerBurdens);
    DTO_FIELD(oatpp::Vector<oatpp::Object<CommentDto>>, comments);
    DTO_FIELD(oatpp::Vector<oatpp::Object<ContactLogDto>>, contacts);
};

// ── Auth ────────────────────────────────────────────────────

class AuthPayloadDto : public oatpp::DTO {
    DTO_INIT(AuthPayloadDto, DTO)

    DTO_FIELD(String, typename_, "__typename") = "AuthPayload";
    DTO_FIELD(String, token);
    DTO_FIELD(oatpp::Object<UserDto>, user);
};

// ── Mutation Inputs ─────────────────────────────────────────

class RegisterInput : public oatpp::DTO {
    DTO_INIT(RegisterInput, DTO)

    DTO_FIELD(String, name);
    DTO_FIELD(String, username);
    DTO_FIELD(String, password);
};

class LoginInput : public oatpp::DTO {
    DTO_INIT(LoginInput, DTO)

    DTO_FIELD(String, username);
    DTO_FIELD(String, password);
};

class CreatePersonInput : public oatpp::DTO {
    DTO_INIT(CreatePersonInput, DTO)

    DTO_FIELD(String, name);
    DTO_FIELD(Int32, age);      // nullable
    DTO_FIELD(Int32, yearMet);  // nullable
    DTO_FIELD(String, statusId);
    DTO_FIELD(String, comment);  // nullable — saved as a standalone comment
};

class UpdatePersonInput : public oatpp::DTO {
    DTO_INIT(UpdatePersonInput, DTO)

    DTO_FIELD(String, name);  // nullable — only update if provided
    DTO_FIELD(Int32, age);
    DTO_FIELD(Int32, yearMet);
    DTO_FIELD(String, lastContactDate);  // deprecated — logs a contact on that date
    DTO_FIELD(Boolean, isActive);
    DTO_FIELD(String, statusId);
};

class RecordMilestoneInput : public oatpp::DTO {
    DTO_INIT(RecordMilestoneInput, DTO)

    DTO_FIELD(String, personId);
    DTO_FIELD(String, milestoneId);
    DTO_FIELD(String, dateAchieved);  // nullable
    DTO_FIELD(String, notes);         // nullable
};

class CreatePrayerBurdenInput : public oatpp::DTO {
    DTO_INIT(CreatePrayerBurdenInput, DTO)

    DTO_FIELD(String, personId);
    DTO_FIELD(String, content);
};

class CreateCommentInput : public oatpp::DTO {
    DTO_INIT(CreateCommentInput, DTO)

    DTO_FIELD(String, personId);
    DTO_FIELD(String, prayerBurdenId);  // nullable — null means standalone note
    DTO_FIELD(String, content);
};

class LogContactInput : public oatpp::DTO {
    DTO_INIT(LogContactInput, DTO)

    DTO_FIELD(String, personId);
    DTO_FIELD(String, contactedAt);
    DTO_FIELD(String, note);          // must not be blank
    DTO_FIELD(String, prayerBurden);  // nullable
    DTO_FIELD(Boolean, isFollowUp);   // deprecated — ignored
};

#include OATPP_CODEGEN_END(DTO)
