#include "graphql/Operation.hpp"

#include <gtest/gtest.h>

using Type = ParsedOperation::Type;

TEST(OperationParser, AnonymousShorthandIsAQuery) {
    auto op = OperationParser::parse("{ statuses { id name } }");
    EXPECT_EQ(op.type, Type::Query);
    EXPECT_EQ(op.field, "statuses");
    EXPECT_EQ(op.responseKey, "statuses");
}

TEST(OperationParser, NamedQueryWithVariables) {
    auto op = OperationParser::parse("query Person($id: UUID!) { person(id: $id) { id name } }");
    EXPECT_EQ(op.type, Type::Query);
    EXPECT_EQ(op.field, "person");
}

TEST(OperationParser, NamedMutation) {
    auto op = OperationParser::parse("mutation Login($input: LoginInput!) { login(input: $input) { token } }");
    EXPECT_EQ(op.type, Type::Mutation);
    EXPECT_EQ(op.field, "login");
}

// Regression: substring matching routed this to assignPerson.
TEST(OperationParser, UnassignIsNotAssign) {
    auto op = OperationParser::parse("mutation Unassign($personId: UUID!, $userId: UUID!) "
                                     "{ unassignPerson(personId: $personId, userId: $userId) { id } }");
    EXPECT_EQ(op.field, "unassignPerson");
}

// Regression: "personId" in the arguments routed this to `person`.
TEST(OperationParser, ArgumentNamesDoNotAffectRouting) {
    auto op =
        OperationParser::parse("query Burdens($personId: UUID) { activePrayerBurdens(personId: $personId) { id } }");
    EXPECT_EQ(op.field, "activePrayerBurdens");
}

// Regression: a nested `person` field routed a milestones query to `person`.
TEST(OperationParser, NestedFieldsDoNotAffectRouting) {
    auto op = OperationParser::parse("query { milestones { id person { id } } }");
    EXPECT_EQ(op.field, "milestones");
}

TEST(OperationParser, AliasBecomesResponseKey) {
    auto op = OperationParser::parse("query { mine: myPeople { id } }");
    EXPECT_EQ(op.field, "myPeople");
    EXPECT_EQ(op.responseKey, "mine");
}

TEST(OperationParser, SkipsCommentsCommasAndWhitespace) {
    auto op = OperationParser::parse("# fetch the caller\n"
                                     "  query Me ,\n"
                                     "  { # root\n"
                                     "    me { id }\n"
                                     "  }");
    EXPECT_EQ(op.field, "me");
}

TEST(OperationParser, DefaultValuesWithBracesAndStrings) {
    auto op = OperationParser::parse(
        "query Q($a: String = \"{ not a selection )\", $b: [Int] = [1, 2]) @live { statuses { id } }");
    EXPECT_EQ(op.field, "statuses");
}

TEST(OperationParser, MutationKeywordInsideAQueryNameIsStillAQuery) {
    auto op = OperationParser::parse("query mutationHistory { me { id } }");
    EXPECT_EQ(op.type, Type::Query);
    EXPECT_EQ(op.field, "me");
}

TEST(OperationParser, RejectsSubscriptions) {
    EXPECT_THROW(OperationParser::parse("subscription { updates }"), std::invalid_argument);
}

TEST(OperationParser, RejectsFragmentFirst) {
    EXPECT_THROW(OperationParser::parse("fragment F on Person { id } query { myPeople { ...F } }"),
                 std::invalid_argument);
}

TEST(OperationParser, RejectsMalformedDocuments) {
    EXPECT_THROW(OperationParser::parse(""), std::invalid_argument);
    EXPECT_THROW(OperationParser::parse("query"), std::invalid_argument);
    EXPECT_THROW(OperationParser::parse("{ }"), std::invalid_argument);
    EXPECT_THROW(OperationParser::parse("query Q($a: String = \"open"), std::invalid_argument);
    EXPECT_THROW(OperationParser::parse("query Q($a: Int { me }"), std::invalid_argument);
}
