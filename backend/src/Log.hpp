#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>

/**
 * Leveled logging to stdout, one line per message:
 *
 *   [2026-10-16 14:30:00] INFO  <-- 200 POST /graphql
 *
 * The threshold comes from LOG_LEVEL (DEBUG, INFO, WARN or ERROR), checked
 * at startup by AppComponent: DEBUG for local dev, INFO otherwise. Docker
 * keeps stdout, so `docker compose logs api` (or `make logs`) shows it.
 */
enum class LogLevel : std::uint8_t { Debug = 0, Info = 1, Warn = 2, Error = 3 };

/** Parses a LOG_LEVEL value. Exact upper case only; anything else is nullopt. */
inline std::optional<LogLevel> parseLogLevel(const std::string& value) {
    if (value == "DEBUG") return LogLevel::Debug;
    if (value == "INFO") return LogLevel::Info;
    if (value == "WARN") return LogLevel::Warn;
    if (value == "ERROR") return LogLevel::Error;
    return std::nullopt;
}

class Log {
public:

    static void setLevel(LogLevel level) {
        threshold().store(level);
    }

    static bool enabled(LogLevel level) {
        return static_cast<int>(level) >= static_cast<int>(threshold().load());
    }

    static void debug(const std::string& message) {
        write(LogLevel::Debug, message);
    }
    static void info(const std::string& message) {
        write(LogLevel::Info, message);
    }
    static void warn(const std::string& message) {
        write(LogLevel::Warn, message);
    }
    static void error(const std::string& message) {
        write(LogLevel::Error, message);
    }

    static void write(LogLevel level, const std::string& message) {
        if (!enabled(level)) return;
        std::string line = "[" + timestamp() + "] " + label(level) + " " + message + "\n";
        // One locked write per line, so lines from different threads never interleave.
        std::lock_guard<std::mutex> lock(outputMutex());
        std::cout << line << std::flush;
    }

private:

    // Function-local statics: one shared instance across translation units.
    // Until setLevel runs, everything is logged.
    static std::atomic<LogLevel>& threshold() {
        static std::atomic<LogLevel> level{LogLevel::Debug};
        return level;
    }

    static std::mutex& outputMutex() {
        static std::mutex mutex;
        return mutex;
    }

    // Padded to one width so messages line up.
    static const char* label(LogLevel level) {
        switch (level) {
        case LogLevel::Debug:
            return "DEBUG";
        case LogLevel::Info:
            return "INFO ";
        case LogLevel::Warn:
            return "WARN ";
        case LogLevel::Error:
            return "ERROR";
        }
        return "?    ";
    }

    static std::string timestamp() {
        auto               time = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
        std::tm            utc{};
        std::ostringstream oss;
        gmtime_r(&time, &utc);
        oss << std::put_time(&utc, "%Y-%m-%d %H:%M:%S");
        return oss.str();
    }
};
