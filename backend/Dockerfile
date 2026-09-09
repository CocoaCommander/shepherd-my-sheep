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
