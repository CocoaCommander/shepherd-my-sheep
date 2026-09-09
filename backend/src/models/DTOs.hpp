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
};

// ── Domain DTOs ─────────────────────────────────────────────

class StatusDto : public oatpp::DTO {
    DTO_INIT(StatusDto, DTO)

    DTO_FIELD(String, id);
    DTO_FIELD(String, name);
};

class MilestoneDto : public oatpp::DTO {
    DTO_INIT(MilestoneDto, DTO)

    DTO_FIELD(String, id);
    DTO_FIELD(String, name);
    DTO_FIELD(String, description);
};

class UserDto : public oatpp::DTO {
    DTO_INIT(UserDto, DTO)

    DTO_FIELD(String, id);
    DTO_FIELD(String, name);
    DTO_FIELD(String, username);
    DTO_FIELD(String, createdAt);
    DTO_FIELD(String, updatedAt);
};

class PersonDto : public oatpp::DTO {
    DTO_INIT(PersonDto, DTO)

    DTO_FIELD(String, id);
    DTO_FIELD(String, name);
    DTO_FIELD(Int32,  age);                // nullable
    DTO_FIELD(Int32,  yearMet);            // nullable
    DTO_FIELD(String, lastContactDate);    // nullable
    DTO_FIELD(Boolean, isActive);
    DTO_FIELD(oatpp::Object<StatusDto>, status);
    DTO_FIELD(String, createdAt);
    DTO_FIELD(String, updatedAt);
};

class MilestonePersonDto : public oatpp::DTO {
    DTO_INIT(MilestonePersonDto, DTO)

    DTO_FIELD(String, id);
    DTO_FIELD(oatpp::Object<MilestoneDto>, milestone);
    DTO_FIELD(String, dateAchieved);       // nullable
    DTO_FIELD(String, notes);              // nullable
    DTO_FIELD(oatpp::Object<UserDto>, recordedBy);  // nullable
    DTO_FIELD(String, createdAt);
};

class PrayerBurdenDto : public oatpp::DTO {
    DTO_INIT(PrayerBurdenDto, DTO)

    DTO_FIELD(String, id);
    DTO_FIELD(String, content);
    DTO_FIELD(String, releasedDate);       // nullable — null means still active
    DTO_FIELD(String, createdAt);
    DTO_FIELD(String, updatedAt);
};

class CommentDto : public oatpp::DTO {
    DTO_INIT(CommentDto, DTO)

    DTO_FIELD(String, id);
    DTO_FIELD(oatpp::Object<UserDto>, author);
    DTO_FIELD(String, prayerBurdenId);     // nullable — null means standalone note
    DTO_FIELD(String, content);
    DTO_FIELD(String, createdAt);
    DTO_FIELD(String, updatedAt);
};

// ── Auth ────────────────────────────────────────────────────

class AuthPayloadDto : public oatpp::DTO {
    DTO_INIT(AuthPayloadDto, DTO)

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
    DTO_FIELD(Int32,  age);        // nullable
    DTO_FIELD(Int32,  yearMet);    // nullable
    DTO_FIELD(String, statusId);
};

class UpdatePersonInput : public oatpp::DTO {
    DTO_INIT(UpdatePersonInput, DTO)

    DTO_FIELD(String,  name);              // nullable — only update if provided
    DTO_FIELD(Int32,   age);
    DTO_FIELD(Int32,   yearMet);
    DTO_FIELD(String,  lastContactDate);
    DTO_FIELD(Boolean, isActive);
    DTO_FIELD(String,  statusId);
};

class RecordMilestoneInput : public oatpp::DTO {
    DTO_INIT(RecordMilestoneInput, DTO)

    DTO_FIELD(String, personId);
    DTO_FIELD(String, milestoneId);
    DTO_FIELD(String, dateAchieved);   // nullable
    DTO_FIELD(String, notes);          // nullable
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

#include OATPP_CODEGEN_END(DTO)
