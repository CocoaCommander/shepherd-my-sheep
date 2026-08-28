#pragma once

#include <sodium.h>

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
 */
class PasswordHasher {
public:
    // libsodium's INTERACTIVE preset: argon2id, 64 MiB, 2 passes.
    // Comfortably above the OWASP floor of m=19 MiB, t=2.
    //
    // NOTE: memory cost is per concurrent hash. Raising MEMLIMIT also
    // raises the memory a burst of logins can pin at once.
    static constexpr unsigned long long OPSLIMIT = crypto_pwhash_OPSLIMIT_INTERACTIVE;
    static constexpr size_t             MEMLIMIT = crypto_pwhash_MEMLIMIT_INTERACTIVE;

    /** Encoded hash, e.g. "$argon2id$v=19$m=65536,t=2,p=1$...". */
    static std::string hash(const std::string& password) {
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

    /** Verifies in constant time. Returns false on a malformed stored hash. */
    static bool verify(const std::string& encoded, const std::string& password) {
        if (encoded.empty() || encoded.size() >= crypto_pwhash_STRBYTES) {
            return false;
        }

        return crypto_pwhash_str_verify(
                   encoded.c_str(),
                   password.c_str(), password.size()) == 0;
    }

    /**
     * True when a stored hash was produced with weaker limits than the
     * ones above, so it should be rehashed while the plaintext is still
     * in hand.
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
     */
    static void dummyVerify(const std::string& password) {
        // Hash of a value no user can submit — the leading byte is not
        // representable in a JSON string body.
        static const std::string decoy = hash(std::string("\x01", 1) + "no-such-account");
        (void) verify(decoy, password);
    }
};
