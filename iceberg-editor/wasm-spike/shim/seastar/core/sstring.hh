// Spike shim for <seastar/core/sstring.hh>.
// Iceberg field names/values are plain text; std::string is behaviorally
// equivalent for the translation logic.
#pragma once

#include <string>

namespace seastar {
using sstring = std::string;
} // namespace seastar

namespace ss = seastar;
