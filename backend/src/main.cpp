#include "oatpp/web/server/HttpConnectionHandler.hpp"
#include "oatpp/network/Server.hpp"
#include "oatpp/network/tcp/server/ConnectionProvider.hpp"

#include "AppComponent.hpp"
#include "Log.hpp"
#include "graphql/GraphQLController.hpp"
#include "middleware/CorsMiddleware.hpp"
#include "middleware/RequestLogger.hpp"

#include <sodium.h>

#include <iostream>
#include <cstdlib>
#include <string>

void run() {
    AppComponent components;

    auto router = components.httpRouter.getObject();

    auto graphqlController = std::make_shared<GraphQLController>(
        components.objectMapper.getObject(), components.dbPool.getObject(), components.jwtService.getObject());
    router->addController(graphqlController);

    auto connectionHandler = oatpp::web::server::HttpConnectionHandler::createShared(router);

    // Register middleware — order matters:
    // 1. Request logger (logs incoming request)
    // 2. CORS request interceptor (handles OPTIONS preflight)
    // 3. ... handler runs ...
    // 4. CORS response interceptor (adds headers to all responses)
    // 5. Response logger (logs outgoing status)
    connectionHandler->addRequestInterceptor(std::make_shared<RequestLoggerInterceptor>());
    connectionHandler->addRequestInterceptor(std::make_shared<CorsRequestInterceptor>());
    connectionHandler->addResponseInterceptor(std::make_shared<CorsResponseInterceptor>());
    connectionHandler->addResponseInterceptor(std::make_shared<ResponseLoggerInterceptor>());

    const auto& host = components.env.apiHost;
    v_uint16    port = components.env.apiPort;

    // UNSPEC lets API_HOST pick the family: 0.0.0.0 is IPv4 only, :: is
    // IPv6 and (on Linux) IPv4 too. A hostname binds its first address.
    auto connectionProvider =
        oatpp::network::tcp::server::ConnectionProvider::createShared({host, port, oatpp::network::Address::UNSPEC});

    oatpp::network::Server server(connectionProvider, connectionHandler);

    // Log CORS config on startup
    const char* corsOrigin = std::getenv("CORS_ORIGIN");
    auto        urlHost    = host.find(':') == std::string::npos ? host : "[" + host + "]";
    Log::info("Shepherd API running on http://" + urlHost + ":" + std::to_string(port));
    Log::info("GraphQL endpoint: POST /graphql");
    Log::info(std::string("CORS allowed origin: ")
              + (corsOrigin ? corsOrigin : "(none — browser requests will be blocked)"));

    server.run();
}

int main() {
    // Must run before any hashing and before any threads are spawned.
    // Returns 1 if already initialised, which is fine; only < 0 is a failure.
    if (sodium_init() < 0) {
        std::cerr << "[FATAL] libsodium failed to initialise" << std::endl;
        return 1;
    }

    oatpp::base::Environment::init();
    run();
    oatpp::base::Environment::destroy();
    return 0;
}
