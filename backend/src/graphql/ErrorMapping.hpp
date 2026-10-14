#pragma once

#include <algorithm>
#include <stdexcept>
#include <string>
#include <string_view>

/**
 * What a client is told about a failure: a machine-readable code for
 * `errors[].extensions.code`, and a message safe to show a user.
 *
 * Codes:
 *   NOT_FOUND       the record is gone, or the caller may not touch it
 *   CONFLICT        it already exists (duplicate username, milestone, ...)
 *   BAD_USER_INPUT  the request itself is wrong; the message says how
 *   UNAVAILABLE     the server is busy; retrying may succeed
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
 * become spaces and the length is capped.
 */
inline std::string forLog(std::string_view text, std::size_t maxLength = 300) {
    std::string out;
    out.reserve(std::min(text.size(), maxLength));
    for (char c : text.substr(0, maxLength)) {
        auto u = static_cast<unsigned char>(c);
        out.push_back(u < 0x20 || u == 0x7f ? ' ' : c);
    }
    if (text.size() > maxLength) out += "...";
    return out;
}
