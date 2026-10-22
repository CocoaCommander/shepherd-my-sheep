#pragma once

#include <algorithm>
#include <chrono>
#include <stdexcept>
#include <string>
#include <string_view>

/**
 * What a client is told about a failure: a machine-readable code for
 * `errors[].extensions.code`, and a message safe to show a user.
 *
 * Codes:
 *   NOT_FOUND       the record is gone, or the caller may not touch it
 *   CONFLICT        it already exists (duplicate username, milestone, ...),
 *                   or it changed since the client last saw it (undo a move)
 *   BAD_USER_INPUT  the request itself is wrong; the message says how
 *   UNAVAILABLE     the server is busy; retrying may succeed
 *   RATE_LIMITED    too many requests; sent with HTTP 429 and Retry-After
 *   INTERNAL        anything else; details are logged, never sent
 */
struct ClientError {
    std::string code;
    std::string message;
};

inline const char* const INTERNAL_MESSAGE = "Something went wrong, please try again";

/**
 * A request the API rejects, with a message written for the user. Only
 * this type reaches the client as BAD_USER_INPUT: a plain
 * std::invalid_argument may come from a library (pqxx throws them too)
 * and is treated as an internal error instead.
 */
class BadInput : public std::invalid_argument {
public:
    using std::invalid_argument::invalid_argument;
};

/**
 * Over a rate limit (see middleware/RateLimiter.hpp). GraphQLController
 * answers HTTP 429 with Retry-After; the message is written for the user.
 */
class RateLimited : public std::runtime_error {
public:
    RateLimited(std::chrono::steady_clock::duration wait, const std::string& message)
        : std::runtime_error(message), wait(wait) {}

    std::chrono::steady_clock::duration wait;
};

/** The Retry-After value for a wait: whole seconds, rounded up, at least 1. */
inline long long retryAfterSeconds(std::chrono::steady_clock::duration wait) {
    return std::max<long long>(1, std::chrono::ceil<std::chrono::seconds>(wait).count());
}

/**
 * Classifies a Postgres SQLSTATE. Postgres messages name tables,
 * constraints and values, so none of their text reaches the client.
 */
inline ClientError classifySqlState(const std::string& sqlstate) {
    if (sqlstate == "23505") return {"CONFLICT", "That already exists"};

    // Foreign keys point at lookups and people; a missing target means it
    // was deleted or never existed. Every RAISE EXCEPTION in our stored
    // procedures (P0001) is a "not found" for a row the caller named.
    if (sqlstate == "23503" || sqlstate == "P0001") return {"NOT_FOUND", "Not found"};

    if (sqlstate == "22001") return {"BAD_USER_INPUT", "A value is too long"};

    // Class 22 is "data exception": a malformed uuid or date, a number out
    // of range. 23502 and 23514 are NOT NULL and CHECK violations.
    if (sqlstate.rfind("22", 0) == 0 || sqlstate == "23502" || sqlstate == "23514") {
        return {"BAD_USER_INPUT", "Invalid input"};
    }

    return {"INTERNAL", INTERNAL_MESSAGE};
}

/**
 * Makes error text safe for a one-line log entry. Database messages can
 * quote the caller's input, so control characters (newlines, ANSI escapes)
 * become spaces and the length is capped on a character boundary: a UTF-8
 * character that would straddle the cap is dropped whole.
 */
inline std::string forLog(std::string_view text, std::size_t maxLength = 300) {
    std::size_t cut = std::min(text.size(), maxLength);
    if (text.size() > maxLength) {
        // Step back over continuation bytes (10xxxxxx) to the start of the
        // straddling character. A UTF-8 character has at most 3 of them, so
        // stray bytes in invalid input can't pull the cut back further.
        auto isContinuation = [&](std::size_t i) { return (static_cast<unsigned char>(text[i]) & 0xC0) == 0x80; };
        std::size_t back    = 0;
        while (back < 3 && cut - back > 0 && isContinuation(cut - back))
            ++back;
        if (!isContinuation(cut - back)) cut -= back;
    }

    std::string out;
    out.reserve(cut);
    for (char c : text.substr(0, cut)) {
        auto u = static_cast<unsigned char>(c);
        out.push_back(u < 0x20 || u == 0x7f ? ' ' : c);
    }
    if (text.size() > maxLength) out += "...";
    return out;
}

/**
 * A Postgres error message for the log: the primary line only. pqxx 6.4
 * gives only libpq's joined text ("ERROR:  ...\nDETAIL:  ...\nHINT: ..."),
 * and DETAIL quotes data: the duplicate key, or the whole failing row for
 * NOT NULL and CHECK violations. Class 22 (data exception) also quotes the
 * bad value in the primary line, so the line is cut at its first quote.
 * Constraint names and the ids in our own RAISE EXCEPTIONs are kept.
 */
inline std::string sqlErrorForLog(const std::string& sqlstate, std::string_view what) {
    std::string line(what.substr(0, what.find('\n')));

    // Everything from the first quote on goes, not just up to a closing
    // quote: Postgres doesn't escape a '"' or a newline inside the value,
    // so where the value ends can't be told. What's lost is fixed text
    // ("is out of range for type integer") that the SQLSTATE already says.
    if (sqlstate.rfind("22", 0) == 0) {
        auto quote = line.find('"');
        if (quote != std::string::npos) line.replace(quote, std::string::npos, "\"...\"");
    }

    for (std::string_view prefix : {"ERROR:  ", "FATAL:  "}) {
        if (line.rfind(prefix, 0) == 0) {
            line.erase(0, prefix.size());
            break;
        }
    }

    return forLog(line);
}
