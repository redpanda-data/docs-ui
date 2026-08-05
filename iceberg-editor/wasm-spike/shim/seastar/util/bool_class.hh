// Spike shim for <seastar/util/bool_class.hh>.
// A strong-typedef boolean (prevents mixing up e.g. `field_required` with a
// plain bool). Provides the subset the Iceberg code uses.
#pragma once

#include <fmt/format.h>
#include <ostream>

namespace seastar {

template<typename Tag>
class bool_class {
    bool _value{false};

public:
    constexpr bool_class() noexcept = default;
    constexpr explicit bool_class(bool v) noexcept
      : _value(v) {}

    constexpr explicit operator bool() const noexcept { return _value; }

    constexpr bool_class operator!() const noexcept {
        return bool_class(!_value);
    }

    friend constexpr bool
    operator==(bool_class a, bool_class b) noexcept {
        return a._value == b._value;
    }
    friend constexpr bool
    operator!=(bool_class a, bool_class b) noexcept {
        return a._value != b._value;
    }

    static const bool_class yes;
    static const bool_class no;
};

// Static data members of a class template may be defined in a header.
template<typename Tag>
const bool_class<Tag> bool_class<Tag>::yes{true};
template<typename Tag>
const bool_class<Tag> bool_class<Tag>::no{false};

template<typename Tag>
std::ostream& operator<<(std::ostream& os, bool_class<Tag> v) {
    return os << (static_cast<bool>(v) ? "true" : "false");
}

} // namespace seastar

namespace ss = seastar;

// The real Seastar ships an fmt formatter for bool_class; the Iceberg code
// relies on it (e.g. formatting a field's `required` flag). Format as the
// underlying bool ("true"/"false") — exact text is irrelevant to the spike.
template<typename Tag>
struct fmt::formatter<seastar::bool_class<Tag>> : fmt::formatter<bool> {
    auto format(seastar::bool_class<Tag> v, fmt::format_context& ctx) const {
        return fmt::formatter<bool>::format(static_cast<bool>(v), ctx);
    }
};
