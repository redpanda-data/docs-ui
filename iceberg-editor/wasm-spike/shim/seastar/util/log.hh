// Spike shim for <seastar/util/log.hh>.
// No-op logger: accepts any fmt-style call and discards it. Sufficient because
// the schema mapper only logs diagnostics; it does not depend on log output.
#pragma once

#include <string>

namespace seastar {

class logger {
public:
    explicit logger(std::string /*name*/) {}

    template<typename... Args>
    void info(const char* /*fmt*/, Args&&...) {}
    template<typename... Args>
    void warn(const char* /*fmt*/, Args&&...) {}
    template<typename... Args>
    void error(const char* /*fmt*/, Args&&...) {}
    template<typename... Args>
    void debug(const char* /*fmt*/, Args&&...) {}
    template<typename... Args>
    void trace(const char* /*fmt*/, Args&&...) {}
};

} // namespace seastar

namespace ss = seastar;
