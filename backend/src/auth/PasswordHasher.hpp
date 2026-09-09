#pragma once

#include <sodium.h>

#include <chrono>
#include <semaphore>
#include <stdexcept>
#include <string>

/**
 * Argon2id password hashing, backed by libsodium.
 *
 * Hashing happens here in the application layer, never in PostgreSQL.
 * A pgcrypto crypt() call would put the plaintext password on the wire
 * and leave it in pg_stat_statements and the query log.
 *
 * hash() returns libsodium's self-describing encoded string, which
 * embeds the algorithm and cost parameters. That means the limits below
 * can be raised later and existing rows upgraded on the next successful
 * login — see needsRehash().
 *
 * sodium_init() must have been called before any method here. main()
 * does that as its first statement.
 *
 * ── Concurrency ─────────────────────────────────────────────
 *
 * Argon2 is memory-hard by design, which makes it a denial-of-service
 * surface on our own server: every in-flight hash *or verify* pins
 * MEMLIMIT bytes. Unbounded, a burst of logins would exhaust RAM.
 *
 * So every entry point that does argon2 work takes a Slot first. At most
 * MAX_CONCURRENT_HASHES run at once, capping argon2's total footprint at
 * MAX_CONCURRENT_HASHES * MEMLIMIT (currently 4 x 64 MiB = 256 MiB).
 * Callers past that wait up to ACQUIRE_TIMEOUT and are then turned away,
 * which bounds the wait queue as well as the memory — a sustained flood
 * cannot pile up waiters holding oatpp threads and DB pool connections.
 *
 * This is separate from per-IP/per-username rate limiting, which is what
 * actually protects accounts from credential stuffing. This bound only
 * protects the server's memory.
 */
class PasswordHasher {
public:
    // libsodium's INTERACTIVE preset: argon2id, 64 MiB, 2 passes.
    // Comfortably above the OWASP floor of m=19 MiB, t=2.
    static constexpr unsigned long long OPSLIMIT = crypto_pwhash_OPSLIMIT_INTERACTIVE;
    static constexpr size_t             MEMLIMIT = crypto_pwhash_MEMLIMIT_INTERACTIVE;

    // Raising this raises peak memory by MEMLIMIT per slot.
    static constexpr std::ptrdiff_t MAX_CONCURRENT_HASHES = 4;

    // Long enough to absorb a normal burst, short enough that a flood is
    // rejected before waiters exhaust the connection handler's threads.
    static constexpr std::chrono::milliseconds ACQUIRE_TIMEOUT{250};

    /** Thrown when the server is already at MAX_CONCURRENT_HASHES. */
    class Busy : public std::runtime_error {
    public:
        Busy() : std::runtime_error("Server busy, please retry") {}
    };

    /** Encoded hash, e.g. "$argon2id$v=19$m=65536,t=2,p=1$...". Throws Busy. */
    static std::string hash(const std::string& password) {
        Slot slot;
        return hashUnchecked(password);
    }

    /**
     * Verifies in constant time. Returns false on a malformed stored hash.
     * Throws Busy if no slot frees up in time.
     */
    static bool verify(const std::string& encoded, const std::string& password) {
        Slot slot;
        return verifyUnchecked(encoded, password);
    }

    /**
     * True when a stored hash was produced with weaker limits than the
     * ones above, so it should be rehashed while the plaintext is still
     * in hand.
     *
     * Parses the encoded parameters only — no argon2 work, so no Slot.
     */
    static bool needsRehash(const std::string& encoded) {
        if (encoded.empty() || encoded.size() >= crypto_pwhash_STRBYTES) {
            return true;
        }

        return crypto_pwhash_str_needs_rehash(
                   encoded.c_str(), OPSLIMIT, MEMLIMIT) != 0;
    }

    /**
     * Spends the same CPU and memory a real verify would, then fails.
     *
     * Login calls this when the username does not exist. Without it,
     * an unknown username returns immediately while a known one takes
     * ~100 ms, which tells an attacker exactly which accounts are real.
     *
     * Takes a Slot for the same reason verify() does — and throws the
     * same Busy, so a saturated server cannot be probed for account
     * existence either.
     */
    static void dummyVerify(const std::string& password) {
        Slot slot;
        (void) verifyUnchecked(decoyHash(), password);
    }

private:

    /**
     * RAII permit on the argon2 work pool. Constructor blocks up to
     * ACQUIRE_TIMEOUT and throws Busy rather than waiting forever.
     */
    class Slot {
    public:
        Slot() {
            if (!pool().try_acquire_for(ACQUIRE_TIMEOUT)) {
                throw Busy();
            }
        }
        ~Slot() { pool().release(); }

        Slot(const Slot&) = delete;
        Slot& operator=(const Slot&) = delete;
    };

    static std::counting_semaphore<MAX_CONCURRENT_HASHES>& pool() {
        static std::counting_semaphore<MAX_CONCURRENT_HASHES>
            instance{MAX_CONCURRENT_HASHES};
        return instance;
    }

    // ── Ungated primitives ──────────────────────────────────
    // These do the actual argon2 work. Only ever call them while holding
    // a Slot; std::counting_semaphore is not recursive, so a nested
    // acquire on one thread would deadlock.

    static std::string hashUnchecked(const std::string& password) {
        char encoded[crypto_pwhash_STRBYTES];

        if (crypto_pwhash_str_alg(
                encoded,
                password.c_str(), password.size(),
                OPSLIMIT, MEMLIMIT,
                crypto_pwhash_ALG_ARGON2ID13) != 0) {
            // The only documented failure mode is failing to allocate MEMLIMIT.
            throw std::runtime_error("Password hashing failed (out of memory)");
        }

        return std::string(encoded);
    }

    static bool verifyUnchecked(const std::string& encoded, const std::string& password) {
        if (encoded.empty() || encoded.size() >= crypto_pwhash_STRBYTES) {
            return false;
        }

        return crypto_pwhash_str_verify(
                   encoded.c_str(),
                   password.c_str(), password.size()) == 0;
    }

    /**
     * Hash of a value no user can submit — the leading byte is not
     * representable in a JSON string body. Built once, on first use,
     * by the caller that already holds a Slot.
     */
    static const std::string& decoyHash() {
        static const std::string decoy =
            hashUnchecked(std::string("\x01", 1) + "no-such-account");
        return decoy;
    }
};
