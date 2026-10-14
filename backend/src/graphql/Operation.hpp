#pragma once

#include "ErrorMapping.hpp"

#include <cctype>
#include <stdexcept>
#include <string>

/**
 * The parts of a GraphQL document the hand-rolled executor routes on.
 *
 * Routing used to search the whole query text for a field name, which
 * picked the wrong resolver whenever one name contained another
 * ("unassignPerson" contains "assignPerson") or a field name appeared as
 * an argument ("activePrayerBurdens(personId: ...)" contains "person").
 * Reading the operation type and the first root field fixes both.
 *
 * Limitations, by design for now:
 *   - Only the first root field is resolved; clients send one per request.
 *   - Fragment definitions before the operation are not supported.
 */
struct ParsedOperation {
    enum class Type { Query, Mutation };

    Type        type;
    std::string field;        // root field name, e.g. "myPeople"
    std::string responseKey;  // alias if one was given, else the field name
};

class OperationParser {
public:
    /** Throws BadInput on anything it cannot route. */
    static ParsedOperation parse(const std::string& doc) {
        OperationParser p(doc);
        return p.parseDocument();
    }

private:
    const std::string& m_doc;
    size_t             m_pos = 0;

    explicit OperationParser(const std::string& doc) : m_doc(doc) {}

    ParsedOperation parseDocument() {
        ParsedOperation op{ParsedOperation::Type::Query, "", ""};

        skipIgnored();
        if (peek() != '{') {
            auto keyword = readName();
            if (keyword == "query") {
                op.type = ParsedOperation::Type::Query;
            } else if (keyword == "mutation") {
                op.type = ParsedOperation::Type::Mutation;
            } else if (keyword == "subscription") {
                throw BadInput("Subscriptions are not supported");
            } else {
                throw BadInput("Expected query or mutation");
            }

            // Skip the optional name, variable definitions and directives
            // up to the selection set. Variable defaults may hold strings
            // or nested braces, so walk them rather than search for '{'.
            skipIgnored();
            while (m_pos < m_doc.size() && peek() != '{') {
                if (peek() == '(') {
                    skipBalanced('(', ')');
                } else if (peek() == '"') {
                    skipString();
                } else {
                    ++m_pos;
                }
                skipIgnored();
            }
        }

        if (peek() != '{') {
            throw BadInput("Expected a selection set");
        }
        ++m_pos;

        skipIgnored();
        auto first = readName();
        if (first.empty()) {
            throw BadInput("Expected a root field");
        }

        skipIgnored();
        if (peek() == ':') {
            ++m_pos;
            skipIgnored();
            op.responseKey = first;
            op.field       = readName();
            if (op.field.empty()) {
                throw BadInput("Expected a field name after alias");
            }
        } else {
            op.field       = first;
            op.responseKey = first;
        }

        return op;
    }

    char peek() const {
        return m_pos < m_doc.size() ? m_doc[m_pos] : '\0';
    }

    // Whitespace, commas (insignificant in GraphQL) and # comments.
    void skipIgnored() {
        while (m_pos < m_doc.size()) {
            char c = m_doc[m_pos];
            if (std::isspace(static_cast<unsigned char>(c)) || c == ',') {
                ++m_pos;
            } else if (c == '#') {
                while (m_pos < m_doc.size() && m_doc[m_pos] != '\n')
                    ++m_pos;
            } else {
                break;
            }
        }
    }

    std::string readName() {
        size_t start = m_pos;
        if (m_pos < m_doc.size() && (std::isalpha(static_cast<unsigned char>(m_doc[m_pos])) || m_doc[m_pos] == '_')) {
            ++m_pos;
            while (m_pos < m_doc.size()
                   && (std::isalnum(static_cast<unsigned char>(m_doc[m_pos])) || m_doc[m_pos] == '_')) {
                ++m_pos;
            }
        }
        return m_doc.substr(start, m_pos - start);
    }

    void skipString() {
        ++m_pos;  // opening quote
        while (m_pos < m_doc.size() && m_doc[m_pos] != '"') {
            if (m_doc[m_pos] == '\\') ++m_pos;
            ++m_pos;
        }
        if (m_pos >= m_doc.size()) {
            throw BadInput("Unterminated string");
        }
        ++m_pos;  // closing quote
    }

    void skipBalanced(char open, char close) {
        int depth = 0;
        while (m_pos < m_doc.size()) {
            char c = m_doc[m_pos];
            if (c == '"') {
                skipString();
                continue;
            }
            if (c == open) ++depth;
            if (c == close && --depth == 0) {
                ++m_pos;
                return;
            }
            ++m_pos;
        }
        throw BadInput(std::string("Unbalanced '") + open + "'");
    }
};
