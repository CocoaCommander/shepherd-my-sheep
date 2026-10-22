# Unit tests for the parts of the API that need no database: operation
# parsing, bearer-token handling, JWT verification, password hashing and
# client address normalisation and rate limits.
# Resolver behaviour (including authorization) is covered end to end by
# tests/test_api.py at the repo root.

FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG        v1.15.2
)
set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

add_executable(unit_tests
    TestMain.cpp
    OperationTest.cpp
    AuthenticatorTest.cpp
    JWTServiceTest.cpp
    PasswordHasherTest.cpp
    ErrorMappingTest.cpp
    CorsMiddlewareTest.cpp
    ClientAddressTest.cpp
    RateLimiterTest.cpp
    LogTest.cpp
)

target_include_directories(unit_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)

target_link_libraries(unit_tests PRIVATE
    GTest::gtest
    oatpp
    PkgConfig::SODIUM
    jwt-cpp::jwt-cpp
    OpenSSL::SSL
    OpenSSL::Crypto
)

include(GoogleTest)
gtest_discover_tests(unit_tests)
