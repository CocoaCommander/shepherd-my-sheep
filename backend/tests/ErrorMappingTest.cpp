#include "graphql/ErrorMapping.hpp"
#include "graphql/Operation.hpp"

#include <gtest/gtest.h>

#include <stdexcept>
#include <string>

namespace {
void expectMapped(const std::string& sqlstate, const char* code, const char* message) {
    auto e = classifySqlState(sqlstate);
    EXPECT_EQ(e.code, code) << "sqlstate " << sqlstate;
    EXPECT_EQ(e.message, message) << "sqlstate " << sqlstate;
}
}  // namespace

TEST(ErrorMapping, UniqueViolationIsConflict) {
    expectMapped("23505", "CONFLICT", "That already exists");
}

TEST(ErrorMapping, ForeignKeyViolationIsNotFound) {
    expectMapped("23503", "NOT_FOUND", "Not found");
}

TEST(ErrorMapping, RaiseExceptionFromStoredProcedureIsNotFound) {
    expectMapped("P0001", "NOT_FOUND", "Not found");
}

TEST(ErrorMapping, ValueTooLongIsItsOwnMessage) {
    expectMapped("22001", "BAD_USER_INPUT", "A value is too long");
}

TEST(ErrorMapping, OtherDataExceptionsAreInvalidInput) {
    for (const char* s : {"22P02", "22007", "22008", "22003", "22000", "22012"})
        expectMapped(s, "BAD_USER_INPUT", "Invalid input");
}

TEST(ErrorMapping, NotNullAndCheckViolationsAreInvalidInput) {
    expectMapped("23502", "BAD_USER_INPUT", "Invalid input");
    expectMapped("23514", "BAD_USER_INPUT", "Invalid input");
}

TEST(ErrorMapping, EmptySqlStateIsInternal) {
    expectMapped("", "INTERNAL", "Something went wrong, please try again");
}

TEST(ErrorMapping, UnknownSqlStateIsInternal) {
    expectMapped("08006", "INTERNAL", "Something went wrong, please try again");
    expectMapped("42601", "INTERNAL", "Something went wrong, please try again");
}

TEST(BadInput, IsCatchableAsInvalidArgumentWithMessage) {
    try {
        throw BadInput("name is required");
    } catch (const std::invalid_argument& e) {
        EXPECT_STREQ(e.what(), "name is required");
        return;
    }
    FAIL() << "BadInput was not caught as std::invalid_argument";
}

TEST(BadInput, ParseOfEmptyDocumentThrowsBadInput) {
    EXPECT_THROW(OperationParser::parse(""), BadInput);
}

TEST(ForLog, EmptyInputGivesEmptyOutput) {
    EXPECT_EQ(forLog(""), "");
}

TEST(ForLog, PlainTextIsUnchanged) {
    EXPECT_EQ(forLog("hello world"), "hello world");
}

TEST(ForLog, ControlCharactersBecomeSingleSpaces) {
    EXPECT_EQ(forLog("a\nb\rc\td\x1b"
                     "e\x7f"
                     "f"),
              "a b c d e f");
    EXPECT_EQ(forLog("\n\n"), "  ");
}

TEST(ForLog, Utf8MultibyteBytesAreKept) {
    EXPECT_EQ(forLog("caf\xc3\xa9 \xe2\x9c\x9d"), "caf\xc3\xa9 \xe2\x9c\x9d");
}

TEST(ForLog, LongerThanMaxIsTruncatedWithEllipsis) {
    EXPECT_EQ(forLog("abcdefghij", 5), "abcde...");
}

TEST(ForLog, ExactlyMaxLengthHasNoEllipsis) {
    EXPECT_EQ(forLog("abcde", 5), "abcde");
}

TEST(ForLog, DefaultMaxLengthIs300) {
    EXPECT_EQ(forLog(std::string(300, 'x')), std::string(300, 'x'));
    EXPECT_EQ(forLog(std::string(301, 'x')), std::string(300, 'x') + "...");
}

TEST(ForLog, ControlCharactersAreReplacedBeforeTruncationCount) {
    EXPECT_EQ(forLog("a\nbcdef", 3), "a b...");
}
