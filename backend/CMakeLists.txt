cmake_minimum_required(VERSION 3.22)
project(shepherd-api VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ── Dependencies via FetchContent ────────────────────────────
include(FetchContent)

# oatpp — HTTP framework
FetchContent_Declare(
    oatpp
    GIT_REPOSITORY https://github.com/oatpp/oatpp.git
    GIT_TAG        1.3.0
)
set(OATPP_BUILD_TESTS OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(oatpp)

# libpqxx — PostgreSQL C++ client
find_package(PkgConfig REQUIRED)
pkg_check_modules(LIBPQXX REQUIRED IMPORTED_TARGET libpqxx)

# ── Source files ─────────────────────────────────────────────
file(GLOB_RECURSE SOURCES src/*.cpp)

add_executable(${PROJECT_NAME} ${SOURCES})

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    # Plain "oatpp", not "oatpp::oatpp" — oatpp 1.3.0 declares no namespaced
    # ALIAS, so the :: form only resolves via find_package on an installed
    # copy, never through FetchContent.
    oatpp
    PkgConfig::LIBPQXX
)

# ── Tests ────────────────────────────────────────────────────
option(BUILD_TESTS "Build tests" OFF)
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
