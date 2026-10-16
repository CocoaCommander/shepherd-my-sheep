#include "middleware/RequestLogger.hpp"

#include "oatpp/web/protocol/http/outgoing/ResponseFactory.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <iostream>
#include <regex>
#include <sstream>
#include <string>

namespace {

using oatpp::web::protocol::http::Status;
namespace outgoing = oatpp::web::protocol::http::outgoing;
namespace incoming = oatpp::web::protocol::http::incoming;

// Redirects std::cout into a buffer for its lifetime.
class CoutCapture {
public:
    CoutCapture() : m_previous(std::cout.rdbuf(m_buffer.rdbuf())) {}
    ~CoutCapture() {
        std::cout.rdbuf(m_previous);
    }
    CoutCapture(const CoutCapture&)            = delete;
    CoutCapture& operator=(const CoutCapture&) = delete;

    std::string str() const {
        return m_buffer.str();
    }

private:
    std::ostringstream m_buffer;
    std::streambuf*    m_previous;
};

// The level is process-wide state, so every test starts at Debug and leaves it there.
class LogTest : public ::testing::Test {
protected:
    void SetUp() override {
        Log::setLevel(LogLevel::Debug);
    }
    void TearDown() override {
        Log::setLevel(LogLevel::Debug);
    }
};

const std::string STAMP = R"(\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] )";

std::shared_ptr<incoming::Request> makeRequest(const std::string& method, const std::string& path) {
    oatpp::web::protocol::http::RequestStartingLine line;
    line.method   = method.c_str();
    line.path     = path.c_str();
    line.protocol = "HTTP/1.1";
    return incoming::Request::createShared(nullptr, line, {}, nullptr, nullptr);
}

std::shared_ptr<outgoing::Response> makeResponse(int code) {
    return outgoing::ResponseFactory::createResponse(Status(code, "test"), "");
}

// Runs the response interceptor and returns what it printed.
std::string logResponse(int code) {
    CoutCapture out;
    auto        request  = makeRequest("POST", "/graphql");
    auto        response = makeResponse(code);
    auto        result   = ResponseLoggerInterceptor().intercept(request, response);
    EXPECT_EQ(result, response);
    return out.str();
}

// Prints one request through both interceptors and returns the combined output.
std::string logBoth(const std::string& path) {
    CoutCapture out;
    auto        request  = makeRequest("POST", path);
    auto        response = makeResponse(401);
    RequestLoggerInterceptor().intercept(request);
    ResponseLoggerInterceptor().intercept(request, response);
    return out.str();
}

}  // namespace

TEST(LogParse, AcceptsEachUpperCaseLevel) {
    EXPECT_EQ(parseLogLevel("DEBUG"), LogLevel::Debug);
    EXPECT_EQ(parseLogLevel("INFO"), LogLevel::Info);
    EXPECT_EQ(parseLogLevel("WARN"), LogLevel::Warn);
    EXPECT_EQ(parseLogLevel("ERROR"), LogLevel::Error);
}

TEST(LogParse, RejectsEverythingElse) {
    for (const char* value : {"", "debug", "Info", "warn", " INFO", "INFO ", "WARNING", "TRACE", "0"}) {
        EXPECT_FALSE(parseLogLevel(value).has_value()) << "'" << value << "'";
    }
}

TEST_F(LogTest, EnabledMatchesThresholdAtEachLevel) {
    const LogLevel levels[] = {LogLevel::Debug, LogLevel::Info, LogLevel::Warn, LogLevel::Error};
    for (int threshold = 0; threshold < 4; ++threshold) {
        Log::setLevel(levels[threshold]);
        for (int level = 0; level < 4; ++level) {
            EXPECT_EQ(Log::enabled(levels[level]), level >= threshold)
                << "threshold " << threshold << " level " << level;
        }
    }
}

TEST_F(LogTest, WriteIsFilteredByThreshold) {
    Log::setLevel(LogLevel::Warn);
    CoutCapture out;
    Log::debug("d");
    Log::info("i");
    EXPECT_EQ(out.str(), "");
    Log::warn("w");
    Log::error("e");
    std::string text = out.str();
    EXPECT_EQ(text.find(" d\n"), std::string::npos);
    EXPECT_EQ(text.find(" i\n"), std::string::npos);
    EXPECT_NE(text.find("WARN  w\n"), std::string::npos);
    EXPECT_NE(text.find("ERROR e\n"), std::string::npos);
}

TEST_F(LogTest, DebugThresholdLetsEverythingThrough) {
    CoutCapture out;
    Log::debug("a");
    Log::info("b");
    Log::warn("c");
    Log::error("d");
    std::string text = out.str();
    EXPECT_EQ(std::count(text.begin(), text.end(), '\n'), 4);
}

TEST_F(LogTest, ErrorThresholdSilencesLowerLevels) {
    Log::setLevel(LogLevel::Error);
    CoutCapture out;
    Log::debug("a");
    Log::info("b");
    Log::warn("c");
    EXPECT_EQ(out.str(), "");
    Log::error("d");
    EXPECT_NE(out.str().find("ERROR d\n"), std::string::npos);
}

TEST_F(LogTest, LineFormatPadsLabelToFiveCharacters) {
    struct Case {
        LogLevel    level;
        const char* label;
    };
    for (const Case& c : {Case{LogLevel::Debug, "DEBUG"}, Case{LogLevel::Info, "INFO "}, Case{LogLevel::Warn, "WARN "},
                          Case{LogLevel::Error, "ERROR"}}) {
        CoutCapture out;
        Log::write(c.level, "hello world");
        std::regex pattern("^" + STAMP + c.label + " hello world\n$");
        EXPECT_TRUE(std::regex_match(out.str(), pattern)) << c.label << ": " << out.str();
    }
}

TEST_F(LogTest, HelpersUseTheirOwnLevel) {
    CoutCapture out;
    Log::debug("m");
    Log::info("m");
    Log::warn("m");
    Log::error("m");
    std::string text = out.str();
    auto        d    = text.find("DEBUG m\n");
    auto        i    = text.find("INFO  m\n");
    auto        w    = text.find("WARN  m\n");
    auto        e    = text.find("ERROR m\n");
    ASSERT_NE(d, std::string::npos);
    ASSERT_NE(i, std::string::npos);
    ASSERT_NE(w, std::string::npos);
    ASSERT_NE(e, std::string::npos);
    EXPECT_LT(d, i);
    EXPECT_LT(i, w);
    EXPECT_LT(w, e);
}

TEST_F(LogTest, OneMessageIsOneLine) {
    CoutCapture out;
    Log::info("single");
    std::string text = out.str();
    ASSERT_FALSE(text.empty());
    EXPECT_EQ(text.back(), '\n');
    EXPECT_EQ(text.find('\n'), text.size() - 1);
}

TEST_F(LogTest, EmptyMessageStillWritesALine) {
    CoutCapture out;
    Log::info("");
    EXPECT_TRUE(std::regex_match(out.str(), std::regex("^" + STAMP + "INFO  \n$")));
}

TEST(LogLevelForStatus, Boundaries) {
    EXPECT_EQ(levelForStatus(199), LogLevel::Info);
    EXPECT_EQ(levelForStatus(200), LogLevel::Info);
    EXPECT_EQ(levelForStatus(399), LogLevel::Info);
    EXPECT_EQ(levelForStatus(400), LogLevel::Warn);
    EXPECT_EQ(levelForStatus(499), LogLevel::Warn);
    EXPECT_EQ(levelForStatus(500), LogLevel::Error);
    EXPECT_EQ(levelForStatus(599), LogLevel::Error);
}

TEST_F(LogTest, RequestInterceptorLogsArrivalAtDebug) {
    CoutCapture out;
    auto        result = RequestLoggerInterceptor().intercept(makeRequest("POST", "/graphql"));
    EXPECT_EQ(result, nullptr);
    EXPECT_TRUE(std::regex_match(out.str(), std::regex("^" + STAMP + R"(DEBUG --> POST /graphql \(from unknown\)\n$)")))
        << out.str();
}

TEST_F(LogTest, RequestInterceptorIsSilentAtInfo) {
    Log::setLevel(LogLevel::Info);
    CoutCapture out;
    auto        result = RequestLoggerInterceptor().intercept(makeRequest("POST", "/graphql"));
    EXPECT_EQ(result, nullptr);
    EXPECT_EQ(out.str(), "");
}

TEST_F(LogTest, ResponseInterceptorLogsSuccessAtInfo) {
    Log::setLevel(LogLevel::Info);
    EXPECT_TRUE(std::regex_match(logResponse(200), std::regex("^" + STAMP + "INFO  <-- 200 POST /graphql\n$")));
}

TEST_F(LogTest, ResponseInterceptorHidesSuccessAtWarn) {
    Log::setLevel(LogLevel::Warn);
    EXPECT_EQ(logResponse(200), "");
    EXPECT_EQ(logResponse(204), "");
}

TEST_F(LogTest, ResponseInterceptorShowsClientErrorAtWarn) {
    Log::setLevel(LogLevel::Warn);
    EXPECT_TRUE(std::regex_match(logResponse(404), std::regex("^" + STAMP + "WARN  <-- 404 POST /graphql\n$")));
}

TEST_F(LogTest, ResponseInterceptorLogsServerErrorAtError) {
    Log::setLevel(LogLevel::Error);
    EXPECT_TRUE(std::regex_match(logResponse(500), std::regex("^" + STAMP + "ERROR <-- 500 POST /graphql\n$")));
    EXPECT_EQ(logResponse(404), "");
}

TEST_F(LogTest, UnauthorizedResponsesNameTheClient) {
    for (int code : {401, 403}) {
        std::string text = logResponse(code);
        EXPECT_NE(text.find("WARN  <-- " + std::to_string(code) + " POST /graphql"), std::string::npos) << text;
        EXPECT_NE(text.find("(unauthorized from unknown)"), std::string::npos) << text;
    }
}

TEST_F(LogTest, OtherClientErrorsDoNotMentionUnauthorized) {
    for (int code : {400, 404, 500}) {
        EXPECT_EQ(logResponse(code).find("unauthorized"), std::string::npos) << code;
    }
}

TEST_F(LogTest, QueryStringNeverAppearsInEitherLine) {
    std::string text = logBoth("/graphql?token=secret");
    EXPECT_EQ(text.find("secret"), std::string::npos) << text;
    EXPECT_EQ(text.find("token"), std::string::npos) << text;
    EXPECT_EQ(text.find('?'), std::string::npos) << text;
    EXPECT_NE(text.find("--> POST /graphql (from"), std::string::npos) << text;
    EXPECT_NE(text.find("<-- 401 POST /graphql (unauthorized"), std::string::npos) << text;
}

TEST_F(LogTest, ControlCharactersInPathCannotForgeLines) {
    std::string text = logBoth(std::string("/a\nINFO  forged\x1b[31m/b"));
    EXPECT_EQ(std::count(text.begin(), text.end(), '\n'), 2) << text;  // one per interceptor
    EXPECT_EQ(text.find('\x1b'), std::string::npos);
    EXPECT_NE(text.find("forged"), std::string::npos);  // text is kept, only the control bytes change
    std::istringstream lines(text);
    std::string        line;
    while (std::getline(lines, line)) {
        EXPECT_TRUE(std::regex_search(line, std::regex("^" + STAMP + "(DEBUG|WARN ) (-->|<--) "))) << line;
    }
}

TEST_F(LogTest, OverLongPathIsTruncatedWithEllipsis) {
    std::string text = logBoth("/" + std::string(1000, 'a'));
    EXPECT_NE(text.find("..."), std::string::npos) << text;
    EXPECT_EQ(text.find(std::string(300, 'a')), std::string::npos);
    EXPECT_EQ(std::count(text.begin(), text.end(), '\n'), 2);
}

TEST_F(LogTest, ShortPathIsNotTruncated) {
    std::string text = logBoth("/graphql");
    EXPECT_EQ(text.find("..."), std::string::npos) << text;
}
