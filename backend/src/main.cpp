#include "oatpp/web/server/HttpConnectionHandler.hpp"
#include "oatpp/network/Server.hpp"
#include "oatpp/network/tcp/server/ConnectionProvider.hpp"

#include "AppComponent.hpp"
#include "graphql/GraphQLController.hpp"

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

    const char* envHost = std::getenv("API_HOST");
    const char* envPort = std::getenv("API_PORT");
    std::string host = envHost ? envHost : "0.0.0.0";
    v_uint16    port = envPort ? static_cast<v_uint16>(std::stoi(envPort)) : 8080;

    auto connectionProvider =
        oatpp::network::tcp::server::ConnectionProvider::createShared(
            {host, port, oatpp::network::Address::IP_4}
        );

    oatpp::network::Server server(connectionProvider, connectionHandler);

    std::cout << "Shepherd API running on http://" << host << ":" << port << std::endl;
    std::cout << "GraphQL endpoint: POST /graphql" << std::endl;

    server.run();
}

int main() {
    oatpp::base::Environment::init();
    run();
    oatpp::base::Environment::destroy();
    return 0;
}
