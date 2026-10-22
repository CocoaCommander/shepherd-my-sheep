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

TEST(ForLog, TwoByteCharStraddlingTheCapIsDroppedWhole) {
    EXPECT_EQ(forLog("ab\xc3\xa9"
                     "cd",
                     3),
              "ab...");
}

TEST(ForLog, ThreeByteCharStraddlingTheCapIsDroppedWhole) {
    EXPECT_EQ(forLog("ab\xe2\x9c\x9d"
                     "cd",
                     3),
              "ab...");
    EXPECT_EQ(forLog("ab\xe2\x9c\x9d"
                     "cd",
                     4),
              "ab...");
}

TEST(ForLog, FourByteCharStraddlingTheCapIsDroppedWhole) {
    for (std::size_t cap = 3; cap <= 5; ++cap) {
        EXPECT_EQ(forLog("ab\xf0\x9f\x98\x80"
                         "cd",
                         cap),
                  "ab...")
            << "cap " << cap;
    }
}

TEST(ForLog, MultibyteCharEndingExactlyAtTheCapIsKept) {
    EXPECT_EQ(forLog("a\xc3\xa9"
                     "b",
                     3),
              "a\xc3\xa9...");
}

TEST(ForLog, ZeroMaxLengthGivesOnlyEllipsisForNonemptyText) {
    EXPECT_EQ(forLog("abc", 0), "...");
}

TEST(ForLog, LongRunOfStrayContinuationBytesCutsAtMaxLength) {
    EXPECT_EQ(forLog("a\x80\x80\x80\x80\x80\x80", 5), "a\x80\x80\x80\x80...");
}

TEST(SqlErrorForLog, UniqueViolationDropsDetailWithTheValue) {
    auto out = sqlErrorForLog("23505", "ERROR:  duplicate key value violates unique constraint \"users_username_key\"\n"
                                       "DETAIL:  Key (username)=(bob) already exists.\n");
    EXPECT_EQ(out, "duplicate key value violates unique constraint \"users_username_key\"");
    EXPECT_EQ(out.find("bob"), std::string::npos);
}

TEST(SqlErrorForLog, CheckViolationDropsFailingRow) {
    auto out = sqlErrorForLog("23514",
                              "ERROR:  new row for relation \"person\" violates check constraint \"person_age_check\"\n"
                              "DETAIL:  Failing row contains (1, secret-name, -5).\n");
    EXPECT_EQ(out, "new row for relation \"person\" violates check constraint \"person_age_check\"");
    EXPECT_EQ(out.find("secret"), std::string::npos);
}

TEST(SqlErrorForLog, HintAndContextLinesAreDropped) {
    auto out = sqlErrorForLog("XX000", "ERROR:  boom\nHINT:  try again\nCONTEXT:  PL/pgSQL function f() line 3\n");
    EXPECT_EQ(out, "boom");
}

TEST(SqlErrorForLog, ErrorPrefixIsStripped) {
    EXPECT_EQ(sqlErrorForLog("XX000", "ERROR:  something failed"), "something failed");
}

TEST(SqlErrorForLog, FatalPrefixIsStripped) {
    EXPECT_EQ(sqlErrorForLog("57P01", "FATAL:  terminating connection"), "terminating connection");
}

TEST(SqlErrorForLog, RaisedExceptionKeepsItsMessageAndId) {
    EXPECT_EQ(sqlErrorForLog("P0001", "ERROR:  Person not found: 123e4567-e89b-12d3-a456-426614174000\n"
                                      "CONTEXT:  PL/pgSQL function get_person(uuid) line 5 at RAISE\n"),
              "Person not found: 123e4567-e89b-12d3-a456-426614174000");
}

TEST(SqlErrorForLog, DataExceptionQuotedValueIsMasked) {
    EXPECT_EQ(sqlErrorForLog("22P02", "ERROR:  invalid input syntax for type uuid: \"abc\"\n"),
              "invalid input syntax for type uuid: \"...\"");
}

TEST(SqlErrorForLog, DataExceptionMasksEverythingFromTheFirstQuote) {
    EXPECT_EQ(sqlErrorForLog("22003", "ERROR:  value \"a\"b\" is out of range for type integer"), "value \"...\"");
}

TEST(SqlErrorForLog, DataExceptionValueWithANewlineIsMaskedWhole) {
    // The closing quote lands on the next line; nothing of the value is kept.
    auto out = sqlErrorForLog("22P02", "ERROR:  invalid input syntax for type uuid: \"abc\nxyz\"\n");
    EXPECT_EQ(out, "invalid input syntax for type uuid: \"...\"");
    out = sqlErrorForLog("22P02", "ERROR:  invalid input syntax for type uuid: \"ab\"c\nxyz\"\n");
    EXPECT_EQ(out, "invalid input syntax for type uuid: \"...\"");
}

TEST(SqlErrorForLog, DataExceptionQuoteInDetailDoesNotPullTextUp) {
    auto out = sqlErrorForLog("22P02", "ERROR:  invalid input syntax for type json\n"
                                       "DETAIL:  Token \"secret\" is invalid.\n"
                                       "CONTEXT:  JSON data, line 1: secret\n");
    EXPECT_EQ(out, "invalid input syntax for type json");
}

TEST(SqlErrorForLog, DataExceptionWithOneQuoteMasksToTheEnd) {
    EXPECT_EQ(sqlErrorForLog("22001", "ERROR:  odd \"quote here"), "odd \"...\"");
}

TEST(SqlErrorForLog, DataExceptionWithNoQuoteIsUnchanged) {
    EXPECT_EQ(sqlErrorForLog("22001", "ERROR:  no quotes here"), "no quotes here");
}

TEST(SqlErrorForLog, NonDataExceptionQuotesAreKept) {
    EXPECT_EQ(sqlErrorForLog("42P01", "ERROR:  relation \"nope\" does not exist"), "relation \"nope\" does not exist");
}

TEST(SqlErrorForLog, WorksWithoutANewline) {
    EXPECT_EQ(sqlErrorForLog("XX000", "ERROR:  single line"), "single line");
    EXPECT_EQ(sqlErrorForLog("XX000", "no prefix"), "no prefix");
}

TEST(SqlErrorForLog, LongPrimaryLineIsCapped) {
    EXPECT_EQ(sqlErrorForLog("XX000", "ERROR:  " + std::string(400, 'x')), std::string(300, 'x') + "...");
}

TEST(SqlErrorForLog, EmptyWhatGivesEmptyOutput) {
    EXPECT_EQ(sqlErrorForLog("XX000", ""), "");
}
