#include "oatpp/web/server/HttpConnectionHandler.hpp"
#include "oatpp/network/Server.hpp"
#include "oatpp/network/tcp/server/ConnectionProvider.hpp"

#include "AppComponent.hpp"
#include "graphql/GraphQLController.hpp"
#include "middleware/CorsMiddleware.hpp"
#include "middleware/RequestLogger.hpp"

#include <iostream>
#include <cstdlib>
#include <string>

void run() {
    AppComponent components;

    auto router = components.httpRouter.getObject();

    auto graphqlController = std::make_shared<GraphQLController>(
        components.objectMapper.getObject(),
        components.dbPool.getObject()
    );
    graphqlController->addEndpointsToRouter(router);

    auto connectionHandler =
        oatpp::web::server::HttpConnectionHandler::createShared(router);

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

    const char* envHost = std::getenv("API_HOST");
    const char* envPort = std::getenv("API_PORT");
    std::string host = envHost ? envHost : "0.0.0.0";
    v_uint16    port = envPort ? static_cast<v_uint16>(std::stoi(envPort)) : 8080;

    auto connectionProvider =
        oatpp::network::tcp::server::ConnectionProvider::createShared(
            {host, port, oatpp::network::Address::IP_4}
        );

    oatpp::network::Server server(connectionProvider, connectionHandler);

    // Log CORS config on startup
    const char* corsOrigin = std::getenv("CORS_ORIGIN");
    std::cout << "Shepherd API running on http://" << host << ":" << port << std::endl;
    std::cout << "GraphQL endpoint: POST /graphql" << std::endl;
    std::cout << "CORS allowed origin: " << (corsOrigin ? corsOrigin : "(none — browser requests will be blocked)") << std::endl;

    server.run();
}

int main() {
    oatpp::base::Environment::init();
    run();
    oatpp::base::Environment::destroy();
    return 0;
}
