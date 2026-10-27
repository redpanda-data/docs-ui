// Spike shim for <seastar/util/variant_utils.hh>.
// Provides ss::visit (a thin wrapper over std::visit with the visitor first)
// and make_visitor (an overload set), the subset the Iceberg code uses.
#pragma once

#include <utility>
#include <variant>

namespace seastar {

template<typename... Ts>
struct overloaded_functor : Ts... {
    using Ts::operator()...;
};
template<typename... Ts>
overloaded_functor(Ts...) -> overloaded_functor<Ts...>;

template<typename... Ts>
auto make_visitor(Ts&&... fs) {
    return overloaded_functor<std::decay_t<Ts>...>{std::forward<Ts>(fs)...};
}

// Seastar's visit takes the variant first, then the visitor functors.
template<typename Variant, typename... Funcs>
decltype(auto) visit(Variant&& v, Funcs&&... fs) {
    return std::visit(
      make_visitor(std::forward<Funcs>(fs)...), std::forward<Variant>(v));
}

} // namespace seastar

namespace ss = seastar;
