// What model/metadata.h brings in for the iceberg_mode declarations that
// extract-iceberg-mode.js copies out of it. Included first by the generated
// iceberg_mode.h. Only standard and third-party headers, plus the Seastar
// shim's sstring (std::string), so no Redpanda logic lives here.
#pragma once

#include "base/seastarx.h"

#include <seastar/core/sstring.hh>

#include <cstdint>
#include <expected>
#include <iosfwd>
#include <istream>
#include <optional>
#include <ostream>
#include <string>
#include <string_view>
#include <utility>
#include <variant>

// v26.2 and later declare `fmt::iterator iceberg_mode::format_to` and get
// their fmt formatter from base/format_to.h. Older releases do not have the
// header and print with operator<<.
#if __has_include("base/format_to.h")
#include "base/format_to.h"
#endif

// The class befriends its serde functions, which take these. Only declared:
// the wire format is not compiled.
class iobuf;
class iobuf_parser;
