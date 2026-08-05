// Spike shim for redpanda's ssx/sformat.h.
// ssx::sformat is a thin wrapper that formats with fmt and returns an
// ss::sstring. Since our sstring is std::string, forward to fmt::format.
#pragma once

#include <fmt/format.h>

#include <string>

namespace ssx {

template<typename... Args>
std::string sformat(fmt::format_string<Args...> fmt, Args&&... args) {
    return fmt::format(fmt, std::forward<Args>(args)...);
}

} // namespace ssx
