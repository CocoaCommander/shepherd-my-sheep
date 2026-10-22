#pragma once

#include "../Log.hpp"
#include "../graphql/ErrorMapping.hpp"

#include <arpa/inet.h>

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

/**
 * In-memory rate limits for login, register and searchUsers. One API
 * instance, so nothing is shared between processes, and a restart forgets
 * everything.
 *
 *   login + register  one token bucket per client address, shared by both:
 *                     AUTH_RATE_LIMIT_PER_MINUTE a minute, burst the same
 *   searchUsers       one token bucket per user id: 60 a minute, burst 20
 *   failed logins     per username (see LoginBackoff), so guesses spread
 *                     over many addresses at one account are slowed too
 *
 * Over a limit, the caller gets RateLimited, which GraphQLController turns
 * into HTTP 429 with Retry-After. Nothing queues: a refused request is
 * simply refused. All checks run before any argon2 work.
 *
 * PasswordHasher's slot limit is separate: it only protects the server's
 * memory, while these protect accounts.
 *
 * ── Memory ──────────────────────────────────────────────────
 *
 * Keys come from clients (addresses, usernames), so a flood of distinct
 * ones could grow the maps without end. Each map holds at most maxKeys
 * entries. When a new key arrives at the cap, entries that owe nothing
 * (a full bucket, a forgotten backoff) are dropped first; if that frees
 * less than a tenth of the cap, the entries nearest to owing nothing go
 * until it does. Those may still owe a wait, which they then skip. That only
 * happens under a flood of more than maxKeys distinct keys, and it is
 * better than refusing new keys, which would lock everyone out.
 */

namespace rate_limit {

using Clock     = std::function<std::chrono::steady_clock::time_point()>;
using TimePoint = std::chrono::steady_clock::time_point;
using Duration  = std::chrono::steady_clock::duration;

inline constexpr std::size_t DEFAULT_MAX_KEYS = 100000;

inline TimePoint steadyNow() {
    return std::chrono::steady_clock::now();
}

/**
 * Makes room in `entries` for one more key, as described above. `owesNothing`
 * says whether an entry can go for free; the rest go in order of `age`,
 * smallest first.
 */
template <class Map, class OwesNothing, class Age>
void makeRoom(Map& entries, std::size_t maxKeys, OwesNothing owesNothing, Age age) {
    if (entries.size() < maxKeys) return;

    std::erase_if(entries, [&](const auto& entry) { return owesNothing(entry.second); });

    auto target = maxKeys - std::max<std::size_t>(1, maxKeys / 10);
    if (entries.size() <= target) return;

    std::vector<std::pair<TimePoint, typename Map::key_type>> byAge;
    byAge.reserve(entries.size());
    for (const auto& [key, entry] : entries)
        byAge.emplace_back(age(entry), key);

    auto drop = byAge.size() - target;
    std::nth_element(byAge.begin(), byAge.begin() + static_cast<std::ptrdiff_t>(drop), byAge.end());
    for (std::size_t i = 0; i < drop; ++i)
        entries.erase(byAge[i].second);
}

}  // namespace rate_limit

/**
 * A token bucket per key: it holds up to `capacity` tokens and gains one
 * every `refillEvery`. Each request takes one; with none left it is
 * refused, along with how long until the next token.
 *
 * Each bucket is stored as the time it will next be full (the GCRA form of
 * a token bucket), so the arithmetic is exact and a client that waits the
 * Retry-After it was given gets through.
 */
class TokenBucketLimiter {
public:
    TokenBucketLimiter(int capacity, rate_limit::Duration refillEvery, rate_limit::Clock clock = rate_limit::steadyNow,
                       std::size_t maxKeys = rate_limit::DEFAULT_MAX_KEYS)
        : m_burst(capacity * refillEvery), m_refillEvery(refillEvery), m_clock(std::move(clock)), m_maxKeys(maxKeys) {}

    /** nullopt if allowed (and a token is taken), otherwise the wait until one is free. */
    std::optional<rate_limit::Duration> take(const std::string& key) {
        std::lock_guard lock(m_mutex);
        auto            now = m_clock();

        auto it = m_fullAt.find(key);
        if (it == m_fullAt.end()) {
            rate_limit::makeRoom(
                m_fullAt, m_maxKeys, [&](rate_limit::TimePoint fullAt) { return fullAt <= now; },
                [](rate_limit::TimePoint fullAt) { return fullAt; });
            it = m_fullAt.emplace(key, now).first;
        }

        // Taking a token pushes the full time one refill later; it may be
        // at most `capacity` refills away.
        auto ifTaken = std::max(it->second, now) + m_refillEvery;
        if (ifTaken - now <= m_burst) {
            it->second = ifTaken;
            return std::nullopt;
        }
        return ifTaken - now - m_burst;
    }

    std::size_t size() const {
        std::lock_guard lock(m_mutex);
        return m_fullAt.size();
    }

private:
    rate_limit::Duration                                   m_burst;
    rate_limit::Duration                                   m_refillEvery;
    rate_limit::Clock                                      m_clock;
    std::size_t                                            m_maxKeys;
    mutable std::mutex                                     m_mutex;
    std::unordered_map<std::string, rate_limit::TimePoint> m_fullAt;
};

/**
 * Failed logins per username. The first `freeFailures` cost nothing; after
 * that each failure blocks the username for `firstDelay`, doubling with
 * every further failure up to `maxDelay`. While blocked, every login for
 * the username is refused, even with the right password, or the block
 * would do nothing. A success, or `forgetAfter` with no failures, starts
 * the count again.
 *
 * Usernames that don't exist are counted the same way, so the replies
 * never tell the two apart. Usernames are case-sensitive, so the key is
 * the exact string.
 */
class LoginBackoff {
public:
    LoginBackoff(int freeFailures = 5, rate_limit::Duration firstDelay = std::chrono::seconds(1),
                 rate_limit::Duration maxDelay    = std::chrono::minutes(15),
                 rate_limit::Duration forgetAfter = std::chrono::minutes(15),
                 rate_limit::Clock clock = rate_limit::steadyNow, std::size_t maxKeys = rate_limit::DEFAULT_MAX_KEYS)
        : m_freeFailures(freeFailures), m_firstDelay(firstDelay), m_maxDelay(maxDelay), m_forgetAfter(forgetAfter),
          m_clock(std::move(clock)), m_maxKeys(maxKeys) {}

    /** The wait left before this username may try again, if any. */
    std::optional<rate_limit::Duration> check(const std::string& username) {
        std::lock_guard lock(m_mutex);
        auto            now = m_clock();

        auto it = m_entries.find(username);
        if (it == m_entries.end()) return std::nullopt;
        if (owesNothing(it->second, now)) {
            m_entries.erase(it);
            return std::nullopt;
        }
        if (now < it->second.blockedUntil) return it->second.blockedUntil - now;
        return std::nullopt;
    }

    void recordFailure(const std::string& username) {
        std::lock_guard lock(m_mutex);
        auto            now = m_clock();

        auto it = m_entries.find(username);
        if (it == m_entries.end()) {
            rate_limit::makeRoom(
                m_entries, m_maxKeys, [&](const Entry& e) { return owesNothing(e, now); },
                [](const Entry& e) { return e.blockedUntil; });
            it = m_entries.emplace(username, Entry{}).first;
        } else if (owesNothing(it->second, now)) {
            it->second = Entry{};
        }

        auto& entry       = it->second;
        entry.failures    = entry.failures + 1;
        entry.lastFailure = now;
        if (entry.failures >= m_freeFailures) {
            entry.blockedUntil = now + delayAfter(entry.failures - m_freeFailures);
        }
    }

    void recordSuccess(const std::string& username) {
        std::lock_guard lock(m_mutex);
        m_entries.erase(username);
    }

    std::size_t size() const {
        std::lock_guard lock(m_mutex);
        return m_entries.size();
    }

private:
    struct Entry {
        int                   failures = 0;
        rate_limit::TimePoint lastFailure{};
        rate_limit::TimePoint blockedUntil{};
    };

    /** Not blocked, and quiet long enough to forget. */
    bool owesNothing(const Entry& entry, rate_limit::TimePoint now) const {
        return now >= entry.blockedUntil && now - entry.lastFailure >= m_forgetAfter;
    }

    /** firstDelay doubled `extra` times, capped at maxDelay. */
    rate_limit::Duration delayAfter(int extra) const {
        auto delay = m_firstDelay;
        for (int i = 0; i < extra && delay < m_maxDelay; ++i)
            delay *= 2;
        return std::min(delay, m_maxDelay);
    }

    int                                    m_freeFailures;
    rate_limit::Duration                   m_firstDelay;
    rate_limit::Duration                   m_maxDelay;
    rate_limit::Duration                   m_forgetAfter;
    rate_limit::Clock                      m_clock;
    std::size_t                            m_maxKeys;
    mutable std::mutex                     m_mutex;
    std::unordered_map<std::string, Entry> m_entries;
};

/**
 * The key for a client address: IPv4 as it is, IPv6 cut to its /64. One
 * IPv6 host usually holds a whole /64, so keying by full address would let
 * it pick a fresh key per request. Anything that doesn't parse is used as
 * it is.
 *
 * The address is the TCP peer (see ClientAddress.hpp, which also says what
 * a proxy in front would need).
 */
inline std::string addressKey(const std::string& address) {
    if (address.find(':') == std::string::npos) return address;

    auto            host = address.substr(0, address.find('%'));  // drop a zone id (fe80::1%eth0)
    struct in6_addr parsed{};
    if (inet_pton(AF_INET6, host.c_str(), &parsed) != 1) return address;

    std::fill(parsed.s6_addr + 8, parsed.s6_addr + 16, 0);
    char text[INET6_ADDRSTRLEN];
    if (!inet_ntop(AF_INET6, &parsed, text, sizeof text)) return address;
    return std::string(text) + "/64";
}

inline const char* const AUTH_RATE_LIMIT_MESSAGE   = "Too many attempts. Please wait a moment and try again.";
inline const char* const SEARCH_RATE_LIMIT_MESSAGE = "Too many searches. Please wait a moment and try again.";

/**
 * Every limit the API applies, with the messages it sends. Each check
 * throws RateLimited when over.
 */
class RateLimits {
public:
    static constexpr int SEARCH_PER_MINUTE = 60;
    static constexpr int SEARCH_BURST      = 20;

    explicit RateLimits(int authPerMinute, const rate_limit::Clock& clock = rate_limit::steadyNow)
        : m_authPerAddress(authPerMinute, rate_limit::Duration(std::chrono::minutes(1)) / authPerMinute, clock),
          m_searchPerUser(SEARCH_BURST, rate_limit::Duration(std::chrono::minutes(1)) / SEARCH_PER_MINUTE, clock),
          m_loginBackoff(5, std::chrono::seconds(1), std::chrono::minutes(15), std::chrono::minutes(15), clock) {}

    /**
     * Login and register, per client address. An "unknown" address (only
     * if main.cpp stops using extended connections) skips this limit
     * rather than putting every such client in one bucket, where one could
     * lock out the rest; it is logged so it doesn't go unnoticed.
     */
    void checkAuth(const std::string& address, const std::string& field) {
        if (address == "unknown") {
            Log::warn("No client address for " + forLog(field, 32) + "; per-address rate limit skipped");
            return;
        }
        if (auto wait = m_authPerAddress.take(addressKey(address))) throw RateLimited(*wait, AUTH_RATE_LIMIT_MESSAGE);
    }

    void checkSearch(const std::string& userId) {
        if (auto wait = m_searchPerUser.take(userId)) throw RateLimited(*wait, SEARCH_RATE_LIMIT_MESSAGE);
    }

    /**
     * Usernames are at most 50 characters (V001), so a longer one doesn't
     * exist and cutting it shares a key only with other made-up names. It
     * keeps a flood of huge usernames from filling memory by size rather
     * than count.
     */
    static constexpr std::size_t MAX_USERNAME_KEY = 64;

    /** Before looking the username up, so a blocked one costs no argon2 work. */
    void checkLogin(const std::string& username) {
        if (auto wait = m_loginBackoff.check(usernameKey(username))) throw RateLimited(*wait, AUTH_RATE_LIMIT_MESSAGE);
    }

    void loginFailed(const std::string& username) {
        m_loginBackoff.recordFailure(usernameKey(username));
    }

    void loginSucceeded(const std::string& username) {
        m_loginBackoff.recordSuccess(usernameKey(username));
    }

private:
    static std::string usernameKey(const std::string& username) {
        return username.substr(0, MAX_USERNAME_KEY);
    }

    TokenBucketLimiter m_authPerAddress;
    TokenBucketLimiter m_searchPerUser;
    LoginBackoff       m_loginBackoff;
};
