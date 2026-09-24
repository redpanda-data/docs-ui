// Spike shim for <seastar/core/chunked_vector.hh>.
// std::vector is a drop-in for the translation logic (order-preserving,
// size(), iteration, push_back). The second template parameter mirrors
// Seastar's max-contiguous-allocation knob and is ignored.
#pragma once

#include <cstddef>
#include <vector>

namespace seastar {
template<typename T, size_t /*max_contiguous_allocation*/ = 128UL * 1024UL>
using chunked_vector = std::vector<T>;
} // namespace seastar

namespace ss = seastar;
