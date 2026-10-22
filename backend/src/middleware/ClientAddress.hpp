#pragma once

#include "oatpp/web/protocol/http/incoming/Request.hpp"

#include <memory>
#include <string>

/**
 * The client's address, for logging and (later) rate limiting.
 *
 * It's the TCP peer, which main.cpp only gets by building the connection
 * provider with useExtendedConnections. There's no proxy in front of the
 * API, so X-Forwarded-For is ignored: trusting it would let any client pick
 * its own address. If a proxy is added, this needs trusted-proxy handling.
 */

/**
 * One client, one address: with API_HOST=:: an IPv4 client arrives as an
 * IPv4-mapped IPv6 address (::ffff:1.2.3.4), so drop the prefix. Other IPv6
 * addresses are left as they are.
 */
inline std::string normalisePeerAddress(std::string address) {
    static const std::string MAPPED = "::ffff:";
    if (address.size() > MAPPED.size() && address.compare(0, MAPPED.size(), MAPPED) == 0
        && address.find('.', MAPPED.size()) != std::string::npos
        && address.find(':', MAPPED.size()) == std::string::npos) {
        address.erase(0, MAPPED.size());
    }
    return address;
}

/** The request's peer address, normalised, or "unknown" if the connection doesn't say. */
inline std::string clientAddress(const std::shared_ptr<oatpp::web::protocol::http::incoming::Request>& request) {
    auto connection = request->getConnection();
    if (connection) {
        auto props    = connection->getInputStreamContext().getProperties();
        auto peerAddr = props.get("peer_address");
        if (peerAddr) {
            return normalisePeerAddress(peerAddr->c_str());
        }
    }
    return "unknown";
}
