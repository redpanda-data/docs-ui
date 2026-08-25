// Spike shim for iceberg/conversion/conversion_outcome.h — SCHEMA path only.
//
// The real header additionally includes iceberg/values.h to declare the value
// conversion outcome aliases (value_outcome, etc.). values.h transitively pulls
// in iobuf and absl int128, which the *schema* mapper (type_to_iceberg) does
// not need. To keep the spike's dependency footprint minimal we drop that
// include here and keep only what the schema mapper uses: result<> from
// base/outcome.h plus the conversion_exception type.
//
// The full engine will restore the value aliases (and size the iobuf/absl deps)
// when the value mapper is added.
#pragma once

#include "base/outcome.h"

#include <fmt/format.h>

#include <exception>
#include <string>

// The real Redpanda base provides an fmt formatter for std::exception_ptr
// (used when logging conversion failures). Provide an equivalent so the schema
// mapper compiles: format as the contained exception's message.
template<>
struct fmt::formatter<std::exception_ptr> : fmt::formatter<std::string> {
    auto format(std::exception_ptr ep, fmt::format_context& ctx) const {
        std::string msg = "unknown exception";
        if (ep) {
            try {
                std::rethrow_exception(ep);
            } catch (const std::exception& e) {
                msg = e.what();
            } catch (...) {
            }
        }
        return fmt::formatter<std::string>::format(msg, ctx);
    }
};

namespace iceberg {

class conversion_exception final : public std::exception {
public:
    explicit conversion_exception(std::string msg) noexcept
      : msg_(std::move(msg)) {}

    const char* what() const noexcept final { return msg_.c_str(); }

private:
    std::string msg_;
};

template<typename SchemaT>
using conversion_outcome = result<SchemaT, conversion_exception>;

} // namespace iceberg
