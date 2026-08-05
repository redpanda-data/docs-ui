// Spike shim for redpanda's base/seastarx.h — matches the real header: make
// `ss` an alias for `seastar`. The actual Seastar types the Iceberg code uses
// (sstring, chunked_vector, bool_class) are provided by the dedicated
// <seastar/...> shim headers under shim/seastar/, which the source includes
// directly.
#pragma once

namespace seastar {} // namespace seastar

namespace ss = seastar;
