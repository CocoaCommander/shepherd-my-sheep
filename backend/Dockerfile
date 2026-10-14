# syntax=docker/dockerfile:1.7
#
# Two stages. The C++ toolchain (cmake, compiler, -dev headers) lives only
# in the builder and never reaches the host or the shipped image; the
# runtime carries just the shared libraries the binary actually loads.

# ── Builder ──────────────────────────────────────────────────
FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        pkg-config \
        git \
        ca-certificates \
        libpqxx-dev \
        libsodium-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY CMakeLists.txt ./
COPY src ./src

# oatpp and jwt-cpp are pulled by FetchContent at configure time. Caching
# _deps keeps source edits from re-cloning them on every rebuild.
RUN --mount=type=cache,target=/build/_deps \
    cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /build -j"$(nproc)" \
    && cp /build/shepherd-api /usr/local/bin/shepherd-api

# ── Unit tests ───────────────────────────────────────────────
# Built only on request — `docker build --target test backend` — and
# never part of the shipped image. A failing test fails the build.
FROM builder AS test

COPY tests ./tests

RUN --mount=type=cache,target=/build-tests/_deps \
    cmake -S /src -B /build-tests -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTS=ON \
    && cmake --build /build-tests --target unit_tests -j"$(nproc)" \
    && ctest --test-dir /build-tests --output-on-failure

# ── Static analysis ──────────────────────────────────────────
# `docker build --target lint backend` — clang-tidy against the same
# compile commands as the real build. Never part of the shipped image.
FROM builder AS lint

RUN apt-get update && apt-get install -y --no-install-recommends clang-tidy \
    && rm -rf /var/lib/apt/lists/*

COPY .clang-tidy ./
COPY tests ./tests

# Configure only: clang-tidy needs compile_commands.json, not binaries.
# FetchContent headers are rewritten to -isystem so the analyzer reports
# problems in our code, not in oatpp or jwt-cpp.
RUN --mount=type=cache,target=/build-lint/_deps \
    cmake -S /src -B /build-lint -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTS=ON \
    && sed -i 's#-I/build-lint/_deps#-isystem /build-lint/_deps#g' /build-lint/compile_commands.json \
    && run-clang-tidy -p /build-lint -quiet '^/src/(src|tests)/'

# ── Runtime ──────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# libpqxx-6.4 is what bookworm ships; the -dev package in the builder
# pulls the same soname, so these must stay in step if the base changes.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpqxx-6.4 \
        libsodium23 \
        libssl3 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Never run the API as root.
RUN useradd --system --no-create-home --uid 10001 shepherd

COPY --from=builder /usr/local/bin/shepherd-api /usr/local/bin/shepherd-api

USER shepherd

# Documentation only — the real bind address comes from API_HOST/API_PORT.
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/shepherd-api"]
