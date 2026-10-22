#include "graphql/resolvers/ResolverSupport.hpp"

#include "oatpp/parser/json/mapping/ObjectMapper.hpp"

#include <gtest/gtest.h>

#include <string>

namespace {
// Parsed as GraphQLController does: the request body into GraphQLRequest,
// then its variables into Args.
Args input(const std::string& inputJson) {
    auto mapper  = oatpp::parser::json::mapping::ObjectMapper::createShared();
    auto body    = R"({"query": "", "variables": {"input": )" + inputJson + "}}";
    auto request = mapper->readFromString<oatpp::Object<GraphQLRequest>>(body.c_str());
    return Args(request->variables).object("input");
}
}  // namespace

TEST(Args, AbsentKeyIsNeitherNullNorSet) {
    auto args = input(R"({"name": "Ann"})");
    EXPECT_FALSE(args.isNull("age"));
    EXPECT_EQ(args.opt("age"), std::nullopt);
}

// The JSON mapper keeps a key whose value is null, so `age: null` can mean
// something different from leaving `age` out.
TEST(Args, NullValueIsNull) {
    auto args = input(R"({"age": null, "yearMet": null})");
    EXPECT_TRUE(args.isNull("age"));
    EXPECT_TRUE(args.isNull("yearMet"));
    EXPECT_EQ(args.opt("age"), std::nullopt);
}

TEST(Args, PresentValueIsNotNull) {
    auto args = input(R"({"age": 30, "isActive": false, "name": ""})");
    EXPECT_FALSE(args.isNull("age"));
    EXPECT_FALSE(args.isNull("isActive"));
    EXPECT_FALSE(args.isNull("name"));
    EXPECT_EQ(args.opt("age"), "30");
    EXPECT_EQ(args.opt("isActive"), "false");
    EXPECT_EQ(args.opt("name"), "");
}

TEST(Args, NoVariablesIsNeverNull) {
    Args args{oatpp::Any()};
    EXPECT_FALSE(args.isNull("age"));
}
