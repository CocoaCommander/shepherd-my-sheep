#include "middleware/CorsMiddleware.hpp"

#include <gtest/gtest.h>

#include <strings.h>

#include <cstdlib>
#include <optional>
#include <string>
#include <vector>

namespace {

using oatpp::web::protocol::http::Status;
namespace outgoing = oatpp::web::protocol::http::outgoing;
namespace incoming = oatpp::web::protocol::http::incoming;

const std::string ORIGIN = "http://example.test";

// Sets (or unsets, when value is nullopt) CORS_ORIGIN and restores the
// previous state on destruction.
class ScopedCorsOrigin {
public:
    explicit ScopedCorsOrigin(const std::optional<std::string>& value) {
        const char* prev = std::getenv("CORS_ORIGIN");
        if (prev) m_previous = std::string(prev);
        if (value)
            setenv("CORS_ORIGIN", value->c_str(), 1);
        else
            unsetenv("CORS_ORIGIN");
    }
    ~ScopedCorsOrigin() {
        if (m_previous)
            setenv("CORS_ORIGIN", m_previous->c_str(), 1);
        else
            unsetenv("CORS_ORIGIN");
    }
private:
    std::optional<std::string> m_previous;
};

std::shared_ptr<incoming::Request> makeRequest(const std::string& method) {
    oatpp::web::protocol::http::RequestStartingLine line;
    line.method   = method.c_str();
    line.path     = "/graphql";
    line.protocol = "HTTP/1.1";
    return incoming::Request::createShared(nullptr, line, {}, nullptr, nullptr);
}

std::shared_ptr<outgoing::Response> plainOk() {
    return outgoing::ResponseFactory::createResponse(Status::CODE_200, "");
}

// Every value of a header, counting duplicates (the bug is duplicate headers).
std::vector<std::string> valuesOf(const std::shared_ptr<outgoing::Response>& response, const std::string& name) {
    std::vector<std::string> out;
    for (const auto& h : response->getHeaders().getAll_Unsafe()) {
        std::string key = h.first.toString()->c_str();
        if (strcasecmp(key.c_str(), name.c_str()) == 0) out.push_back(h.second.toString()->c_str());
    }
    return out;
}

void expectOnce(const std::shared_ptr<outgoing::Response>& r, const std::string& name, const std::string& value) {
    auto values = valuesOf(r, name);
    ASSERT_EQ(values.size(), 1u) << name;
    EXPECT_EQ(values[0], value) << name;
}

// Runs the request interceptor, then (as main.cpp does) the response interceptor
// over whatever response resulted.
std::shared_ptr<outgoing::Response> runPipeline(const std::string& method, bool* shortCircuited = nullptr) {
    auto request = makeRequest(method);
    auto early   = CorsRequestInterceptor().intercept(request);
    if (shortCircuited) *shortCircuited = early != nullptr;
    auto response = early ? early : plainOk();
    return CorsResponseInterceptor().intercept(request, response);
}

}  // namespace

TEST(Cors, PreflightIsAnsweredWith204) {
    ScopedCorsOrigin env(ORIGIN);
    auto             response = CorsRequestInterceptor().intercept(makeRequest("OPTIONS"));
    ASSERT_NE(response, nullptr);
    EXPECT_EQ(response->getStatus().code, 204);
}

TEST(Cors, PreflightHasEachCorsHeaderExactlyOnce) {
    ScopedCorsOrigin env(ORIGIN);
    auto             response = runPipeline("OPTIONS");
    expectOnce(response, "Access-Control-Allow-Origin", ORIGIN);
    expectOnce(response, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    expectOnce(response, "Access-Control-Allow-Headers", "Content-Type, Authorization");
    expectOnce(response, "Access-Control-Max-Age", "86400");
}

TEST(Cors, ResponseInterceptorLeavesPreflightResponseUntouched) {
    ScopedCorsOrigin env(ORIGIN);
    auto             request  = makeRequest("OPTIONS");
    auto             response = CorsRequestInterceptor().intercept(request);
    ASSERT_NE(response, nullptr);
    auto before = response->getHeaders().getAll_Unsafe().size();
    CorsResponseInterceptor().intercept(request, response);
    EXPECT_EQ(response->getHeaders().getAll_Unsafe().size(), before);
}

TEST(Cors, NonOptionsRequestsContinueToHandler) {
    ScopedCorsOrigin env(ORIGIN);
    EXPECT_EQ(CorsRequestInterceptor().intercept(makeRequest("POST")), nullptr);
    EXPECT_EQ(CorsRequestInterceptor().intercept(makeRequest("GET")), nullptr);
}

TEST(Cors, PostResponseGetsCorsHeadersOnce) {
    ScopedCorsOrigin env(ORIGIN);
    auto             response = runPipeline("POST");
    expectOnce(response, "Access-Control-Allow-Origin", ORIGIN);
    expectOnce(response, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    expectOnce(response, "Access-Control-Allow-Headers", "Content-Type, Authorization");
}

TEST(Cors, GetResponseGetsCorsHeadersOnce) {
    ScopedCorsOrigin env(ORIGIN);
    auto             response = runPipeline("GET");
    expectOnce(response, "Access-Control-Allow-Origin", ORIGIN);
    expectOnce(response, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    expectOnce(response, "Access-Control-Allow-Headers", "Content-Type, Authorization");
}

TEST(Cors, UnsetOriginOmitsAllowOriginButKeepsOtherHeaders) {
    ScopedCorsOrigin env(std::nullopt);
    for (const char* method : {"OPTIONS", "POST", "GET"}) {
        auto response = runPipeline(method);
        EXPECT_TRUE(valuesOf(response, "Access-Control-Allow-Origin").empty()) << method;
        expectOnce(response, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        expectOnce(response, "Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
}

TEST(Cors, EmptyOriginBehavesLikeUnset) {
    ScopedCorsOrigin env(std::string(""));
    for (const char* method : {"OPTIONS", "POST", "GET"}) {
        auto response = runPipeline(method);
        EXPECT_TRUE(valuesOf(response, "Access-Control-Allow-Origin").empty()) << method;
        expectOnce(response, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        expectOnce(response, "Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
}

TEST(Cors, PreflightWithoutOriginStillHasMaxAgeOnce) {
    ScopedCorsOrigin env(std::nullopt);
    expectOnce(runPipeline("OPTIONS"), "Access-Control-Max-Age", "86400");
}
